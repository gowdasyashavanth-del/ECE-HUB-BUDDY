import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface Student { id: string; full_name: string; email: string; }
interface Year { id: string; name: string; }
interface Reg { id: string; name: string; academic_year_id: string; }
interface Prog { id: string; name: string; regulation_id: string; }
interface Sem { id: string; number: number; program_id: string; }
interface Sect { id: string; name: string; semester_id: string; academic_year_id: string; }
interface Assignment {
  id: string; student_id: string; academic_year_id: string; regulation_id: string;
  program_id: string; semester_id: string; section_id: string; is_current: boolean; created_at: string;
}

// Reuses the EXISTING student_assignments table exactly as designed —
// no new columns. Reassignment NEVER edits an existing row's academic
// fields; it unsets is_current on the old row and inserts a new one,
// which is what preserves assignment HISTORY (past rows are kept, not
// overwritten or deleted) — the same mechanism already documented in
// 04_assignments_enrollments.sql's comments.
export function StudentAssignmentsPage() {
  const [searchParams] = useSearchParams();
  const preselectedStudent = searchParams.get("student") ?? "";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [regs, setRegs] = useState<Reg[]>([]);
  const [programs, setPrograms] = useState<Prog[]>([]);
  const [semesters, setSemesters] = useState<Sem[]>([]);
  const [sections, setSections] = useState<Sect[]>([]);
  const [allAssignments, setAllAssignments] = useState<Assignment[]>([]);

  const [studentId, setStudentId] = useState(preselectedStudent);
  const [yearId, setYearId] = useState("");
  const [regId, setRegId] = useState("");
  const [progId, setProgId] = useState("");
  const [semId, setSemId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase) return;
    setLoadError(null);
    setLoading(true);
    const [st, y, r, p, s, sec, asg] = await Promise.all([
      supabase.from("users").select("id, full_name, email").eq("role", "student").order("full_name"),
      supabase.from("academic_years").select("id, name").order("name"),
      supabase.from("regulations").select("id, name, academic_year_id"),
      supabase.from("programs").select("id, name, regulation_id"),
      supabase.from("semesters").select("id, number, program_id"),
      supabase.from("sections").select("id, name, semester_id, academic_year_id"),
      supabase.from("student_assignments").select("id, student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current, created_at"),
    ]);
    const firstErr = [st, y, r, p, s, sec, asg].find((res) => res.error);
    setLoading(false);
    if (firstErr?.error) {
      setLoadError(friendlyDbError(firstErr.error, "Assignment data"));
      return;
    }
    setStudents(st.data ?? []);
    setYears(y.data ?? []);
    setRegs(r.data ?? []);
    setPrograms(p.data ?? []);
    setSemesters(s.data ?? []);
    setSections(sec.data ?? []);
    setAllAssignments((asg.data ?? []) as Assignment[]);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const filteredRegs = useMemo(() => regs.filter((r) => r.academic_year_id === yearId), [regs, yearId]);
  const filteredPrograms = useMemo(() => programs.filter((p) => p.regulation_id === regId), [programs, regId]);
  const filteredSemesters = useMemo(() => semesters.filter((s) => s.program_id === progId), [semesters, progId]);
  const filteredSections = useMemo(
    () => sections.filter((s) => s.semester_id === semId && s.academic_year_id === yearId),
    [sections, semId, yearId]
  );

  const studentAssignments = useMemo(
    () => allAssignments.filter((a) => a.student_id === studentId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [allAssignments, studentId]
  );
  const currentAssignment = studentAssignments.find((a) => a.is_current);

  function breadcrumbFor(a: Assignment): string {
    const year = years.find((y) => y.id === a.academic_year_id);
    const reg = regs.find((r) => r.id === a.regulation_id);
    const prog = programs.find((p) => p.id === a.program_id);
    const sem = semesters.find((s) => s.id === a.semester_id);
    const sec = sections.find((s) => s.id === a.section_id);
    return `${prog?.name ?? "—"} · ${reg?.name ?? "—"} · ${year?.name ?? "—"} · Sem ${sem?.number ?? "—"} · Section ${sec?.name ?? "—"}`;
  }

  async function handleAssign() {
    if (!supabase) return;
    setFormError(null);
    if (!studentId) return setFormError("Select a student first.");
    if (!yearId || !regId || !progId || !semId || !sectionId) return setFormError("Select the full academic chain.");

    setSaving(true);

    // Unset any existing current assignment first (two sequential
    // calls — same pattern already used for academic_years' "Set
    // current", for the same reason: the DB's partial unique index is
    // what actually enforces "one current row," this just walks
    // toward that state safely).
    if (currentAssignment) {
      const unset = await supabase.from("student_assignments").update({ is_current: false }).eq("id", currentAssignment.id);
      if (unset.error) {
        setSaving(false);
        setFormError(friendlyDbError(unset.error, "Assignment"));
        return;
      }
    }

    const { error } = await supabase.from("student_assignments").insert({
      student_id: studentId,
      academic_year_id: yearId,
      regulation_id: regId,
      program_id: progId,
      semester_id: semId,
      section_id: sectionId,
      is_current: true,
    });
    setSaving(false);
    if (error) {
      setFormError(friendlyDbError(error, "Assignment"));
      return;
    }
    setYearId(""); setRegId(""); setProgId(""); setSemId(""); setSectionId("");
    await loadAll();
  }

  async function handleRemove() {
    if (!supabase || !currentAssignment) return;
    if (!window.confirm("Remove this student's current assignment? They'll lose access to their subjects until reassigned. Their assignment history is kept.")) return;
    setRowError(null);
    const { error } = await supabase.from("student_assignments").update({ is_current: false }).eq("id", currentAssignment.id);
    if (error) {
      setRowError(friendlyDbError(error, "Assignment"));
      return;
    }
    await loadAll();
  }

  const selectClass = "mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none disabled:bg-paper disabled:text-inkmuted";

  return (
    <div>
      <PageHeader
        title="Student Academic Assignments"
        subtitle="Assign or reassign a student to Academic Year → Regulation → Program → Semester → Section. Past assignments are preserved as history, never overwritten."
      />

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}
      {loading && !loadError && <LoadingState label="Loading assignment data…" />}

      {!loading && !loadError && students.length === 0 && (
        <EmptyState title="No students yet" message="Students appear here automatically once they sign up." />
      )}
      {!loading && !loadError && students.length > 0 && years.length === 0 && (
        <EmptyState title="No academic structure yet" message="Set up Academic Years, Regulations, Programs, Semesters and Sections first." />
      )}

      {!loading && !loadError && students.length > 0 && years.length > 0 && (
        <>
          <div className="mb-6 rounded-lg border border-line bg-panel p-4">
            <label className="block text-xs font-medium text-inkmuted">Student</label>
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className={selectClass}>
              <option value="">Select a student…</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
            </select>
          </div>

          {studentId && (
            <>
              <div className="mb-6 rounded-lg border border-line bg-panel p-4">
                <p className="mb-1 font-display text-sm font-semibold text-ink">Current assignment</p>
                {currentAssignment ? (
                  <div className="mt-2 flex items-center justify-between">
                    <p className="font-mono text-xs text-ink">{breadcrumbFor(currentAssignment)}</p>
                    <button onClick={handleRemove} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger">
                      Remove
                    </button>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-inkmuted">Not currently assigned.</p>
                )}
              </div>

              {rowError && (
                <div className="mb-4">
                  <ErrorState message={rowError} onRetry={() => setRowError(null)} />
                </div>
              )}

              <div className="mb-6 rounded-lg border border-line bg-panel p-4">
                <p className="mb-3 font-display text-sm font-semibold text-ink">
                  {currentAssignment ? "Reassign" : "Assign"}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-inkmuted">Academic Year</label>
                    <select value={yearId} onChange={(e) => { setYearId(e.target.value); setRegId(""); setProgId(""); setSemId(""); setSectionId(""); }} className={selectClass}>
                      <option value="">Select…</option>
                      {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-inkmuted">Regulation</label>
                    <select value={regId} disabled={!yearId} onChange={(e) => { setRegId(e.target.value); setProgId(""); setSemId(""); setSectionId(""); }} className={selectClass}>
                      <option value="">{yearId ? "Select…" : "Select academic year first"}</option>
                      {filteredRegs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-inkmuted">Program</label>
                    <select value={progId} disabled={!regId} onChange={(e) => { setProgId(e.target.value); setSemId(""); setSectionId(""); }} className={selectClass}>
                      <option value="">{regId ? "Select…" : "Select regulation first"}</option>
                      {filteredPrograms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-inkmuted">Semester</label>
                    <select value={semId} disabled={!progId} onChange={(e) => { setSemId(e.target.value); setSectionId(""); }} className={selectClass}>
                      <option value="">{progId ? "Select…" : "Select program first"}</option>
                      {filteredSemesters.map((s) => <option key={s.id} value={s.id}>Semester {s.number}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-inkmuted">Section</label>
                    <select value={sectionId} disabled={!semId} onChange={(e) => setSectionId(e.target.value)} className={selectClass}>
                      <option value="">{semId ? "Select…" : "Select semester first"}</option>
                      {filteredSections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
                    </select>
                    {semId && filteredSections.length === 0 && (
                      <p className="mt-1 text-xs text-inkmuted">No sections exist for this semester in this academic year yet.</p>
                    )}
                  </div>
                </div>

                {formError && <p className="mt-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}

                <button
                  onClick={handleAssign}
                  disabled={saving || !sectionId}
                  className="mt-4 rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-50"
                >
                  {saving ? "Saving…" : currentAssignment ? "Reassign" : "Assign"}
                </button>
              </div>

              {studentAssignments.length > 1 && (
                <>
                  <p className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">
                    Assignment history
                  </p>
                  <div className="space-y-2">
                    {studentAssignments.filter((a) => !a.is_current).map((a) => (
                      <div key={a.id} className="rounded-lg border border-line bg-paper px-4 py-2.5 opacity-70">
                        <p className="font-mono text-xs text-inkmuted">{breadcrumbFor(a)}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
