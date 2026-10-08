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

    if (e.block_type === "break") return <span className="font-semibold text-amber-800 dark:text-amber-300 text-xs">{e.label || "Break"}</span>;
    if (e.block_type === "activity" || e.block_type === "other") return <span className="font-bold text-xs text-ink leading-tight">{e.label || e.block_type}</span>;

    const isMine = e.teacher_id === profile?.id;
    const subjectDisplay = subject ? (subject.code || subject.name) : (e.label || "—");

    return (
      <div className="flex flex-col items-center justify-center text-center leading-tight w-full">
        <p className={`font-bold text-xs tracking-tight break-words ${isMine ? "text-copper-dark" : "text-ink"}`}>
          {subjectDisplay}{batch ? <span className="text-[10px] text-copper-dark font-normal"> · {batch.name}</span> : ""}
        </p>
        {teacher && (
          <p className="mt-1 text-[11px] font-medium text-inkmuted truncate max-w-full" title={teacher.full_name || teacher.email}>
            {teacher.full_name || teacher.email}
          </p>
        )}
        {e.room && (
          <p className="mt-1 text-[10px] font-mono font-semibold text-copper-dark uppercase tracking-wider">
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
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  activeSection === s.id
                    ? "bg-copper text-white shadow-xs"
                    : "border border-line text-ink bg-panel hover:border-copper"
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
              {/* Desktop / Tablet Official Academic Timetable Grid */}
              <div className="hidden sm:block overflow-x-auto rounded-xl border border-line bg-panel shadow-xs">
                <table className="w-full min-w-[1020px] border-collapse text-xs">
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
                              className="w-16 min-w-[56px] max-w-[64px] border-b border-r border-line bg-amber-500/10 p-2 text-center select-none"
                            >
                              <div className="font-bold text-[11px] text-amber-900 dark:text-amber-200 uppercase tracking-widest">
                                {col.label}
                              </div>
                              <div className="text-[9px] font-medium text-amber-800/80 dark:text-amber-300/80 whitespace-nowrap mt-0.5">
                                {formatTimeRange12(col.start, col.end)}
                              </div>
                            </th>
                          );
                        }
                        return (
                          <th
                            key={idx}
                            className="min-w-[125px] border-b border-r border-line p-2 text-center"
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
                        {/* Day Column */}
                        <td className="border-b border-r border-line bg-paper/40 px-3 py-3 text-center font-bold text-xs text-ink uppercase tracking-wider whitespace-nowrap align-middle">
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
                                  className="w-16 min-w-[56px] max-w-[64px] border-b border-r border-line bg-amber-500/5 dark:bg-amber-950/20 text-center align-middle select-none p-0"
                                >
                                  <div className="flex h-full flex-col items-center justify-center py-6">
                                    <span className="font-bold text-xs uppercase tracking-widest text-amber-900 dark:text-amber-200 [writing-mode:vertical-rl] rotate-180">
                                      {col.label}
                                    </span>
                                  </div>
                                </td>
                              );
                            }
                            return null;
                          }

                          // Regular Period Slot with robust content-driven sizing
                          const cellEntries = entriesForSlot(d, col.start, col.end);
                          return (
                            <td
                              key={colIdx}
                              className="min-w-[125px] max-w-[160px] border-b border-r border-line px-2 py-2.5 align-middle"
                            >
                              {cellEntries.length === 0 ? (
                                <div className="min-h-[76px] w-full" />
                              ) : (
                                <div className="space-y-1.5">
                                  {cellEntries.map((e) => {
                                    const isMine = e.teacher_id === profile?.id;
                                    return (
                                      <div
                                        key={e.id}
                                        className={`w-full min-h-[76px] rounded-md border p-2 text-center flex flex-col justify-center items-center shadow-2xs transition-all ${
                                          isMine
                                            ? "border-copper/80 bg-copper-light/30 ring-1 ring-copper/40"
                                            : "border-line bg-panel"
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

              {/* Mobile Purpose-Built Day Timetable */}
              <MobileDayView
                days={DAYS}
                entriesForSlot={entriesForSlot}
                subjects={subjects}
                teachers={teachers}
                batches={batches}
                profileId={profile?.id}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Compact, purpose-built mobile timetable view (single-level cards, compact break strips, lightweight free periods)
 */
function MobileDayView({
  days,
  entriesForSlot,
  subjects,
  teachers,
  batches,
  profileId,
}: {
  days: number[];
  entriesForSlot: (day: number, start: string, end: string) => Entry[];
  subjects: { id: string; name: string; code: string | null }[];
  teachers: { id: string; full_name: string; email: string }[];
  batches: { id: string; name: string }[];
  profileId?: string;
}) {
  const [day, setDay] = useState(days[0]);

  return (
    <div className="sm:hidden">
      {/* Compact horizontal day selector (single scrollable row, never wraps) */}
      <div className="mb-3.5 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {days.map((d) => (
          <button
            key={d}
            onClick={() => setDay(d)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
              day === d
                ? "bg-copper text-white shadow-xs"
                : "border border-line text-ink bg-panel hover:border-copper"
            }`}
          >
            {DAY_NAMES[d]}
          </button>
        ))}
      </div>

      {/* Purpose-built vertical period list */}
      <div className="space-y-2">
        {OFFICIAL_TIMETABLE_COLUMNS.map((col, idx) => {
          // Compact break strip
          if (col.type === "break") {
            return (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-amber-400/30 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-900 dark:text-amber-200 shadow-2xs"
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <span className="uppercase tracking-wider">{col.label}</span>
                </div>
                <span className="font-mono text-[11px] font-normal text-amber-800/80 dark:text-amber-300">
                  {formatTimeRange12(col.start, col.end)}
                </span>
              </div>
            );
          }

          const cell = entriesForSlot(day, col.start, col.end);

          // Lightweight Free Period Card
          if (cell.length === 0) {
            return (
              <div
                key={idx}
                className="rounded-lg border border-dashed border-line/50 bg-paper/20 px-3.5 py-2 text-xs"
              >
                <div className="flex items-center justify-between text-inkmuted font-medium">
                  <span className="font-bold text-xs text-ink/80">P{col.periodNumber}</span>
                  <span className="font-mono text-[11px]">{formatTimeRange12(col.start, col.end)}</span>
                </div>
                <div className="mt-1">
                  <span className="text-xs text-inkmuted/70 italic">Free period</span>
                </div>
              </div>
            );
          }

          // Single-level compact period card (no nested redundant containers)
          return (
            <div key={idx} className="space-y-1.5">
              {cell.map((e) => {
                const subject = subjects.find((s) => s.id === e.subject_id);
                const teacher = teachers.find((t) => t.id === e.teacher_id);
                const batch = batches.find((b) => b.id === e.lab_batch_id);
                const isMine = e.teacher_id === profileId;
                const subjectDisplay = subject ? (subject.code || subject.name) : (e.label || "—");

                return (
                  <div
                    key={e.id}
                    className={`rounded-lg border p-3 shadow-2xs transition-all ${
                      isMine
                        ? "border-copper/80 bg-copper-light/30 ring-1 ring-copper/40"
                        : "border-line bg-panel"
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-medium text-inkmuted">
                      <span className="font-bold text-xs text-ink">P{col.periodNumber}</span>
                      <span className="font-mono text-[11px]">{formatTimeRange12(col.start, col.end)}</span>
                    </div>
                    <div className="border-t border-line/50 my-2" />
                    <div className="text-center">
                      <div className={`font-bold text-sm tracking-tight ${isMine ? "text-copper-dark" : "text-ink"}`}>
                        {subjectDisplay}
                        {batch ? <span className="text-xs text-copper-dark font-normal"> · {batch.name}</span> : ""}
                      </div>
                      {teacher && (
                        <div className="text-xs font-medium text-inkmuted mt-0.5">
                          {teacher.full_name || teacher.email}
                        </div>
                      )}
                      {e.room && (
                        <div className="text-xs font-mono font-semibold text-copper-dark mt-1 tracking-wide">
                          {e.room}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
