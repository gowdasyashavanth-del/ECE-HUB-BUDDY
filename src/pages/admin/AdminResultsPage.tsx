import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { exportToCsv, exportToPdf } from "../../lib/exportRows";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface ResultRow { id: string; student_id: string; test_id: string; score: number; total: number; created_at: string; }
interface TestRow { id: string; title: string; subject_id: string | null; topic_id: string | null; }
interface UserRow { id: string; full_name: string; email: string; role: string; usn: string | null; }

// results_select already restricts admin to "everything" only because
// is_admin() is one of its OR-branches — no extra scoping is added here.
// This page and its export both read from exactly the same authorized
// `results` rows; the export functions in lib/exportRows.ts have no
// data access of their own, so they can't expose anything beyond what's
// already rendered on screen.
export function AdminResultsPage() {
  const [years, setYears] = useState<{ id: string; name: string }[]>([]);
  const [regs, setRegs] = useState<{ id: string; academic_year_id: string }[]>([]);
  const [programs, setPrograms] = useState<{ id: string; regulation_id: string }[]>([]);
  const [semesters, setSemesters] = useState<{ id: string; number: number; program_id: string }[]>([]);
  const [sections, setSections] = useState<{ id: string; name: string; semester_id: string; academic_year_id: string }[]>([]);
  const [subjects, setSubjects] = useState<{ id: string; name: string; semester_id: string }[]>([]);
  const [tests, setTests] = useState<TestRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [studentsInSection, setStudentsInSection] = useState<Set<string> | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [yearId, setYearId] = useState("");
  const [semId, setSemId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [testId, setTestId] = useState("");
  const [studentId, setStudentId] = useState("");

  async function load() {
    if (!supabase) return;
    setError(null);
    setLoading(true);
    const [y, r, p, s, sec, subj, t, u, res] = await Promise.all([
      supabase.from("academic_years").select("id, name"),
      supabase.from("regulations").select("id, academic_year_id"),
      supabase.from("programs").select("id, regulation_id"),
      supabase.from("semesters").select("id, number, program_id"),
      supabase.from("sections").select("id, name, semester_id, academic_year_id"),
      supabase.from("subjects").select("id, name, semester_id"),
      supabase.from("tests").select("id, title, subject_id, topic_id"),
      supabase.from("users").select("id, full_name, email, role, usn"),
      supabase.from("results").select("id, student_id, test_id, score, total, created_at"),
    ]);
    setLoading(false);
    const firstErr = [y, r, p, s, sec, subj, t, u, res].find((x) => x.error);
    if (firstErr?.error) { setError(friendlyDbError(firstErr.error, "Results")); return; }
    setYears(y.data ?? []);
    setRegs(r.data ?? []);
    setPrograms(p.data ?? []);
    setSemesters(s.data ?? []);
    setSections(sec.data ?? []);
    setSubjects(subj.data ?? []);
    setTests((t.data ?? []) as TestRow[]);
    setUsers((u.data ?? []) as UserRow[]);
    setResults((res.data ?? []) as ResultRow[]);
  }

  useEffect(() => { load(); }, []);

  const students = useMemo(() => users.filter((u) => u.role === "student"), [users]);
  const testById = useMemo(() => new Map(tests.map((t) => [t.id, t])), [tests]);
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

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
  const filteredTests = useMemo(() => tests.filter((t) => !subjectId || t.subject_id === subjectId), [tests, subjectId]);

  useEffect(() => {
    async function loadSectionRoster() {
      if (!supabase || !sectionId) { setStudentsInSection(null); return; }
      const res = await supabase.from("student_assignments").select("student_id").eq("section_id", sectionId).eq("is_current", true);
      setStudentsInSection(new Set((res.data ?? []).map((r: any) => r.student_id)));
    }
    loadSectionRoster();
  }, [sectionId]);

  const filtered = useMemo(() => {
    return results.filter((r) => {
      const t = testById.get(r.test_id);
      if (subjectId && t?.subject_id !== subjectId) return false;
      if (testId && r.test_id !== testId) return false;
      if (studentId && r.student_id !== studentId) return false;
      if (semId) {
        const subj = t?.subject_id ? subjects.find((s) => s.id === t.subject_id) : null;
        if (!subj || subj.semester_id !== semId) return false;
      }
      if (yearId) {
        const subj = t?.subject_id ? subjects.find((s) => s.id === t.subject_id) : null;
        const sem = subj ? semesters.find((s) => s.id === subj.semester_id) : null;
        const progIds = new Set(regs.filter((rg) => rg.academic_year_id === yearId).flatMap((rg) => programs.filter((p) => p.regulation_id === rg.id).map((p) => p.id)));
        if (!sem || !progIds.has(sem.program_id)) return false;
      }
      if (studentsInSection && !studentsInSection.has(r.student_id)) return false;
      return true;
    });
  }, [results, testById, subjectId, testId, studentId, semId, yearId, subjects, semesters, regs, programs, studentsInSection]);

  const summary = useMemo(() => {
    const total = filtered.length;
    const pcts = filtered.map((r) => (r.total > 0 ? (r.score / r.total) * 100 : 0));
    const avg = total > 0 ? Math.round((pcts.reduce((a, b) => a + b, 0) / total) * 10) / 10 : null;
    return { total, avg };
  }, [filtered]);

  interface ExportRow { student: string; usn: string; subject: string; test: string; score: string; percent: number; date: string; }
  const exportRows: ExportRow[] = filtered.map((r) => {
    const student = userById.get(r.student_id);
    const t = testById.get(r.test_id);
    const subj = t?.subject_id ? subjects.find((s) => s.id === t.subject_id) : null;
    return {
      student: student?.full_name || student?.email || "—",
      usn: student?.usn ?? "—",
      subject: subj?.name ?? "—",
      test: t?.title ?? "Untitled test",
      score: `${r.score}/${r.total}`,
      percent: r.total > 0 ? Math.round((r.score / r.total) * 100) : 0,
      date: new Date(r.created_at).toLocaleDateString(),
    };
  });
  const exportColumns = [
    { header: "Student", value: (r: ExportRow) => r.student },
    { header: "USN", value: (r: ExportRow) => r.usn },
    { header: "Subject", value: (r: ExportRow) => r.subject },
    { header: "Test", value: (r: ExportRow) => r.test },
    { header: "Score", value: (r: ExportRow) => r.score },
    { header: "Percent", value: (r: ExportRow) => r.percent },
    { header: "Date", value: (r: ExportRow) => r.date },
  ];

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (loading) return <LoadingState label="Loading results…" />;

  return (
    <div>
      <PageHeader
        title="Results"
        subtitle="All test results, filterable by academic context."
        action={
          filtered.length > 0 ? (
            <div className="flex gap-2">
              <button onClick={() => exportToCsv("results", exportColumns, exportRows)} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-copper">Export CSV</button>
              <button onClick={() => exportToPdf("Results", exportColumns, exportRows)} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-copper">Export PDF</button>
            </div>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <select value={yearId} onChange={(e) => { setYearId(e.target.value); setSemId(""); setSectionId(""); }} className={selectCls}>
          <option value="">Year</option>
          {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
        <select value={semId} onChange={(e) => { setSemId(e.target.value); setSectionId(""); setSubjectId(""); }} className={selectCls}>
          <option value="">Semester</option>
          {filteredSemesters.map((s) => <option key={s.id} value={s.id}>Sem {s.number}</option>)}
        </select>
        <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={selectCls}>
          <option value="">Section</option>
          {filteredSections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
        </select>
        <select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setTestId(""); }} className={selectCls}>
          <option value="">Subject</option>
          {filteredSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={testId} onChange={(e) => setTestId(e.target.value)} className={selectCls}>
          <option value="">Test</option>
          {filteredTests.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className={selectCls}>
          <option value="">Student</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.usn ? `${s.full_name || s.email} (${s.usn})` : (s.full_name || s.email)}</option>)}
        </select>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Results" value={summary.total} />
        <Stat label="Average" value={summary.avg !== null ? `${summary.avg}%` : "—"} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No results found" message="Adjust your filters, or check back once students have taken tests." />
      ) : (
        <div className="space-y-1.5">
          {filtered.slice(0, 200).map((r) => {
            const student = userById.get(r.student_id);
            const t = testById.get(r.test_id);
            const subj = t?.subject_id ? subjects.find((s) => s.id === t.subject_id) : null;
            const pct = r.total > 0 ? Math.round((r.score / r.total) * 100) : 0;
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm">
                <div className="flex flex-wrap gap-3">
                  <span className="text-ink">{student?.full_name || student?.email}</span>
                  {student?.usn && <span className="font-mono text-xs text-inkmuted">{student.usn}</span>}
                  <span className="text-inkmuted">{subj?.name ?? "—"}</span>
                  <span className="text-inkmuted">{t?.title ?? "Untitled test"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{r.score}/{r.total}</span>
                  <span className="text-xs text-inkmuted">{pct}%</span>
                  <span className="font-mono text-[10px] text-inkmuted">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })}
          {filtered.length > 200 && (
            <p className="pt-2 text-center text-xs text-inkmuted">Showing first 200 of {filtered.length} matching results — narrow your filters to see more precisely.</p>
          )}
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
