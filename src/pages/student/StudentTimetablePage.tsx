import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { DAY_SHORT } from "../../lib/timetableSlots";

interface Entry {
  id: string;
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
const DAYS = [1, 2, 3, 4, 5, 6];

// RLS (timetable_entries_select) already limits reads to the
// student's own current section — this page additionally personalizes
// lab periods to the student's own assigned batch
// (student_lab_batch_assignments), so a student in A2 never sees A1's
// lab details as if it were their own class.
export function StudentTimetablePage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectionName, setSectionName] = useState<string | null>(null);
  const [myBatchId, setMyBatchId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [subjects, setSubjects] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [teachers, setTeachers] = useState<{ id: string; full_name: string; email: string }[]>([]);
  const [batches, setBatches] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    async function load() {
      if (!supabase || !profile) return;
      setError(null);
      const sa = await supabase
        .from("student_assignments")
        .select("section_id, sections(name)")
        .eq("student_id", profile.id)
        .eq("is_current", true)
        .maybeSingle();

      if (sa.error) {
        setLoading(false);
        setError("We couldn't load your timetable. Please try again.");
        return;
      }
      if (!sa.data) {
        setLoading(false);
        return;
      }
      const sectionId = sa.data.section_id as string;
      setSectionName(first<{ name: string }>(sa.data.sections)?.name ?? null);

      const [batchRow, ent, subj, t, lb] = await Promise.all([
        supabase.from("student_lab_batch_assignments").select("lab_batch_id").eq("student_id", profile.id).eq("is_current", true).maybeSingle(),
        supabase
          .from("timetable_entries")
          .select("id, day_of_week, start_time, end_time, subject_id, teacher_id, room, lab_batch_id, block_type, label")
          .eq("section_id", sectionId)
          .eq("is_current", true),
        supabase.from("subjects").select("id, name, code"),
        supabase.from("users").select("id, full_name, email").eq("role", "teacher"),
        supabase.from("lab_batches").select("id, name"),
      ]);
      setLoading(false);
      if (ent.error) {
        setError("We couldn't load your timetable. Please try again.");
        return;
      }
      setMyBatchId(batchRow.data?.lab_batch_id ?? null);
      setEntries((ent.data ?? []) as Entry[]);
      setSubjects(subj.data ?? []);
      setTeachers(t.data ?? []);
      setBatches(lb.data ?? []);
    }
    load();
  }, [profile]);

  const visibleEntries = useMemo(
    () => entries.filter((e) => e.block_type !== "lab" || (myBatchId && e.lab_batch_id === myBatchId)),
    [entries, myBatchId]
  );

  const rows = useMemo(() => {
    const seen = new Map<string, { start: string; end: string }>();
    visibleEntries.forEach((e) => seen.set(`${e.start_time}-${e.end_time}`, { start: e.start_time, end: e.end_time }));
    return Array.from(seen.values()).sort((a, b) => a.start.localeCompare(b.start));
  }, [visibleEntries]);

  function describe(e: Entry) {
    const subject = subjects.find((s) => s.id === e.subject_id);
    const teacher = teachers.find((t) => t.id === e.teacher_id);
    const batch = batches.find((b) => b.id === e.lab_batch_id);
    if (e.block_type === "break") return <span className="text-inkmuted">{e.label || "Break"}</span>;
    if (e.block_type === "activity" || e.block_type === "other") return <span>{e.label || e.block_type}</span>;
    return (
      <div>
        <p className="font-medium text-ink">
          {subject?.name ?? e.label ?? "—"}{batch ? ` · ${batch.name}` : ""}
        </p>
        {teacher && <p className="text-xs text-inkmuted">{teacher.full_name || teacher.email}</p>}
        {e.room && <p className="text-xs text-inkmuted">{e.room}</p>}
      </div>
    );
  }

  if (error) return <ErrorState message={error} />;
  if (loading) return <LoadingState label="Loading your timetable…" />;

  if (!sectionName) {
    return (
      <div>
        <PageHeader title="My Timetable" />
        <EmptyState title="No section assigned yet" message="Once your Super Admin assigns you to a section, your timetable will appear here." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="My Timetable" subtitle={`Section ${sectionName}${myBatchId ? ` · Batch ${batches.find((b) => b.id === myBatchId)?.name ?? ""}` : ""}`} />

      {visibleEntries.length === 0 ? (
        <EmptyState title="No timetable has been created for this section yet" message="Check back once your Super Admin sets up the schedule." />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-line sm:block">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="border-b border-r border-line bg-paper p-2 text-left text-inkmuted">Time</th>
                  {DAYS.map((d) => <th key={d} className="border-b border-line bg-paper p-2 text-ink">{DAY_SHORT[d]}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.start}-${row.end}`}>
                    <td className="whitespace-nowrap border-r border-b border-line bg-paper p-2 font-mono text-inkmuted">{row.start}–{row.end}</td>
                    {DAYS.map((d) => {
                      const cell = visibleEntries.filter((e) => e.day_of_week === d && e.start_time === row.start && e.end_time === row.end);
                      return (
                        <td key={d} className="min-w-[120px] border-b border-line p-1.5 align-top">
                          {cell.map((e) => <div key={e.id} className="mb-1">{describe(e)}</div>)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <MobileList rows={rows} entries={visibleEntries} describe={describe} />
        </>
      )}
    </div>
  );
}

function MobileList({
  rows,
  entries,
  describe,
}: {
  rows: { start: string; end: string }[];
  entries: Entry[];
  describe: (e: Entry) => React.ReactNode;
}) {
  const [day, setDay] = useState(1);
  return (
    <div className="sm:hidden">
      <div className="mb-3 flex gap-1 overflow-x-auto">
        {DAYS.map((d) => (
          <button key={d} onClick={() => setDay(d)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${day === d ? "bg-copper text-white" : "border border-line text-ink"}`}>
            {DAY_SHORT[d]}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {rows.map((row) => {
          const cell = entries.filter((e) => e.day_of_week === day && e.start_time === row.start && e.end_time === row.end);
          if (cell.length === 0) return null;
          return (
            <div key={`${row.start}-${row.end}`} className="rounded-lg border border-line bg-panel p-3">
              <p className="font-mono text-xs text-inkmuted">{row.start}–{row.end}</p>
              <div className="mt-1 space-y-1">{cell.map((e) => <div key={e.id}>{describe(e)}</div>)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
