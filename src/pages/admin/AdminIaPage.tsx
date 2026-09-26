import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

const IA_NUMBERS = [1, 2, 3] as const;

interface Assessment { id: string; subject_id: string; ia_number: number; max_marks: number; }
interface MarkRow {
  id: string;
  ia_assessment_id: string;
  student_id: string;
  marks_obtained: number;
  entered_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// Admin is the only role with write access to ia_assessments
// (ia_assessments_write_admin_only) and has full access to ia_marks —
// this page is the one place configuration and correction both live.
// Every write still goes through the normal authenticated client so
// the existing triggers (max-marks-can't-drop-below-an-existing-mark,
// marks-can't-exceed-max, IA-number-in-1..3) remain the real boundary;
// this page only surfaces their errors legibly.
export function AdminIaPage() {
  const [tab, setTab] = useState<"configuration" | "marks">("configuration");

  const [years, setYears] = useState<{ id: string; name: string }[]>([]);
  const [regs, setRegs] = useState<{ id: string; academic_year_id: string }[]>([]);
  const [programs, setPrograms] = useState<{ id: string; regulation_id: string }[]>([]);
  const [semesters, setSemesters] = useState<{ id: string; number: number; program_id: string }[]>([]);
  const [sections, setSections] = useState<{ id: string; name: string; semester_id: string; academic_year_id: string }[]>([]);
  const [subjects, setSubjects] = useState<{ id: string; name: string; code: string | null; semester_id: string }[]>([]);
  const [users, setUsers] = useState<{ id: string; full_name: string; email: string; role: string; usn: string | null }[]>([]);

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [marks, setMarks] = useState<MarkRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // filters
  const [yearId, setYearId] = useState("");
  const [semId, setSemId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [iaNumber, setIaNumber] = useState<number | "">("");
  const [studentId, setStudentId] = useState("");

  // inline config edit
  const [editingAssessment, setEditingAssessment] = useState<string | null>(null); // `${subjectId}|${ia}`
  const [maxMarksDraft, setMaxMarksDraft] = useState("");

  // inline mark correction
  const [editingMarkId, setEditingMarkId] = useState<string | null>(null);
  const [markDraft, setMarkDraft] = useState("");

  async function loadAll() {
    if (!supabase) return;
    setError(null);
    setLoading(true);
    const [y, r, p, s, sec, subj, u, a, m] = await Promise.all([
      supabase.from("academic_years").select("id, name"),
      supabase.from("regulations").select("id, academic_year_id"),
      supabase.from("programs").select("id, regulation_id"),
      supabase.from("semesters").select("id, number, program_id"),
      supabase.from("sections").select("id, name, semester_id, academic_year_id"),
      supabase.from("subjects").select("id, name, code, semester_id"),
      supabase.from("users").select("id, full_name, email, role, usn"),
      supabase.from("ia_assessments").select("id, subject_id, ia_number, max_marks"),
      supabase.from("ia_marks").select("id, ia_assessment_id, student_id, marks_obtained, entered_by, updated_by, created_at, updated_at"),
    ]);
    setLoading(false);
    const firstErr = [y, r, p, s, sec, subj, u, a, m].find((x) => x.error);
    if (firstErr?.error) {
      setError(friendlyDbError(firstErr.error, "IA data"));
      return;
    }
    setYears(y.data ?? []);
    setRegs(r.data ?? []);
    setPrograms(p.data ?? []);
    setSemesters(s.data ?? []);
    setSections(sec.data ?? []);
    setSubjects(subj.data ?? []);
    setUsers(u.data ?? []);
    setAssessments((a.data ?? []) as Assessment[]);
    setMarks((m.data ?? []) as MarkRow[]);
  }

  useEffect(() => {
    loadAll();
  }, []);

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

  const assessmentById = useMemo(() => new Map(assessments.map((a) => [a.id, a])), [assessments]);

  // ── Configuration tab: one row per subject × IA number, using the
  // subject list narrowed by Year/Semester filters (Section has no
  // bearing on subject-level config, since IA is subject-level by design).
  const configSubjects = useMemo(() => (semId ? filteredSubjects : subjects), [filteredSubjects, subjects, semId]);

  function assessmentFor(subjectId: string, ia: number): Assessment | undefined {
    return assessments.find((a) => a.subject_id === subjectId && a.ia_number === ia);
  }

  async function saveMaxMarks(subjectId: string, ia: number) {
    if (!supabase) return;
    setRowError(null);
    const value = Number(maxMarksDraft);
    if (Number.isNaN(value) || value <= 0) {
      setRowError("Maximum marks must be a positive number.");
      return;
    }
    const existingA = assessmentFor(subjectId, ia);
    const res = existingA
      ? await supabase.from("ia_assessments").update({ max_marks: value }).eq("id", existingA.id)
      : await supabase.from("ia_assessments").insert({ subject_id: subjectId, ia_number: ia, max_marks: value });
    if (res.error) {
      setRowError(friendlyDbError(res.error, "IA assessment"));
      return;
    }
    setEditingAssessment(null);
    await loadAll();
  }

  // ── Marks tab ──
  const filteredMarks = useMemo(() => {
    return marks.filter((mk) => {
      const a = assessmentById.get(mk.ia_assessment_id);
      if (!a) return false;
      if (subjectId && a.subject_id !== subjectId) return false;
      if (iaNumber !== "" && a.ia_number !== iaNumber) return false;
      if (studentId && mk.student_id !== studentId) return false;
      if (semId) {
        const subj = subjects.find((s) => s.id === a.subject_id);
        if (subj?.semester_id !== semId) return false;
      }
      if (yearId) {
        const subj = subjects.find((s) => s.id === a.subject_id);
        const sem = subj ? semesters.find((s) => s.id === subj.semester_id) : null;
        const progIds = new Set(regs.filter((r) => r.academic_year_id === yearId).flatMap((r) => programs.filter((p) => p.regulation_id === r.id).map((p) => p.id)));
        if (!sem || !progIds.has(sem.program_id)) return false;
      }
      if (sectionId) {
        // ia_marks has no section_id directly; approximate via the
        // student's current section rather than inventing a schema field.
        // (Handled by studentsInSection below.)
      }
      return true;
    });
  }, [marks, assessmentById, subjectId, iaNumber, studentId, semId, yearId, subjects, semesters, regs, programs]);

  const [studentsInSection, setStudentsInSection] = useState<Set<string> | null>(null);
  useEffect(() => {
    async function loadSectionRoster() {
      if (!supabase || !sectionId) { setStudentsInSection(null); return; }
      const res = await supabase.from("student_assignments").select("student_id").eq("section_id", sectionId).eq("is_current", true);
      setStudentsInSection(new Set((res.data ?? []).map((r: any) => r.student_id)));
    }
    loadSectionRoster();
  }, [sectionId]);

  const finalFilteredMarks = useMemo(
    () => (studentsInSection ? filteredMarks.filter((mk) => studentsInSection.has(mk.student_id)) : filteredMarks),
    [filteredMarks, studentsInSection]
  );

  const summary = useMemo(() => {
    const total = finalFilteredMarks.length;
    const values = finalFilteredMarks.map((mk) => Number(mk.marks_obtained));
    const avg = total > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / total) * 100) / 100 : null;
    const highest = total > 0 ? Math.max(...values) : null;
    const lowest = total > 0 ? Math.min(...values) : null;
    return { total, avg, highest, lowest };
  }, [finalFilteredMarks]);

  function userLabel(id: string | null) {
    if (!id) return "—";
    const u = users.find((x) => x.id === id);
    return u ? u.full_name || u.email : "—";
  }

  async function confirmMarkEdit(mk: MarkRow, maxMarks: number) {
    if (!supabase) return;
    setRowError(null);
    const value = Number(markDraft);
    if (Number.isNaN(value) || value < 0) {
      setRowError("Marks cannot be negative.");
      return;
    }
    if (value > maxMarks) {
      setRowError(`Marks cannot exceed ${maxMarks}.`);
      return;
    }
    const res = await supabase.from("ia_marks").update({ marks_obtained: value }).eq("id", mk.id);
    if (res.error) {
      setRowError(friendlyDbError(res.error, "IA mark"));
      return;
    }
    setEditingMarkId(null);
    await loadAll();
  }

  if (error) return <ErrorState message={error} onRetry={loadAll} />;
  if (loading) return <LoadingState label="Loading IA data…" />;

  return (
    <div>
      <PageHeader title="IA Management" subtitle="Configure IA assessments and review or correct marks across the institution." />

      <div className="mb-4 flex gap-2">
        <button onClick={() => setTab("configuration")} className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === "configuration" ? "bg-copper text-white" : "border border-line text-ink"}`}>Configuration</button>
        <button onClick={() => setTab("marks")} className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === "marks" ? "bg-copper text-white" : "border border-line text-ink"}`}>Marks</button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <select value={yearId} onChange={(e) => { setYearId(e.target.value); setSemId(""); setSectionId(""); }} className={selectCls}>
          <option value="">Year</option>
          {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
        <select value={semId} onChange={(e) => { setSemId(e.target.value); setSectionId(""); setSubjectId(""); }} className={selectCls}>
          <option value="">Semester</option>
          {filteredSemesters.map((s) => <option key={s.id} value={s.id}>Sem {s.number}</option>)}
        </select>
        {tab === "marks" && (
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={selectCls}>
            <option value="">Section</option>
            {filteredSections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
          </select>
        )}
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className={selectCls}>
          <option value="">Subject</option>
          {filteredSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {tab === "marks" && (
          <>
            <select value={iaNumber} onChange={(e) => setIaNumber(e.target.value ? Number(e.target.value) : "")} className={selectCls}>
              <option value="">IA</option>
              {IA_NUMBERS.map((n) => <option key={n} value={n}>IA {n}</option>)}
            </select>
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className={selectCls}>
              <option value="">Student</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.usn ? `${s.full_name || s.email} (${s.usn})` : (s.full_name || s.email)}</option>)}
            </select>
          </>
        )}
      </div>

      {rowError && <p className="mb-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{rowError}</p>}

      {tab === "configuration" ? (
        configSubjects.length === 0 ? (
          <EmptyState title="No subjects found" message="Adjust your Year/Semester filters, or configure subjects under Academic Structure first." />
        ) : (
          <div className="space-y-2">
            {configSubjects.map((subj) => (
              <div key={subj.id} className="rounded-lg border border-line bg-panel p-3">
                <p className="text-sm font-semibold text-ink">{subj.name}{subj.code ? ` (${subj.code})` : ""}</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {IA_NUMBERS.map((n) => {
                    const a = assessmentFor(subj.id, n);
                    const key = `${subj.id}|${n}`;
                    const isEditing = editingAssessment === key;
                    return (
                      <div key={n} className="rounded-md bg-paper p-2 text-center">
                        <p className="text-[10px] uppercase tracking-wide text-inkmuted">IA {n}</p>
                        {isEditing ? (
                          <div className="mt-1 flex items-center justify-center gap-1">
                            <input
                              type="number"
                              min={0.5}
                              step="0.5"
                              value={maxMarksDraft}
                              onChange={(e) => setMaxMarksDraft(e.target.value)}
                              className="w-16 rounded border border-line px-1 py-0.5 text-xs text-ink"
                              autoFocus
                            />
                            <button onClick={() => saveMaxMarks(subj.id, n)} className="rounded bg-copper px-1.5 py-0.5 text-[10px] font-medium text-white">Save</button>
                            <button onClick={() => setEditingAssessment(null)} className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink">✕</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingAssessment(key); setMaxMarksDraft(a ? String(a.max_marks) : ""); }}
                            className="mt-1 block w-full text-sm font-medium text-ink hover:text-copper-dark"
                          >
                            {a ? `Max: ${a.max_marks}` : "Not configured"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Records" value={summary.total} />
            <Stat label="Average" value={summary.avg ?? "—"} />
            <Stat label="Highest" value={summary.highest ?? "—"} />
            <Stat label="Lowest" value={summary.lowest ?? "—"} />
          </div>

          {finalFilteredMarks.length === 0 ? (
            <EmptyState title="No IA marks found" message="Adjust your filters, or check back once teachers have entered marks." />
          ) : (
            <div className="space-y-1.5">
              {finalFilteredMarks.slice(0, 200).map((mk) => {
                const a = assessmentById.get(mk.ia_assessment_id);
                const subj = a ? subjects.find((s) => s.id === a.subject_id) : null;
                const student = users.find((u) => u.id === mk.student_id);
                const isEditing = editingMarkId === mk.id;
                return (
                  <div key={mk.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm">
                    <div className="flex flex-wrap gap-3">
                      <span className="text-ink">{student?.full_name || student?.email}</span>
                      {student?.usn && <span className="font-mono text-xs text-inkmuted">{student.usn}</span>}
                      <span className="text-inkmuted">{subj?.name ?? "—"}</span>
                      <span className="text-inkmuted">IA {a?.ia_number}</span>
                      <span className="text-inkmuted">Entered by {userLabel(mk.entered_by)}</span>
                      <span className="text-inkmuted">Updated by {userLabel(mk.updated_by)} · {new Date(mk.updated_at).toLocaleString()}</span>
                    </div>
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={a?.max_marks}
                          step="0.5"
                          value={markDraft}
                          onChange={(e) => setMarkDraft(e.target.value)}
                          className="w-20 rounded-md border border-line px-2 py-1 text-xs text-ink"
                          autoFocus
                        />
                        <span className="text-xs text-inkmuted">/ {a?.max_marks}</span>
                        <button onClick={() => confirmMarkEdit(mk, a?.max_marks ?? 0)} className="rounded-md bg-copper px-2.5 py-1 text-xs font-medium text-white">Save</button>
                        <button onClick={() => setEditingMarkId(null)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{mk.marks_obtained} / {a?.max_marks}</span>
                        <button onClick={() => { setEditingMarkId(mk.id); setMarkDraft(String(mk.marks_obtained)); }} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper">
                          Correct
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {finalFilteredMarks.length > 200 && (
                <p className="pt-2 text-center text-xs text-inkmuted">Showing first 200 of {finalFilteredMarks.length} matching records — narrow your filters to see more precisely.</p>
              )}
            </div>
          )}
        </>
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
