import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import {
  OFFICIAL_TIMETABLE_COLUMNS,
  TIMETABLE_DAYS,
  DAY_NAMES,
  rangesOverlap,
  formatTimeRange12,
} from "../../lib/timetableSlots";

interface SectionOption { id: string; name: string; breadcrumb: string; }
interface Entry {
  id: string;
  section_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  subject_id: string | null;
  teacher_id: string | null;
  room: string | null;
  lab_batch_id: string | null;
  block_type: string;
  label: string | null;
}

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const DAYS = TIMETABLE_DAYS; // Monday..Saturday [1, 2, 3, 4, 5, 6]

export function TeacherTimetablePage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [subjects, setSubjects] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [teachers, setTeachers] = useState<{ id: string; full_name: string; email: string }[]>([]);
  const [batches, setBatches] = useState<{ id: string; name: string }[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeSection, setActiveSection] = useState("");

  useEffect(() => {
    async function load() {
      if (!supabase || !profile) return;
      setError(null);
      const [ta, cta, ent] = await Promise.all([
        supabase
          .from("teacher_assignments")
          .select("section_id, sections(name, semesters(number, programs(name, regulations(name, academic_years(name)))))")
          .eq("teacher_id", profile.id),
        supabase
          .from("class_teacher_assignments")
          .select("section_id, sections(name, semesters(number, programs(name, regulations(name, academic_years(name)))))")
          .eq("teacher_id", profile.id)
          .eq("is_current", true),
        supabase
          .from("timetable_entries")
          .select("id, section_id, day_of_week, start_time, end_time, subject_id, teacher_id, room, lab_batch_id, block_type, label")
          .eq("is_current", true),
      ]);
      setLoading(false);
      if (ta.error || cta.error || ent.error) {
        setError("We couldn't load your timetable. Please try again.");
        return;
      }
      const uniqueSections = new Map<string, SectionOption>();
      [...(ta.data ?? []), ...(cta.data ?? [])].forEach((row: any) => {
        const sec = first<{ name: string; semesters: any }>(row.sections);
        const sem = sec ? first<{ number: number; programs: any }>(sec.semesters) : null;
        const prog = sem ? first<{ name: string }>(sem.programs) : null;
        uniqueSections.set(row.section_id, {
          id: row.section_id,
          name: sec?.name ?? "—",
          breadcrumb: `${prog?.name ?? "—"} · Sem ${sem?.number ?? "—"}`,
        });
      });
      const secList = Array.from(uniqueSections.values());
      setSections(secList);
      setActiveSection((prev) => prev || secList[0]?.id || "");
      setEntries((ent.data ?? []) as Entry[]);

      const [subj, t, lb] = await Promise.all([
        supabase.from("subjects").select("id, name, code"),
        supabase.from("users").select("id, full_name, email").eq("role", "teacher"),
        supabase.from("lab_batches").select("id, name"),
      ]);
      setSubjects(subj.data ?? []);
      setTeachers(t.data ?? []);
      setBatches(lb.data ?? []);
    }
    load();
  }, [profile]);

  const activeEntries = useMemo(() => entries.filter((e) => e.section_id === activeSection), [entries, activeSection]);

  function entriesForSlot(day: number, start: string, end: string) {
    return activeEntries.filter(
      (e) => e.day_of_week === day && rangesOverlap(e.start_time.slice(0, 5), e.end_time.slice(0, 5), start, end)
    );
  }

  function describe(e: Entry) {
    const subject = subjects.find((s) => s.id === e.subject_id);
    const teacher = teachers.find((t) => t.id === e.teacher_id);
    const batch = batches.find((b) => b.id === e.lab_batch_id);

    if (e.block_type === "break") return <span className="font-semibold text-amber-800 dark:text-amber-300">{e.label || "Break"}</span>;
    if (e.block_type === "activity" || e.block_type === "other") return <span className="font-semibold text-xs text-ink">{e.label || e.block_type}</span>;

    const isMine = e.teacher_id === profile?.id;
    const subjectDisplay = subject ? (subject.code || subject.name) : (e.label || "—");

    return (
      <div className="flex flex-col items-center justify-center text-center leading-tight py-1 w-full">
        <p className={`font-bold text-xs tracking-tight ${isMine ? "text-copper-dark" : "text-ink"}`}>
          {subjectDisplay}{batch ? <span className="text-[10px] text-copper-dark font-normal"> · {batch.name}</span> : ""}
        </p>
        {teacher && (
          <p className="mt-1 text-[11px] font-medium text-inkmuted truncate max-w-full" title={teacher.full_name || teacher.email}>
            {teacher.full_name || teacher.email}
          </p>
        )}
        {e.room && (
          <p className="mt-0.5 text-[10px] font-mono font-medium text-inkmuted/90 uppercase tracking-wide">
            {e.room}
          </p>
        )}
      </div>
    );
  }

  if (error) return <ErrorState message={error} />;
  if (loading) return <LoadingState label="Loading your timetable…" />;

  return (
    <div>
      <PageHeader title="My Timetable" subtitle="Official section schedule grid with your assigned periods highlighted." />

      {sections.length === 0 ? (
        <EmptyState title="No timetable entries are assigned to you yet" message="Once you're assigned to a section and subject, your schedule will appear here." />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  activeSection === s.id ? "bg-copper text-white shadow-xs" : "border border-line text-ink bg-panel hover:border-copper"
                }`}
              >
                Section {s.name}
              </button>
            ))}
          </div>

          {activeEntries.length === 0 ? (
            <EmptyState title="No timetable has been created for this section yet" message="Check back once your Super Admin sets up the schedule." />
          ) : (
            <>
              {/* Official Academic Timetable Grid (Desktop & Tablet Horizontal Scroll) */}
              <div className="hidden sm:block overflow-x-auto rounded-xl border border-line bg-panel shadow-xs">
                <table className="w-full min-w-[980px] border-collapse text-xs">
                  <thead>
                    <tr className="bg-paper/70">
                      <th className="w-28 min-w-[100px] border-b border-r border-line p-2.5 text-center font-bold uppercase tracking-wider text-ink">
                        DAY
                      </th>
                      {OFFICIAL_TIMETABLE_COLUMNS.map((col, idx) => {
                        if (col.type === "break") {
                          return (
                            <th
                              key={col.label}
                              className="w-14 min-w-[56px] max-w-[64px] border-b border-r border-line bg-amber-500/10 p-2 text-center"
                            >
                              <div className="font-bold text-[11px] text-amber-800 dark:text-amber-300 uppercase tracking-wider">
                                {col.label}
                              </div>
                              <div className="text-[9px] font-medium text-amber-700/80 dark:text-amber-400/80 whitespace-nowrap mt-0.5">
                                {formatTimeRange12(col.start, col.end)}
                              </div>
                            </th>
                          );
                        }
                        return (
                          <th
                            key={idx}
                            className="min-w-[120px] border-b border-r border-line p-2 text-center"
                          >
                            <div className="font-semibold text-ink whitespace-nowrap">
                              {formatTimeRange12(col.start, col.end)}
                            </div>
                            <div className="text-[10px] font-medium text-inkmuted uppercase tracking-wider mt-0.5">
                              {col.label}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map((d, dayIdx) => (
                      <tr key={d} className="hover:bg-paper/20 transition-colors">
                        {/* Day label column */}
                        <td className="border-b border-r border-line bg-paper/40 px-3 py-2 text-center font-bold text-ink whitespace-nowrap">
                          {DAY_NAMES[d]}
                        </td>

                        {/* Slots */}
                        {OFFICIAL_TIMETABLE_COLUMNS.map((col, colIdx) => {
                          if (col.type === "break") {
                            if (dayIdx === 0) {
                              return (
                                <td
                                  key={col.label}
                                  rowSpan={DAYS.length}
                                  className="w-14 min-w-[56px] max-w-[64px] border-b border-r border-line bg-amber-500/10 text-center align-middle select-none"
                                >
                                  <div className="flex h-full min-h-[380px] flex-col items-center justify-center py-4">
                                    <span className="font-bold text-[11px] uppercase tracking-widest text-amber-800 dark:text-amber-300 [writing-mode:vertical-rl] rotate-180">
                                      {col.label}
                                    </span>
                                  </div>
                                </td>
                              );
                            }
                            return null;
                          }

                          // Period Slot
                          const cellEntries = entriesForSlot(d, col.start, col.end);
                          return (
                            <td
                              key={colIdx}
                              className="min-w-[120px] max-w-[160px] border-b border-r border-line p-1.5 align-middle"
                            >
                              {cellEntries.length === 0 ? (
                                <div className="min-h-[64px]" />
                              ) : (
                                <div className="space-y-1">
                                  {cellEntries.map((e) => {
                                    const isMine = e.teacher_id === profile?.id;
                                    return (
                                      <div
                                        key={e.id}
                                        className={`w-full rounded border p-2 shadow-xs transition-all ${
                                          isMine
                                            ? "border-copper/80 bg-copper-light/30 ring-1 ring-copper/40"
                                            : "border-line/70 bg-paper/60"
                                        }`}
                                      >
                                        {describe(e)}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile view with 12-hour format */}
              <MobileList
                days={DAYS}
                entriesForSlot={entriesForSlot}
                describe={describe}
                profileId={profile?.id}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function MobileList({
  days,
  entriesForSlot,
  describe,
  profileId,
}: {
  days: number[];
  entriesForSlot: (day: number, start: string, end: string) => Entry[];
  describe: (e: Entry) => React.ReactNode;
  profileId?: string;
}) {
  const [day, setDay] = useState(days[0]);

  return (
    <div className="sm:hidden">
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d}
            onClick={() => setDay(d)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              day === d ? "bg-copper text-white shadow-xs" : "border border-line text-ink bg-panel"
            }`}
          >
            {DAY_NAMES[d]}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {OFFICIAL_TIMETABLE_COLUMNS.map((col, idx) => {
          if (col.type === "break") {
            return (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300"
              >
                <span>{col.label}</span>
                <span className="font-mono text-[11px] font-normal text-amber-700/80 dark:text-amber-400">
                  {formatTimeRange12(col.start, col.end)}
                </span>
              </div>
            );
          }

          const cell = entriesForSlot(day, col.start, col.end);
          return (
            <div key={idx} className="rounded-lg border border-line bg-panel p-3">
              <div className="flex items-center justify-between border-b border-line/40 pb-1.5">
                <span className="text-xs font-medium text-inkmuted uppercase tracking-wider">{col.label}</span>
                <span className="font-mono text-xs text-ink font-semibold">{formatTimeRange12(col.start, col.end)}</span>
              </div>
              {cell.length === 0 ? (
                <p className="mt-2 text-xs text-inkmuted italic">No class</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {cell.map((e) => {
                    const isMine = e.teacher_id === profileId;
                    return (
                      <div
                        key={e.id}
                        className={`rounded border p-2 ${
                          isMine
                            ? "border-copper/80 bg-copper-light/30 ring-1 ring-copper/40"
                            : "border-line/60 bg-paper/60"
                        }`}
                      >
                        {describe(e)}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
