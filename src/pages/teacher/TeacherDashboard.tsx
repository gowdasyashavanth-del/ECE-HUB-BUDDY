import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { DAY_SHORT } from "../../lib/timetableSlots";

interface AssignmentRow {
  id: string;
  subjects: { name: string; code: string | null } | null;
  sections: {
    name: string;
    academic_years: { name: string } | null;
    semesters: { number: number; programs: { name: string; regulations: { name: string } | null } | null } | null;
  } | null;
}
interface ClassTeacherSection { section_id: string; name: string; breadcrumb: string; }
interface TimetableEntry {
  id: string; section_id: string; day_of_week: number; start_time: string; end_time: string;
  subject_id: string | null; teacher_id: string | null; room: string | null; block_type: string; label: string | null;
}
interface AnnouncementRow { id: string; title: string; created_at: string; }

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
function todayDayOfWeek(): number {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

// Access here is entirely a reflection of teacher_assignments /
// class_teacher_assignments — this component only ever displays what
// RLS already lets this teacher's own queries return. There's no
// separate "authorized subjects/sections" list kept anywhere else that
// could drift from what's actually enforced.
export function TeacherDashboard() {
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [classSections, setClassSections] = useState<ClassTeacherSection[]>([]);
  const [todayEntries, setTodayEntries] = useState<TimetableEntry[] | null>(null);
  const [subjectNames, setSubjectNames] = useState<Record<string, string>>({});
  const [sectionNames, setSectionNames] = useState<Record<string, string>>({});
  const [announcements, setAnnouncements] = useState<AnnouncementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !profile) return;
    let cancelled = false;

    async function load() {
      setError(null);
      const [ta, cta] = await Promise.all([
        supabase!
          .from("teacher_assignments")
          .select("id, section_id, subjects(name, code), sections(name, academic_years(name), semesters(number, programs(name, regulations(name))))")
          .eq("teacher_id", profile!.id),
        supabase!
          .from("class_teacher_assignments")
          .select("section_id, sections(name, semesters(number, programs(name)))")
          .eq("teacher_id", profile!.id)
          .eq("is_current", true),
      ]);

      if (cancelled) return;
      if (ta.error || cta.error) {
        setError(friendlyDbError((ta.error || cta.error)!, "Your assignments"));
        return;
      }
      setAssignments((ta.data ?? []) as unknown as AssignmentRow[]);
      setClassSections(
        (cta.data ?? []).map((r: any) => {
          const sec = first<{ name: string; semesters: any }>(r.sections);
          const sem = sec ? first<{ number: number; programs: any }>(sec.semesters) : null;
          const prog = sem ? first<{ name: string }>(sem.programs) : null;
          return { section_id: r.section_id, name: sec?.name ?? "—", breadcrumb: `${prog?.name ?? "—"} · Sem ${sem?.number ?? "—"}` };
        })
      );

      const allSectionIds = Array.from(new Set([...(ta.data ?? []).map((r: any) => r.section_id), ...(cta.data ?? []).map((r: any) => r.section_id)]));
      if (allSectionIds.length === 0) {
        setTodayEntries([]);
      } else {
        const [ent, subj, sec] = await Promise.all([
          supabase!
            .from("timetable_entries")
            .select("id, section_id, day_of_week, start_time, end_time, subject_id, teacher_id, room, block_type, label")
            .in("section_id", allSectionIds)
            .eq("is_current", true)
            .eq("day_of_week", todayDayOfWeek())
            .order("start_time"),
          supabase!.from("subjects").select("id, name"),
          supabase!.from("sections").select("id, name"),
        ]);
        if (!cancelled) {
          setTodayEntries((ent.data ?? []) as TimetableEntry[]);
          setSubjectNames(Object.fromEntries((subj.data ?? []).map((s: any) => [s.id, s.name])));
          setSectionNames(Object.fromEntries((sec.data ?? []).map((s: any) => [s.id, s.name])));
        }
      }

      const { data: annRows } = await supabase!.from("announcements").select("id, title, created_at").order("created_at", { ascending: false }).limit(3);
      if (!cancelled) setAnnouncements((annRows ?? []) as AnnouncementRow[]);
    }

    load();
    return () => { cancelled = true; };
  }, [profile]);

  if (!profile) return null;

  return (
    <div>
      <PageHeader
        title={`Welcome, ${profile.full_name || profile.email}`}
        subtitle="Your assigned academic areas. You only see and manage what's assigned to you here."
      />

      {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}

      {!error && (
        <>
          {classSections.length > 0 && (
            <div className="mb-6">
              <p className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">Class Teacher</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {classSections.map((cs) => (
                  <div key={cs.section_id} className="rounded-lg border border-copper/40 bg-copper-light/30 p-4">
                    <p className="font-body text-sm font-semibold text-ink">Section {cs.name}</p>
                    <p className="text-xs text-inkmuted">{cs.breadcrumb}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link to="/teacher/attendance" className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper">Class Attendance</Link>
                      <Link to="/teacher/ia" className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper">Class IA</Link>
                      <Link to="/teacher/my-students" className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper">Students</Link>
                      <Link to="/teacher/cr" className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper">CR1 / CR2</Link>
                      <Link to="/teacher/lab-batches" className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper">Lab Batches</Link>
                      <Link to="/teacher/timetable" className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper">Timetable</Link>
                      <Link to="/teacher/announcements" className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper">Announcements</Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">
                Today's Classes ({DAY_SHORT[todayDayOfWeek()]})
              </p>
              <Link to="/teacher/timetable" className="text-xs font-medium text-copper-dark hover:underline">Full Timetable →</Link>
            </div>
            {todayEntries === null ? (
              <LoadingState label="Loading today's schedule…" />
            ) : todayEntries.length === 0 ? (
              <EmptyState title="No classes scheduled for today." message="" />
            ) : (
              <div className="space-y-1.5">
                {todayEntries.map((e) => {
                  const isMine = e.teacher_id === profile.id;
                  return (
                    <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-inkmuted">{e.start_time}–{e.end_time}</span>
                      <span className={isMine ? "font-medium text-ink" : "text-inkmuted"}>
                        {e.block_type === "break" ? (e.label || "Break") : (subjectNames[e.subject_id ?? ""] ?? e.label ?? "—")}
                      </span>
                      <span className="text-xs text-inkmuted">Section {sectionNames[e.section_id] ?? "—"}{e.room ? ` · ${e.room}` : ""}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            <Link to="/teacher/attendance" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Attendance</Link>
            <Link to="/teacher/ia" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">IA Marks</Link>
            <Link to="/teacher/content" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Content</Link>
            <Link to="/teacher/formulas" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Formulas</Link>
            <Link to="/teacher/questions" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Questions</Link>
            <Link to="/teacher/tests" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Tests</Link>
            <Link to="/teacher/students" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Student Performance</Link>
            <Link to="/teacher/announcements" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Announcements</Link>
          </div>

          {announcements !== null && announcements.length > 0 && (
            <div className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">Announcements</p>
                <Link to="/teacher/announcements" className="text-xs font-medium text-copper-dark hover:underline">View All →</Link>
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

          <p className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">My Subjects</p>

          {assignments === null && <LoadingState label="Loading your assignments…" />}

          {assignments !== null && assignments.length === 0 && (
            <EmptyState
              title="No subjects assigned yet"
              message="Your Super Admin hasn't assigned you to any subject/section yet. Once they do, your classes will appear here — you'll only ever see content for what you're assigned to."
            />
          )}

          {assignments !== null && assignments.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {assignments.map((a) => {
                const section = first(a.sections);
                const sem = section ? first(section.semesters) : null;
                const prog = sem ? first(sem.programs) : null;
                const reg = prog ? first(prog.regulations) : null;
                const year = section ? first(section.academic_years) : null;
                return (
                  <Link
                    key={a.id}
                    to={`/teacher/assignments/${a.id}`}
                    className="group block rounded-lg border border-line bg-panel px-4 py-3 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-sm"
                    aria-label={`Open ${a.subjects?.name ?? "assigned subject"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-body text-sm font-semibold text-ink">{a.subjects?.name ?? "Untitled subject"}</p>
                        <p className="mt-1 font-mono text-xs text-inkmuted">{a.subjects?.code ?? "No code"}</p>
                        <p className="mt-2 text-xs text-inkmuted">
                          {prog?.name ?? "—"} · {reg?.name ?? "—"} · {year?.name ?? "—"}
                        </p>
                        <p className="text-xs text-inkmuted">
                          Semester {sem?.number ?? "—"} · Section {section?.name ?? "—"}
                        </p>
                      </div>
                      <span className="mt-1 text-lg text-inkmuted transition group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true">→</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
