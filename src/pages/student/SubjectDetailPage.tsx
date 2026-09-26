import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { studyUrl } from "../../lib/study";

interface Unit { id: string; name: string; order_number: number; }
interface Topic { id: string; name: string; unit_id: string; order_number: number; }
interface ContentRow { id: string; topic_id: string; type: string; title: string; file_url: string | null; external_url: string | null; }
interface ProgressRow { topic_id: string; percent_done: number; }
interface SubjectMeta { name: string; code: string | null; credits: number | null; }
interface Assessment { id: string; ia_number: number; max_marks: number; }
interface MarkRow { ia_assessment_id: string; marks_obtained: number; }
interface AttendanceRow { status: "present" | "absent" | "late" | "excused"; attendance_date: string; }

// Units/topics come from the open-catalog tables (any authenticated
// user can read these — same as subjects/semesters/etc.). If a student
// changes this URL to a subject they're not enrolled in, they'd see
// unit/topic NAMES (non-sensitive structure) but the `content` query
// below would come back empty — RLS silently filters it, not this page.
//
// "Mark Complete" calls mark_content_complete() (Phase 9) — it never
// writes progress/completions directly; the button just triggers the
// trusted function and re-fetches to show the server's own answer.
export function SubjectDetailPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<"overview" | "content" | "ia" | "attendance">(
    searchParams.get("tab") === "content" ? "content" : "overview"
  );
  const [subjectMeta, setSubjectMeta] = useState<SubjectMeta | null>(null);
  const [teacherName, setTeacherName] = useState<string | null>(null);
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [content, setContent] = useState<ContentRow[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  // Read-only: topic_id -> percent_done, from the server-computed
  // `progress` table (recalc_topic_progress()). This page never writes
  // to this table directly — "Mark Complete" only calls
  // mark_content_complete(), and the server recalculates progress itself.
  const [topicProgress, setTopicProgress] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [iaMarks, setIaMarks] = useState<MarkRow[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[] | null>(null);

  async function load() {
    if (!supabase || !subjectId || !profile) return;
    setError(null);
    const { data: subj, error: subjErr } = await supabase.from("subjects").select("name, code, credits").eq("id", subjectId).maybeSingle();
    if (subjErr) { setError(friendlyDbError(subjErr, "Subject")); return; }
    setSubjectMeta(subj ?? null);

    // Teacher for this subject in the student's OWN section — resolved
    // via get_my_section_teachers() (migration 34), since a direct
    // teacher_assignments -> users join is silently empty (users RLS has
    // no branch letting a student read a teacher's row).
    const sa = await supabase.from("student_assignments").select("section_id").eq("student_id", profile.id).eq("is_current", true).maybeSingle();
    if (sa.data?.section_id) {
      const [taRes, teacherIdentityRes] = await Promise.all([
        supabase.from("teacher_assignments").select("teacher_id").eq("subject_id", subjectId).eq("section_id", sa.data.section_id).maybeSingle(),
        supabase.rpc("get_my_section_teachers"),
      ]);
      const teacherId = taRes.data?.teacher_id;
      const match = (teacherIdentityRes.data ?? []).find((t: any) => t.teacher_id === teacherId);
      setTeacherName(match ? match.full_name || match.email : null);
    }

    const { data: unitRows, error: unitErr } = await supabase.from("units").select("id, name, order_number").eq("subject_id", subjectId).order("order_number");
    if (unitErr) { setError(friendlyDbError(unitErr, "Units")); return; }
    setUnits(unitRows ?? []);

    const unitIds = (unitRows ?? []).map((u) => u.id);
    if (unitIds.length === 0) return;

    const { data: topicRows, error: topicErr } = await supabase.from("topics").select("id, name, unit_id, order_number").in("unit_id", unitIds).order("order_number");
    if (topicErr) { setError(friendlyDbError(topicErr, "Topics")); return; }
    setTopics(topicRows ?? []);

    const topicIds = (topicRows ?? []).map((t) => t.id);
    if (topicIds.length === 0) return;

    // RLS (content_select) restricts this to published content for a
    // subject this student is enrolled in.
    const { data: contentRows, error: contentErr } = await supabase
      .from("content")
      .select("id, topic_id, type, title, file_url, external_url")
      .in("topic_id", topicIds);
    if (contentErr) { setError(friendlyDbError(contentErr, "Content")); return; }
    setContent(contentRows ?? []);

    // content_completions_select already scopes this to the caller's
    // own rows — no manual student_id filter needed.
    const { data: completionRows, error: compErr } = await supabase.from("content_completions").select("content_id");
    if (compErr) { setError(friendlyDbError(compErr, "Completions")); return; }
    setCompletedIds(new Set((completionRows ?? []).map((c) => c.content_id)));

    // progress_select RLS scopes this to the caller's own rows already.
    const { data: progressRows, error: progErr } = await supabase.from("progress").select("topic_id, percent_done").in("topic_id", topicIds);
    if (progErr) { setError(friendlyDbError(progErr, "Progress")); return; }
    setTopicProgress(new Map((progressRows as ProgressRow[] ?? []).map((p) => [p.topic_id, p.percent_done])));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, profile?.id]);

  useEffect(() => {
    if (!supabase || !subjectId || !profile) return;
    let cancelled = false;
    async function loadIaAndAttendance() {
      const [a, m, att] = await Promise.all([
        supabase!.from("ia_assessments").select("id, ia_number, max_marks").eq("subject_id", subjectId),
        supabase!.from("ia_marks").select("ia_assessment_id, marks_obtained").eq("student_id", profile!.id),
        supabase!.from("attendance_records").select("status, attendance_date").eq("student_id", profile!.id).eq("subject_id", subjectId),
      ]);
      if (cancelled) return;
      setAssessments((a.data ?? []) as Assessment[]);
      setIaMarks((m.data ?? []) as MarkRow[]);
      setAttendanceRows((att.data ?? []) as AttendanceRow[]);
    }
    loadIaAndAttendance();
    return () => { cancelled = true; };
  }, [subjectId, profile]);

  async function handleMarkComplete(contentId: string) {
    if (!supabase) return;
    setMarkError(null);
    setMarkingId(contentId);
    const { error: rpcErr } = await supabase.rpc("mark_content_complete", { p_content_id: contentId });
    setMarkingId(null);
    if (rpcErr) {
      setMarkError(friendlyDbError(rpcErr, "Marking content complete"));
      return;
    }
    setCompletedIds((prev) => new Set(prev).add(contentId));
  }

  // content-files is a PRIVATE bucket — students open uploaded files via
  // a time-limited signed URL (gated by the content_files_authenticated_read
  // storage policy), never a public URL. This is unrelated to whether the
  // student is enrolled in this subject — that's already enforced above,
  // by content_select RLS only ever returning this row in the first place.
  async function handleOpenContent(c: ContentRow) {
    if (!supabase || !c.file_url) return;
    setMarkError(null);
    setOpeningId(c.id);
    const { data, error } = await supabase.storage.from("content-files").createSignedUrl(c.file_url, 3600);
    setOpeningId(null);
    if (error || !data?.signedUrl) {
      setMarkError("Couldn't open this file. Please try again.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noreferrer");
  }

  const topicsForUnit = (unitId: string) => topics.filter((t) => t.unit_id === unitId);
  const contentForTopic = (topicId: string) => content.filter((c) => c.topic_id === topicId);

  // Subject-level aggregate = average of this subject's own topic
  // percent_done values (0 for topics with no progress row yet). This is
  // CONTENT completion, never a test score — the two are shown
  // separately and never mixed into one number.
  const subjectAggregatePct =
    topics.length > 0
      ? Math.round(topics.reduce((sum, t) => sum + (topicProgress.get(t.id) ?? 0), 0) / topics.length)
      : null;

  const totalAttendance = attendanceRows?.length ?? 0;
  const presentCount = attendanceRows?.filter((a) => a.status === "present").length ?? 0;
  const absentCount = attendanceRows?.filter((a) => a.status === "absent").length ?? 0;
  const lateCount = attendanceRows?.filter((a) => a.status === "late").length ?? 0;
  const excusedCount = attendanceRows?.filter((a) => a.status === "excused").length ?? 0;
  const attendancePct = totalAttendance > 0 ? Math.round((presentCount / totalAttendance) * 1000) / 10 : null;
  const markByAssessmentId = new Map(iaMarks.map((m) => [m.ia_assessment_id, m.marks_obtained]));
  const sortedAssessments = [...assessments].sort((a, b) => a.ia_number - b.ia_number);

  return (
    <div>
      <PageHeader
        title={subjectMeta?.name ?? "Subject"}
        subtitle={teacherName ? `Taught by ${teacherName}` : "Units, topics, and learning content."}
        action={
          subjectAggregatePct !== null ? (
            <div className="text-right">
              <p className="font-mono text-[11px] uppercase tracking-widest text-inkmuted">Content progress</p>
              <p className="font-display text-xl font-semibold text-ink">{subjectAggregatePct}%</p>
            </div>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {(["overview", "content", "ia", "attendance"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium capitalize ${tab === t ? "bg-copper text-white" : "border border-line text-ink"}`}
          >
            {t === "ia" ? "IA" : t === "content" ? "Units & Content" : t}
          </button>
        ))}
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {markError && <p className="mb-4 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{markError}</p>}

      {!error && tab === "overview" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-panel p-4">
            <p className="font-display text-sm font-semibold text-ink">{subjectMeta?.name ?? "—"}</p>
            <p className="mt-1 font-mono text-xs text-inkmuted">
              {subjectMeta?.code ?? "No code"} {subjectMeta?.credits ? `· ${subjectMeta.credits} credits` : ""}
            </p>
            <p className="mt-2 text-sm text-inkmuted">Teacher: {teacherName ?? "Not yet assigned"}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-line bg-panel p-3 text-center">
              <p className="font-display text-lg font-semibold text-ink">{subjectAggregatePct ?? "—"}{subjectAggregatePct !== null ? "%" : ""}</p>
              <p className="text-[10px] uppercase tracking-wide text-inkmuted">Content Progress</p>
            </div>
            <div className="rounded-lg border border-line bg-panel p-3 text-center">
              <p className="font-display text-lg font-semibold text-ink">{attendancePct !== null ? `${attendancePct}%` : "—"}</p>
              <p className="text-[10px] uppercase tracking-wide text-inkmuted">Attendance</p>
            </div>
            <div className="rounded-lg border border-line bg-panel p-3 text-center">
              <p className="font-display text-lg font-semibold text-ink">{assessments.length > 0 ? `${sortedAssessments.filter((a) => markByAssessmentId.has(a.id)).length}/${assessments.length}` : "—"}</p>
              <p className="text-[10px] uppercase tracking-wide text-inkmuted">IA Entered</p>
            </div>
          </div>
        </div>
      )}

      {!error && tab === "ia" && (
        sortedAssessments.length === 0 ? (
          <EmptyState title="No IA assessments configured yet." message="Your Super Admin hasn't configured IA for this subject yet." />
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:max-w-md">
            {sortedAssessments.map((a) => {
              const mark = markByAssessmentId.get(a.id);
              return (
                <div key={a.id} className="rounded-md bg-panel border border-line p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-inkmuted">IA {a.ia_number}</p>
                  <p className="mt-1 text-sm font-medium text-ink">{mark !== undefined ? `${mark} / ${a.max_marks}` : "Not entered yet"}</p>
                </div>
              );
            })}
          </div>
        )
      )}

      {!error && tab === "attendance" && (
        totalAttendance === 0 ? (
          <EmptyState title="No attendance recorded yet." message="Once your teacher starts recording attendance for this subject, it will appear here." />
        ) : (
          <div>
            <div className="mb-4 rounded-lg border border-line bg-panel p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-inkmuted">Subject Attendance</p>
              <p className="font-display text-3xl font-semibold text-ink">{attendancePct}%</p>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-sm sm:max-w-sm">
              <div><p className="text-ink">{presentCount}</p><p className="text-xs text-inkmuted">Present</p></div>
              <div><p className="text-ink">{absentCount}</p><p className="text-xs text-inkmuted">Absent</p></div>
              <div><p className="text-ink">{lateCount}</p><p className="text-xs text-inkmuted">Late</p></div>
              <div><p className="text-ink">{excusedCount}</p><p className="text-xs text-inkmuted">Excused</p></div>
            </div>
          </div>
        )
      )}

      {!error && tab === "content" && units === null && <LoadingState label="Loading subject…" />}
      {!error && tab === "content" && units !== null && units.length === 0 && (
        <EmptyState title="No units yet" message="Your teacher hasn't added units for this subject yet." />
      )}

      {!error && tab === "content" && units !== null && units.length > 0 && (
        <div className="space-y-4">
          {units.map((unit) => (
            <div key={unit.id} className="rounded-lg border border-line bg-panel p-4">
              <p className="font-display text-sm font-semibold text-ink">{unit.name}</p>
              {topicsForUnit(unit.id).length === 0 && (
                <p className="mt-1 text-xs text-inkmuted">No topics yet.</p>
              )}
              <div className="mt-2 space-y-3">
                {topicsForUnit(unit.id).map((topic) => (
                  <div key={topic.id} className="ml-3 border-l border-line pl-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-ink">{topic.name}</p>
                      <span className="shrink-0 font-mono text-[10px] text-inkmuted">
                        {topicProgress.get(topic.id) ?? 0}% complete
                      </span>
                    </div>
                    <Link to={studyUrl({ subject: subjectId, unit: unit.id, topic: topic.id })} className="mt-1 inline-block text-xs font-medium text-copper-dark hover:underline">Study this topic →</Link>
                    <div className="mt-1 h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-paper">
                      <div
                        className="h-full rounded-full bg-trace"
                        style={{ width: `${topicProgress.get(topic.id) ?? 0}%` }}
                      />
                    </div>
                    {contentForTopic(topic.id).length === 0 ? (
                      <p className="text-xs text-inkmuted">No content published yet.</p>
                    ) : (
                      <ul className="mt-1 space-y-1.5">
                        {contentForTopic(topic.id).map((c) => {
                          const isDone = completedIds.has(c.id);
                          const isUploadedFile = !!c.file_url;
                          return (
                            <li key={c.id} className="flex items-center justify-between gap-2">
                              {isUploadedFile ? (
                                <button
                                  onClick={() => handleOpenContent(c)}
                                  disabled={openingId === c.id}
                                  className="inline-flex items-center gap-1.5 text-sm text-copper-dark hover:underline disabled:opacity-60"
                                >
                                  <span className="font-mono text-[10px] uppercase text-inkmuted">{c.type}</span>
                                  {openingId === c.id ? "Opening…" : c.title}
                                </button>
                              ) : (
                                <a
                                  href={c.external_url ?? "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 text-sm text-copper-dark hover:underline"
                                >
                                  <span className="font-mono text-[10px] uppercase text-inkmuted">{c.type}</span>
                                  {c.title}
                                </a>
                              )}
                              <button
                                onClick={() => handleMarkComplete(c.id)}
                                disabled={isDone || markingId === c.id}
                                className={
                                  isDone
                                    ? "rounded-full bg-trace-light px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-trace-dark"
                                    : "rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-ink hover:border-copper hover:text-copper-dark disabled:opacity-50"
                                }
                              >
                                {isDone ? "✓ Completed" : markingId === c.id ? "Saving…" : "Mark Complete"}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
