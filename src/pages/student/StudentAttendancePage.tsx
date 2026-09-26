import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface Rec {
  id: string;
  subject_id: string;
  attendance_date: string;
  status: "present" | "absent" | "late" | "excused";
}
interface Subject { id: string; name: string; code: string | null; }

// Attendance % here counts ONLY "present" recorded sessions over ALL
// recorded sessions (present+absent+late+excused) — late/excused are
// shown as their own counts but are not folded into "present" unless
// a future requirement says otherwise. This is a percentage of
// RECORDED sessions, not of scheduled timetable periods — there is no
// attendance-session/timetable link in this schema, so "100%" here
// means "100% of the sessions a teacher has actually recorded so far",
// not "never missed a class that was ever scheduled."
export function StudentAttendancePage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<Rec[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  useEffect(() => {
    async function load() {
      if (!supabase || !profile) return;
      setError(null);
      const [rec, subj] = await Promise.all([
        supabase
          .from("attendance_records")
          .select("id, subject_id, attendance_date, status")
          .eq("student_id", profile.id)
          .order("attendance_date", { ascending: false }),
        supabase.from("subjects").select("id, name, code"),
      ]);
      setLoading(false);
      if (rec.error) {
        setError("We couldn't load your attendance. Please try again.");
        return;
      }
      setRecords((rec.data ?? []) as Rec[]);
      setSubjects(subj.data ?? []);
    }
    load();
  }, [profile]);

  const bySubject = useMemo(() => {
    const map = new Map<string, Rec[]>();
    records.forEach((r) => {
      const list = map.get(r.subject_id) ?? [];
      list.push(r);
      map.set(r.subject_id, list);
    });
    return map;
  }, [records]);

  function pct(recs: Rec[]) {
    if (recs.length === 0) return null;
    const present = recs.filter((r) => r.status === "present").length;
    return Math.round((present / recs.length) * 1000) / 10;
  }

  const overallPct = pct(records);

  if (error) return <ErrorState message={error} />;
  if (loading) return <LoadingState label="Loading your attendance…" />;

  return (
    <div>
      <PageHeader title="My Attendance" subtitle="Based on attendance sessions recorded by your teachers so far." />

      {records.length === 0 ? (
        <EmptyState title="No attendance records found." message="Once your teachers start recording attendance, it will appear here." />
      ) : (
        <>
          <div className="mb-5 rounded-lg border border-line bg-panel p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-inkmuted">Overall Attendance</p>
            <p className="font-display text-3xl font-semibold text-ink">{overallPct}%</p>
            <p className="text-xs text-inkmuted">{records.length} recorded session{records.length === 1 ? "" : "s"}</p>
          </div>

          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-inkmuted">Subject-wise</p>
          <div className="mb-6 grid gap-3 sm:grid-cols-2">
            {Array.from(bySubject.entries()).map(([subjectId, recs]) => {
              const subject = subjects.find((s) => s.id === subjectId);
              const present = recs.filter((r) => r.status === "present").length;
              const absent = recs.filter((r) => r.status === "absent").length;
              const late = recs.filter((r) => r.status === "late").length;
              const excused = recs.filter((r) => r.status === "excused").length;
              return (
                <div key={subjectId} className="rounded-lg border border-line bg-panel p-4">
                  <p className="text-sm font-semibold text-ink">{subject?.name ?? "—"}</p>
                  {subject?.code && <p className="font-mono text-xs text-inkmuted">{subject.code}</p>}
                  <div className="mt-2 grid grid-cols-4 gap-1 text-center text-xs">
                    <div><p className="text-ink">{present}</p><p className="text-inkmuted">Present</p></div>
                    <div><p className="text-ink">{absent}</p><p className="text-inkmuted">Absent</p></div>
                    <div><p className="text-ink">{late}</p><p className="text-inkmuted">Late</p></div>
                    <div><p className="text-ink">{excused}</p><p className="text-inkmuted">Excused</p></div>
                  </div>
                  <p className="mt-2 text-sm font-medium text-copper-dark">Attendance: {pct(recs)}%</p>
                </div>
              );
            })}
          </div>

          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-inkmuted">History</p>
          <div className="space-y-1.5">
            {records.map((r) => {
              const subject = subjects.find((s) => s.id === r.subject_id);
              return (
                <div key={r.id} className="flex items-center justify-between rounded-md bg-paper px-3 py-2 text-sm">
                  <span className="text-inkmuted">{new Date(r.attendance_date).toLocaleDateString()}</span>
                  <span className="text-ink">{subject?.name ?? "—"}</span>
                  <span className="capitalize text-ink">{r.status}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
