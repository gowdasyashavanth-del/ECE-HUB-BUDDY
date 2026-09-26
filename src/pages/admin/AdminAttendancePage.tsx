import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

type Status = "present" | "absent" | "late" | "excused";
const STATUSES: Status[] = ["present", "absent", "late", "excused"];

interface Rec {
  id: string;
  student_id: string;
  section_id: string;
  subject_id: string;
  attendance_date: string;
  status: Status;
  recorded_by: string | null;
  updated_by: string | null;
}
interface AuditRow {
  id: string;
  attendance_id: string;
  previous_status: string;
  changed_by: string | null;
  changed_at: string;
}

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export function AdminAttendancePage() {
  const [tab, setTab] = useState<"records" | "audit">("records");

  const [years, setYears] = useState<{ id: string; name: string }[]>([]);
  const [semesters, setSemesters] = useState<{ id: string; number: number; program_id: string }[]>([]);
  const [programs, setPrograms] = useState<{ id: string; regulation_id: string }[]>([]);
  const [regs, setRegs] = useState<{ id: string; academic_year_id: string }[]>([]);
  const [sections, setSections] = useState<{ id: string; name: string; semester_id: string; academic_year_id: string }[]>([]);
  const [subjects, setSubjects] = useState<{ id: string; name: string; semester_id: string }[]>([]);
  const [users, setUsers] = useState<{ id: string; full_name: string; email: string; role: string; usn: string | null }[]>([]);

  const [records, setRecords] = useState<Rec[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [yearId, setYearId] = useState("");
  const [semId, setSemId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<Status>("present");
  const [rowError, setRowError] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase) return;
    setError(null);
    setLoading(true);
    const [y, r, p, s, sec, subj, u, rec, aud] = await Promise.all([
      supabase.from("academic_years").select("id, name"),
      supabase.from("regulations").select("id, academic_year_id"),
      supabase.from("programs").select("id, regulation_id"),
      supabase.from("semesters").select("id, number, program_id"),
      supabase.from("sections").select("id, name, semester_id, academic_year_id"),
      supabase.from("subjects").select("id, name, semester_id"),
      supabase.from("users").select("id, full_name, email, role, usn"),
      supabase.from("attendance_records").select("id, student_id, section_id, subject_id, attendance_date, status, recorded_by, updated_by").order("attendance_date", { ascending: false }),
      supabase.from("attendance_audit_log").select("id, attendance_id, previous_status, changed_by, changed_at").order("changed_at", { ascending: false }),
    ]);
    setLoading(false);
    const firstErr = [y, r, p, s, sec, subj, u, rec, aud].find((x) => x.error);
    if (firstErr?.error) {
      setError(friendlyDbError(firstErr.error, "Attendance data"));
      return;
    }
    setYears(y.data ?? []);
    setRegs(r.data ?? []);
    setPrograms(p.data ?? []);
    setSemesters(s.data ?? []);
    setSections(sec.data ?? []);
    setSubjects(subj.data ?? []);
    setUsers(u.data ?? []);
    setRecords((rec.data ?? []) as Rec[]);
    setAuditRows((aud.data ?? []) as AuditRow[]);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const teachers = useMemo(() => users.filter((u) => u.role === "teacher"), [users]);
  const students = useMemo(() => users.filter((u) => u.role === "student"), [users]);

  const filteredSemesters = useMemo(() => {
    if (!yearId) return semesters;
    const progIds = new Set(regs.filter((r) => r.academic_year_id === yearId).flatMap((r) => programs.filter((p) => p.regulation_id === r.id).map((p) => p.id)));
    return semesters.filter((s) => progIds.has(s.program_id));
  }, [semesters, programs, regs, yearId]);
  const filteredSections = useMemo(
    () => sections.filter((s) => (!yearId || s.academic_year_id === yearId) && (!semId || s.semester_id === semId)),
    [sections, yearId, semId]
  );
  const filteredSubjects = useMemo(() => subjects.filter((s) => !semId || s.semester_id === semId), [subjects, semId]);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (sectionId && r.section_id !== sectionId) return false;
      if (subjectId && r.subject_id !== subjectId) return false;
      if (studentId && r.student_id !== studentId) return false;
      if (status && r.status !== status) return false;
      if (dateFrom && r.attendance_date < dateFrom) return false;
      if (dateTo && r.attendance_date > dateTo) return false;
      if (teacherId && r.recorded_by !== teacherId && r.updated_by !== teacherId) return false;
      if (!sectionId) {
        const sec = sections.find((s) => s.id === r.section_id);
        if (yearId && sec?.academic_year_id !== yearId) return false;
        if (semId && sec?.semester_id !== semId) return false;
      }
      return true;
    });
  }, [records, sections, sectionId, subjectId, studentId, status, dateFrom, dateTo, teacherId, yearId, semId]);

  const summary = useMemo(() => {
    const total = filteredRecords.length;
    const present = filteredRecords.filter((r) => r.status === "present").length;
    const absent = filteredRecords.filter((r) => r.status === "absent").length;
    const late = filteredRecords.filter((r) => r.status === "late").length;
    const excused = filteredRecords.filter((r) => r.status === "excused").length;
    const pct = total > 0 ? Math.round((present / total) * 1000) / 10 : 0;
    return { total, present, absent, late, excused, pct };
  }, [filteredRecords]);

  const filteredAudit = useMemo(() => {
    const relevantIds = new Set(filteredRecords.map((r) => r.id));
    return auditRows.filter((a) => relevantIds.has(a.attendance_id));
  }, [auditRows, filteredRecords]);

  function userLabel(id: string | null) {
    if (!id) return "—";
    const u = users.find((x) => x.id === id);
    return u ? u.full_name || u.email : "—";
  }

  async function confirmEdit(rec: Rec) {
    if (!supabase) return;
    setRowError(null);
    const { error } = await supabase.from("attendance_records").update({ status: editStatus }).eq("id", rec.id);
    if (error) {
      setRowError(friendlyDbError(error, "Attendance record"));
      return;
    }
    setEditingId(null);
    await loadAll();
  }

  if (error) return <ErrorState message={error} onRetry={loadAll} />;
  if (loading) return <LoadingState label="Loading attendance…" />;

  return (
    <div>
      <PageHeader title="Attendance" subtitle="All attendance across the institution." />

      <div className="mb-4 flex gap-2">
        <button onClick={() => setTab("records")} className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === "records" ? "bg-copper text-white" : "border border-line text-ink"}`}>Records</button>
        <button onClick={() => setTab("audit")} className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === "audit" ? "bg-copper text-white" : "border border-line text-ink"}`}>Correction Audit</button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <select value={yearId} onChange={(e) => { setYearId(e.target.value); setSemId(""); setSectionId(""); }} className={selectCls}>
          <option value="">Year</option>
          {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
        <select value={semId} onChange={(e) => { setSemId(e.target.value); setSectionId(""); }} className={selectCls}>
          <option value="">Semester</option>
          {filteredSemesters.map((s) => <option key={s.id} value={s.id}>Sem {s.number}</option>)}
        </select>
        <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={selectCls}>
          <option value="">Section</option>
          {filteredSections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
        </select>
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className={selectCls}>
          <option value="">Subject</option>
          {filteredSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className={selectCls}>
          <option value="">Teacher</option>
          {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name || t.email}</option>)}
        </select>
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className={selectCls}>
          <option value="">Student</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.usn ? `${s.full_name || s.email} (${s.usn})` : (s.full_name || s.email)}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={selectCls} title="From date" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={selectCls} title="To date" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
          <option value="">Status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat label="Total" value={summary.total} />
        <Stat label="Present" value={summary.present} />
        <Stat label="Absent" value={summary.absent} />
        <Stat label="Late" value={summary.late} />
        <Stat label="Excused" value={summary.excused} />
        <Stat label="Attendance %" value={`${summary.pct}%`} />
      </div>

      {rowError && <p className="mb-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{rowError}</p>}

      {tab === "records" ? (
        filteredRecords.length === 0 ? (
          <EmptyState title="No attendance records found." message="Adjust your filters or check back once teachers have recorded attendance." />
        ) : (
          <div className="space-y-1.5">
            {filteredRecords.slice(0, 200).map((r) => {
              const student = users.find((u) => u.id === r.student_id);
              const subject = subjects.find((s) => s.id === r.subject_id);
              const section = sections.find((s) => s.id === r.section_id);
              const isEditing = editingId === r.id;
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm">
                  <div className="flex flex-wrap gap-3">
                    <span className="text-inkmuted">{new Date(r.attendance_date).toLocaleDateString()}</span>
                    <span className="text-ink">{student?.full_name || student?.email}</span>
                    {student?.usn && <span className="font-mono text-xs text-inkmuted">{student.usn}</span>}
                    <span className="text-inkmuted">Section {section?.name}</span>
                    <span className="text-inkmuted">{subject?.name}</span>
                  </div>
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as Status)} className={selectCls}>
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button onClick={() => confirmEdit(r)} className="rounded-md bg-copper px-2.5 py-1 text-xs font-medium text-white">Save</button>
                      <button onClick={() => setEditingId(null)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="capitalize text-ink">{r.status}</span>
                      <button onClick={() => { setEditingId(r.id); setEditStatus(r.status); }} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper">
                        Correct
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredRecords.length > 200 && (
              <p className="pt-2 text-center text-xs text-inkmuted">Showing first 200 of {filteredRecords.length} matching records — narrow your filters to see more precisely.</p>
            )}
          </div>
        )
      ) : filteredAudit.length === 0 ? (
        <EmptyState title="No correction history found." message="Corrections will appear here once a recorded status is changed." />
      ) : (
        <div className="space-y-1.5">
          {filteredAudit.map((a) => {
            const rec = records.find((r) => r.id === a.attendance_id);
            const student = rec ? users.find((u) => u.id === rec.student_id) : null;
            const subject = rec ? subjects.find((s) => s.id === rec.subject_id) : null;
            return (
              <div key={a.id} className="rounded-md border border-line bg-panel px-3 py-2 text-sm">
                <div className="flex flex-wrap gap-3">
                  <span className="text-ink">{student?.full_name || student?.email || "—"}</span>
                  {student?.usn && <span className="font-mono text-xs text-inkmuted">{student.usn}</span>}
                  <span className="text-inkmuted">{subject?.name ?? "—"}</span>
                  <span className="text-inkmuted">{rec ? new Date(rec.attendance_date).toLocaleDateString() : "—"}</span>
                </div>
                <p className="mt-1 text-inkmuted">
                  <span className="capitalize">{a.previous_status}</span> → <span className="capitalize text-ink">{rec?.status ?? "—"}</span>
                  {" · changed by "}{userLabel(a.changed_by)}
                  {" · "}{new Date(a.changed_at).toLocaleString()}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const selectCls = "rounded-md border border-line bg-paper px-2 py-1.5 text-xs text-ink";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-2.5 text-center">
      <p className="font-display text-lg font-semibold text-ink">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-inkmuted">{label}</p>
    </div>
  );
}
