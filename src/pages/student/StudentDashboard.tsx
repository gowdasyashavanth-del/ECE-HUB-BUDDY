import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatCard } from "../../components/ui/StatCard";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { DAY_SHORT } from "../../lib/timetableSlots";
import { UpcomingWidget } from "../../components/planner/UpcomingWidget";
import { StudyCard } from "../../components/study/StudyCard";
import { SmartStudyEntryCard } from "../../components/smartstudy/SmartStudyEntryCard";
import { studyUrl } from "../../lib/study";

interface AcademicContext {
  academic_year_name: string;
  regulation_name: string;
  program_name: string;
  semester_number: number;
  section_name: string;
  semester_id: string;
  section_id: string;
}

interface SubjectRow {
  id: string;
  name: string;
  code: string | null;
  credits: number | null;
}

interface AchievementRow { name: string; icon: string | null; unlocked_at: string; }
interface ResultRow { test_title: string; score: number; total: number; created_at: string; }
interface UnitRow { id: string; subject_id: string; }
interface TopicRow { id: string; unit_id: string; }
interface ProgressRow { topic_id: string; percent_done: number; }
interface Assessment { id: string; subject_id: string; ia_number: number; max_marks: number; }
interface MarkRow { ia_assessment_id: string; marks_obtained: number; }
interface AttendanceRow { status: "present" | "absent" | "late" | "excused"; }
interface TimetableEntry {
  id: string; day_of_week: number; start_time: string; end_time: string;
  subject_id: string | null; teacher_id: string | null; room: string | null;
  lab_batch_id: string | null; block_type: string; label: string | null;
}
interface AnnouncementRow { id: string; title: string; created_at: string; }

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
// JS getDay(): 0=Sunday..6=Saturday. This schema's day_of_week is 1=Monday..7=Sunday
// (see DAY_SHORT / DAY_NAMES in lib/timetableSlots.ts), so Sunday needs remapping.
function todayDayOfWeek(): number {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

export function StudentDashboard() {
  const { profile } = useAuth();
  const [context, setContext] = useState<AcademicContext | null | undefined>(undefined); // undefined = loading
  const [subjects, setSubjects] = useState<SubjectRow[] | null>(null);
  const [subjectTeachers, setSubjectTeachers] = useState<Record<string, string>>({});
  const [achievements, setAchievements] = useState<AchievementRow[]>([]);
  const [recentResults, setRecentResults] = useState<ResultRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [subjectProgress, setSubjectProgress] = useState<Record<string, number> | null>(null);

  const [attendance, setAttendance] = useState<AttendanceRow[] | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [iaMarks, setIaMarks] = useState<MarkRow[]>([]);
  const [todayEntries, setTodayEntries] = useState<TimetableEntry[] | null>(null);
  const [myBatchId, setMyBatchId] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementRow[] | null>(null);

  useEffect(() => {
    if (!supabase || !profile) return;
    let cancelled = false;

    async function loadEngagement() {
      const { data: achRows } = await supabase!
        .from("student_achievements")
        .select("unlocked_at, achievements(name, icon)")
        .order("unlocked_at", { ascending: false });
      if (!cancelled && achRows) {
        setAchievements(
          achRows.map((r: any) => {
            const a = first<{ name: string; icon: string | null }>(r.achievements);
            return { name: a?.name ?? "Achievement", icon: a?.icon ?? null, unlocked_at: r.unlocked_at };
          })
        );
      }

      const { data: resRows } = await supabase!
        .from("results")
        .select("score, total, created_at, tests(title)")
        .order("created_at", { ascending: false })
        .limit(5);
      if (!cancelled && resRows) {
        setRecentResults(
          resRows.map((r: any) => ({
            test_title: first<{ title: string }>(r.tests)?.title ?? "Untitled test",
            score: r.score,
            total: r.total,
            created_at: r.created_at,
          }))
        );
      }

      const { data: annRows } = await supabase!
        .from("announcements")
        .select("id, title, created_at")
        .order("created_at", { ascending: false })
        .limit(3);
      if (!cancelled) setAnnouncements((annRows ?? []) as AnnouncementRow[]);

      const { data: attRows } = await supabase!.from("attendance_records").select("status").eq("student_id", profile!.id);
      if (!cancelled) setAttendance((attRows ?? []) as AttendanceRow[]);
    }

    loadEngagement();
    return () => { cancelled = true; };
  }, [profile]);

  useEffect(() => {
    if (!supabase || !profile) return;
    let cancelled = false;

    async function load() {
      setError(null);
      const { data: assignment, error: assignErr } = await supabase!
        .from("student_assignments")
        .select(
          "semester_id, section_id, academic_years(name), regulations(name), programs(name), semesters(number), sections(name)"
        )
        .eq("student_id", profile!.id)
        .eq("is_current", true)
        .maybeSingle();

      if (cancelled) return;

      if (assignErr) {
        setError("We couldn't load your academic assignment. Please try again.");
        setContext(null);
        return;
      }

      if (!assignment) {
        setContext(null);
        return;
      }

      const firstRel = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
      const year = firstRel<{ name: string }>(assignment.academic_years as never);
      const reg = firstRel<{ name: string }>(assignment.regulations as never);
      const prog = firstRel<{ name: string }>(assignment.programs as never);
      const sem = firstRel<{ number: number }>(assignment.semesters as never);
      const sec = firstRel<{ name: string }>(assignment.sections as never);

      setContext({
        academic_year_name: year?.name ?? "—",
        regulation_name: reg?.name ?? "—",
        program_name: prog?.name ?? "—",
        semester_number: sem?.number ?? 0,
        section_name: sec?.name ?? "—",
        semester_id: assignment.semester_id,
        section_id: assignment.section_id,
      });

      const { data: subjectRows, error: subjErr } = await supabase!
        .from("subjects")
        .select("id, name, code, credits")
        .eq("semester_id", assignment.semester_id)
        .order("order_number", { ascending: true });

      if (cancelled) return;
      if (subjErr) {
        setError("We couldn't load your subjects. Please try again.");
        return;
      }
      setSubjects(subjectRows as SubjectRow[]);

      // Teacher per subject — scoped to this student's own section, since
      // the same subject can have a different teacher in another section.
      // Uses get_my_section_teachers() (migration 34) rather than joining
      // teacher_assignments -> users directly: users RLS has no branch
      // for "student reads a teacher's row", so a plain join would
      // silently come back empty. The RPC is a SECURITY DEFINER function
      // scoped to auth.uid()'s own current section only.
      const [taRes, teacherIdentityRes] = await Promise.all([
        supabase!.from("teacher_assignments").select("subject_id, teacher_id").eq("section_id", assignment.section_id),
        supabase!.rpc("get_my_section_teachers"),
      ]);
      if (!cancelled && taRes.data) {
        const nameByTeacherId = new Map<string, string>((teacherIdentityRes.data ?? []).map((t: any) => [t.teacher_id as string, (t.full_name || t.email) as string]));
        const map: Record<string, string> = {};
        taRes.data.forEach((r: any) => {
          const name = nameByTeacherId.get(r.teacher_id);
          if (name) map[r.subject_id] = name;
        });
        setSubjectTeachers(map);
      }

      // Today's timetable — same section-scoped batch personalization as
      // the full Timetable page, kept lightweight (today only).
      const [ent, batchRow] = await Promise.all([
        supabase!
          .from("timetable_entries")
          .select("id, day_of_week, start_time, end_time, subject_id, teacher_id, room, lab_batch_id, block_type, label")
          .eq("section_id", assignment.section_id)
          .eq("is_current", true)
          .eq("day_of_week", todayDayOfWeek())
          .order("start_time"),
        supabase!.from("student_lab_batch_assignments").select("lab_batch_id").eq("student_id", profile!.id).eq("is_current", true).maybeSingle(),
      ]);
      if (!cancelled) {
        setMyBatchId(batchRow.data?.lab_batch_id ?? null);
        setTodayEntries((ent.data ?? []) as TimetableEntry[]);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [profile]);

  // Content progress (unchanged from prior phase — average of this
  // student's own `progress.percent_done` rows per subject).
  useEffect(() => {
    if (!supabase || !subjects || subjects.length === 0) return;
    let cancelled = false;

    async function loadProgress() {
      const subjectIds = subjects!.map((s) => s.id);
      const { data: unitRows } = await supabase!.from("units").select("id, subject_id").in("subject_id", subjectIds);
      if (cancelled || !unitRows || unitRows.length === 0) {
        if (!cancelled) setSubjectProgress(Object.fromEntries(subjectIds.map((id) => [id, 0])));
        return;
      }
      const units = unitRows as UnitRow[];
      const unitIds = units.map((u) => u.id);

      const { data: topicRows } = await supabase!.from("topics").select("id, unit_id").in("unit_id", unitIds);
      if (cancelled || !topicRows || topicRows.length === 0) {
        if (!cancelled) setSubjectProgress(Object.fromEntries(subjectIds.map((id) => [id, 0])));
        return;
      }
      const topics = topicRows as TopicRow[];
      const topicIds = topics.map((t) => t.id);

      const { data: progressRows } = await supabase!.from("progress").select("topic_id, percent_done").in("topic_id", topicIds);
      if (cancelled) return;
      const progressByTopic = new Map<string, number>((progressRows as ProgressRow[] | null ?? []).map((p) => [p.topic_id, p.percent_done]));

      const unitToSubject = new Map(units.map((u) => [u.id, u.subject_id]));
      const subjectTopicPercents = new Map<string, number[]>();
      for (const t of topics) {
        const subjectId = unitToSubject.get(t.unit_id);
        if (!subjectId) continue;
        const pct = progressByTopic.get(t.id) ?? 0;
        if (!subjectTopicPercents.has(subjectId)) subjectTopicPercents.set(subjectId, []);
        subjectTopicPercents.get(subjectId)!.push(pct);
      }

      const result: Record<string, number> = {};
      for (const subjectId of subjectIds) {
        const percents = subjectTopicPercents.get(subjectId);
        result[subjectId] = percents && percents.length > 0
          ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length)
          : 0;
      }
      setSubjectProgress(result);
    }

    loadProgress();
    return () => { cancelled = true; };
  }, [subjects]);

  // IA — configured assessments + this student's own marks, for the
  // same subject list as above. No formula is computed; raw marks only.
  useEffect(() => {
    if (!supabase || !subjects || subjects.length === 0 || !profile) return;
    let cancelled = false;
    async function loadIa() {
      const subjectIds = subjects!.map((s) => s.id);
      const [a, m] = await Promise.all([
        supabase!.from("ia_assessments").select("id, subject_id, ia_number, max_marks").in("subject_id", subjectIds),
        supabase!.from("ia_marks").select("ia_assessment_id, marks_obtained").eq("student_id", profile!.id),
      ]);
      if (cancelled) return;
      setAssessments((a.data ?? []) as Assessment[]);
      setIaMarks((m.data ?? []) as MarkRow[]);
    }
    loadIa();
    return () => { cancelled = true; };
  }, [subjects, profile]);

  if (!profile) return null;

  const attendancePct = attendance && attendance.length > 0
    ? Math.round((attendance.filter((a) => a.status === "present").length / attendance.length) * 1000) / 10
    : null;

  const visibleTodayEntries = (todayEntries ?? []).filter((e) => e.block_type !== "lab" || (myBatchId && e.lab_batch_id === myBatchId));

  const markByAssessment = new Map(iaMarks.map((m) => [m.ia_assessment_id, m.marks_obtained]));
  const subjectsWithIa = (subjects ?? []).filter((s) => assessments.some((a) => a.subject_id === s.id));

  return (
    <div>
      <PageHeader title={`Welcome, ${profile.full_name || profile.email} 👋`} subtitle="Your semester at a glance." />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="XP" value={profile.xp} />
        <StatCard label="Streak" value={`${profile.streak} days`} />
        <StatCard label="Subjects" value={subjects?.length ?? "—"} />
        <StatCard label="Attendance" value={attendancePct !== null ? `${attendancePct}%` : "—"} />
      </div>

      {(achievements.length > 0 || recentResults.length > 0) && (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {achievements.length > 0 && (
            <div>
              <p className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">Achievements</p>
              <div className="flex flex-wrap gap-2">
                {achievements.map((a, i) => (
                  <span key={i} className="rounded-full bg-copper-light px-3 py-1.5 text-xs font-medium text-copper-dark">
                    {a.icon ?? "🏆"} {a.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {recentResults.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">Recent Results</p>
                <Link to="/student/results" className="text-xs font-medium text-copper-dark hover:underline">
                  View All Results →
                </Link>
              </div>
              <div className="space-y-1.5">
                {recentResults.map((r, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border border-line bg-panel px-3 py-1.5 text-sm">
                    <span className="text-ink">{r.test_title}</span>
                    <span className="font-mono text-xs text-inkmuted">{r.score}/{r.total}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}

      {!error && context === undefined && <LoadingState label="Loading your academic context…" />}

      {!error && context === null && (
        <EmptyState
          title="You haven't been assigned to a section yet"
          message="Your Super Admin needs to assign you to an academic year, semester, and section before your subjects appear here. Contact your college admin office."
        />
      )}

      {!error && context && (
        <>
          <div className="mb-6 rounded-lg border border-line bg-panel px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-widest text-inkmuted">Academic context</p>
            <p className="mt-1 font-body text-sm text-ink">
              {context.program_name} · {context.regulation_name} · {context.academic_year_name} · Semester{" "}
              {context.semester_number} · Section {context.section_name}
            </p>
          </div>

          <SmartStudyEntryCard />

          <StudyCard />

          {/* ── Upcoming academic events (live from planner_events) ── */}
          <UpcomingWidget limit={5} />

          {/* ── Today's timetable ── */}
          <div className="mb-8">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">
                Today's Classes ({DAY_SHORT[todayDayOfWeek()]})
              </p>
              <Link to="/student/timetable" className="text-xs font-medium text-copper-dark hover:underline">Full Timetable →</Link>
            </div>
            {todayEntries === null ? (
              <LoadingState label="Loading today's classes…" />
            ) : visibleTodayEntries.length === 0 ? (
              <EmptyState title="No classes scheduled for today." message="" />
            ) : (
              <div className="space-y-1.5">
                {visibleTodayEntries.map((e) => {
                  const subject = subjects?.find((s) => s.id === e.subject_id);
                  return (
                    <div key={e.id} className="flex items-center justify-between rounded-md border border-line bg-panel px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-inkmuted">{e.start_time}–{e.end_time}</span>
                      <span className="text-ink">{e.block_type === "break" ? (e.label || "Break") : (subject?.name ?? e.label ?? "—")}</span>
                      <span className="text-xs text-inkmuted">{e.room ?? ""}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── IA summary ── */}
          {subjectsWithIa.length > 0 && (
            <div className="mb-8">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">Internal Assessment</p>
                <Link to="/student/ia" className="text-xs font-medium text-copper-dark hover:underline">View All IA →</Link>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {subjectsWithIa.map((s) => {
                  const subjAssessments = assessments.filter((a) => a.subject_id === s.id).sort((a, b) => a.ia_number - b.ia_number);
                  return (
                    <div key={s.id} className="rounded-md border border-line bg-panel px-3 py-2 text-sm">
                      <p className="font-medium text-ink">{s.name}</p>
                      <div className="mt-1 flex flex-wrap gap-3">
                        {subjAssessments.map((a) => {
                          const mark = markByAssessment.get(a.id);
                          return (
                            <span key={a.id} className="text-xs text-inkmuted">
                              IA{a.ia_number}: {mark !== undefined ? `${mark}/${a.max_marks}` : "not entered"}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Announcements ── */}
          {announcements !== null && announcements.length > 0 && (
            <div className="mb-8">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">Announcements</p>
                <Link to="/student/announcements" className="text-xs font-medium text-copper-dark hover:underline">View All →</Link>
              </div>
              <div className="space-y-1.5">
                {announcements.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-md border border-line bg-panel px-3 py-2 text-sm">
                    <span className="text-ink">{a.title}</span>
                    <span className="font-mono text-[10px] text-inkmuted">{new Date(a.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">
            My Subjects
          </p>

          {subjects === null && <LoadingState label="Loading subjects…" />}

          {subjects !== null && subjects.length === 0 && (
            <EmptyState
              title="No subjects added for this semester yet"
              message="Your teachers or admin haven't added subjects for this semester yet. Check back soon."
            />
          )}

          {subjects !== null && subjects.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {subjects.map((s) => (
                <div key={s.id} className="rounded-lg border border-line bg-panel hover:border-copper">
                <Link
                  to={`/student/subjects/${s.id}`}
                  className="block px-4 pb-1 pt-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-body text-sm font-medium text-ink">{s.name}</p>
                    {subjectProgress && subjectProgress[s.id] !== undefined && (
                      <span className="shrink-0 rounded-full bg-trace-light px-2 py-0.5 font-mono text-[10px] text-trace-dark">
                        {subjectProgress[s.id]}% content
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs text-inkmuted">
                    {s.code ?? "No code"} {s.credits ? `· ${s.credits} credits` : ""}
                  </p>
                  {subjectTeachers[s.id] && (
                    <p className="mt-1 text-xs text-inkmuted">{subjectTeachers[s.id]}</p>
                  )}
                  {subjectProgress && subjectProgress[s.id] !== undefined && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-paper">
                      <div
                        className="h-full rounded-full bg-trace"
                        style={{ width: `${subjectProgress[s.id]}%` }}
                      />
                    </div>
                  )}
                </Link>
                <div className="px-4 pb-3">
                  <Link to={studyUrl({ subject: s.id })} className="inline-block py-1 text-xs font-medium text-copper-dark hover:underline">Study →</Link>
                </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
