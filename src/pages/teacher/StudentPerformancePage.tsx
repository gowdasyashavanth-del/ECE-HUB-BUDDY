import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { exportToCsv, exportToPdf } from "../../lib/exportRows";

interface AssignmentOption {
  id: string;
  subject_id: string;
  subject_name: string;
  section_id: string;
  section_name: string;
  semester_number: number | null;
  program_name: string | null;
}

interface StudentRow {
  student_id: string;
  full_name: string;
  email: string;
}

interface ResultDetail { score: number; total: number; created_at: string; test_title: string; }

interface StudentAggregate {
  student_id: string;
  full_name: string;
  email: string;
  results: ResultDetail[];
  avgScorePct: number | null;
  contentProgressPct: number;
  lastActivity: string | null;
}

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// SECURITY NOTE: every query on this page is scoped by the database, not
// by frontend filtering. The assignment list only ever contains rows
// where teacher_assignments.teacher_id = auth.uid() (RLS). The student
// list only ever contains rows returned by student_assignments_select,
// which itself joins back to teacher_assignments on section_id under
// RLS. Results/progress reads rely on results_select/progress_select,
// which independently check teacher_has_subject(subject_id). Changing
// `selectedAssignmentId` in the UI can only ever re-scope which of the
// teacher's OWN assignments is displayed — it cannot be used to request
// another teacher's section/subject, because the underlying queries
// would simply return empty rows for anything RLS doesn't already permit.
export function StudentPerformancePage() {
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState<AssignmentOption[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentAggregate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !profile) return;
    let cancelled = false;

    async function loadAssignments() {
      setError(null);
      const { data, error: fetchErr } = await supabase!
        .from("teacher_assignments")
        .select(
          "id, subject_id, subjects(name), section_id, sections(name, semesters(number, programs(name)))"
        )
        .eq("teacher_id", profile!.id);

      if (cancelled) return;
      if (fetchErr) {
        setError(friendlyDbError(fetchErr, "Your assignments"));
        return;
      }

      const opts: AssignmentOption[] = (data ?? []).map((a: any) => {
        const subject = first<{ name: string }>(a.subjects);
        const section = first<{ name: string; semesters: any }>(a.sections);
        const semester = section ? first<{ number: number; programs: any }>(section.semesters) : null;
        const program = semester ? first<{ name: string }>(semester.programs) : null;
        return {
          id: a.id,
          subject_id: a.subject_id,
          subject_name: subject?.name ?? "Untitled subject",
          section_id: a.section_id,
          section_name: section?.name ?? "—",
          semester_number: semester?.number ?? null,
          program_name: program?.name ?? null,
        };
      });
      setAssignments(opts);
      if (opts.length > 0) setSelectedId((prev) => prev ?? opts[0].id);
    }

    loadAssignments();
    return () => { cancelled = true; };
  }, [profile]);

  const selectedAssignment = useMemo(
    () => assignments?.find((a) => a.id === selectedId) ?? null,
    [assignments, selectedId]
  );

  useEffect(() => {
    if (!supabase || !selectedAssignment) return;
    let cancelled = false;

    async function loadPerformance() {
      setError(null);
      setStudents(null);

      // Students in this section — student_assignments_select RLS already
      // restricts this to sections this teacher is actually assigned to.
      const { data: assignRows, error: assignErr } = await supabase!
        .from("student_assignments")
        .select("student_id, users(full_name, email)")
        .eq("section_id", selectedAssignment!.section_id)
        .eq("is_current", true);

      if (cancelled) return;
      if (assignErr) {
        setError(friendlyDbError(assignErr, "Students"));
        return;
      }

      const roster: StudentRow[] = (assignRows ?? []).map((r: any) => {
        const u = first<{ full_name: string; email: string }>(r.users);
        return { student_id: r.student_id, full_name: u?.full_name ?? "Unknown", email: u?.email ?? "—" };
      });

      if (roster.length === 0) {
        if (!cancelled) setStudents([]);
        return;
      }
      const studentIds = roster.map((s) => s.student_id);

      // results_select RLS independently checks teacher_has_subject() on
      // this subject — this filter narrows what we display, RLS is what
      // actually enforces it.
      const { data: resultRows, error: resultErr } = await supabase!
        .from("results")
        .select("student_id, score, total, created_at, tests!inner(title, subject_id)")
        .eq("tests.subject_id", selectedAssignment!.subject_id)
        .in("student_id", studentIds);

      if (cancelled) return;
      if (resultErr) {
        setError(friendlyDbError(resultErr, "Results"));
        return;
      }

      // Content progress for this subject's topics — progress_select RLS
      // independently checks teacher_has_subject() via the topic's subject.
      const { data: unitRows } = await supabase!.from("units").select("id").eq("subject_id", selectedAssignment!.subject_id);
      const unitIds = (unitRows ?? []).map((u: any) => u.id);
      let topicIds: string[] = [];
      if (unitIds.length > 0) {
        const { data: topicRows } = await supabase!.from("topics").select("id").in("unit_id", unitIds);
        topicIds = (topicRows ?? []).map((t: any) => t.id);
      }
      let progressRows: { student_id: string; percent_done: number }[] = [];
      if (topicIds.length > 0) {
        const { data } = await supabase!
          .from("progress")
          .select("student_id, percent_done")
          .in("topic_id", topicIds)
          .in("student_id", studentIds);
        progressRows = (data as any[]) ?? [];
      }

      if (cancelled) return;

      const resultsByStudent = new Map<string, ResultDetail[]>();
      for (const r of (resultRows as any[]) ?? []) {
        const test = first<{ title: string }>(r.tests);
        const list = resultsByStudent.get(r.student_id) ?? [];
        list.push({ score: r.score, total: r.total, created_at: r.created_at, test_title: test?.title ?? "Untitled test" });
        resultsByStudent.set(r.student_id, list);
      }

      const progressByStudent = new Map<string, number[]>();
      for (const p of progressRows) {
        const list = progressByStudent.get(p.student_id) ?? [];
        list.push(p.percent_done);
        progressByStudent.set(p.student_id, list);
      }

      const aggregates: StudentAggregate[] = roster.map((s) => {
        const results = (resultsByStudent.get(s.student_id) ?? []).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        const avgScorePct =
          results.length > 0
            ? Math.round(
                (results.reduce((sum, r) => sum + (r.total > 0 ? r.score / r.total : 0), 0) / results.length) * 100
              )
            : null;
        const progressValues = progressByStudent.get(s.student_id) ?? [];
        const contentProgressPct =
          topicIds.length > 0
            ? Math.round(progressValues.reduce((sum, v) => sum + v, 0) / topicIds.length)
            : 0;
        const lastActivity = results.length > 0 ? results[0].created_at : null;
        return {
          student_id: s.student_id,
          full_name: s.full_name,
          email: s.email,
          results,
          avgScorePct,
          contentProgressPct,
          lastActivity,
        };
      });

      setStudents(aggregates);
    }

    loadPerformance();
    return () => { cancelled = true; };
  }, [selectedAssignment]);

  // Export rows are built only from `students`, which is already scoped
  // to the currently-selected assignment (the teacher's own
  // subject+section per RLS) — not a broader fetch of any kind.
  interface ExportRow { student: string; test: string; score: string; percent: number; date: string; }
  const exportRows: ExportRow[] = (students ?? []).flatMap((s) =>
    s.results.length > 0
      ? s.results.map((r) => ({
          student: s.full_name || s.email,
          test: r.test_title,
          score: `${r.score}/${r.total}`,
          percent: r.total > 0 ? Math.round((r.score / r.total) * 100) : 0,
          date: new Date(r.created_at).toLocaleDateString(),
        }))
      : [{ student: s.full_name || s.email, test: "—", score: "—", percent: 0, date: "—" }]
  );
  const exportColumns = [
    { header: "Student", value: (r: ExportRow) => r.student },
    { header: "Test", value: (r: ExportRow) => r.test },
    { header: "Score", value: (r: ExportRow) => r.score },
    { header: "Percent", value: (r: ExportRow) => r.percent },
    { header: "Date", value: (r: ExportRow) => r.date },
  ];

  return (
    <div>
      <PageHeader
        title="Student Performance"
        subtitle="Test scores and content progress for students you teach."
        action={
          students && students.length > 0 ? (
            <div className="flex gap-2">
              <button onClick={() => exportToCsv("student-performance", exportColumns, exportRows)} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-copper">Export CSV</button>
              <button onClick={() => exportToPdf("Student Performance", exportColumns, exportRows)} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-copper">Export PDF</button>
            </div>
          ) : undefined
        }
      />

      {error && <ErrorState message={error} onRetry={() => setSelectedId((id) => id)} />}

      {!error && assignments === null && <LoadingState label="Loading your assignments…" />}

      {!error && assignments !== null && assignments.length === 0 && (
        <EmptyState
          title="No subjects assigned yet"
          message="Your Super Admin hasn't assigned you to any subject/section yet, so there are no students to show."
        />
      )}

      {!error && assignments !== null && assignments.length > 0 && (
        <>
          {assignments.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-widest text-inkmuted">Subject / Section</span>
              <select
                value={selectedId ?? ""}
                onChange={(e) => setSelectedId(e.target.value)}
                className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
              >
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.subject_name} · Section {a.section_name}
                    {a.semester_number ? ` · Sem ${a.semester_number}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedAssignment && (
            <p className="mb-4 font-mono text-[11px] uppercase tracking-widest text-inkmuted">
              {selectedAssignment.program_name ?? "—"} · Semester {selectedAssignment.semester_number ?? "—"} ·
              Section {selectedAssignment.section_name}
            </p>
          )}

          {students === null && <LoadingState label="Loading student performance…" />}

          {students !== null && students.length === 0 && (
            <EmptyState title="No students assigned to this section yet" message="Once students are assigned here by your Super Admin, they'll appear in this list." />
          )}

          {students !== null && students.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-line bg-panel">
              <table className="min-w-full divide-y divide-line text-sm">
                <thead>
                  <tr className="text-left font-mono text-[11px] uppercase tracking-widest text-inkmuted">
                    <th className="px-4 py-2.5">Student</th>
                    <th className="px-4 py-2.5">Avg Score</th>
                    <th className="px-4 py-2.5">Content Progress</th>
                    <th className="px-4 py-2.5">Last Activity</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {students.map((s) => (
                    <Fragment key={s.student_id}>
                      <tr>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-ink">{s.full_name}</p>
                          <p className="font-mono text-xs text-inkmuted">{s.email}</p>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-ink">
                          {s.avgScorePct !== null ? `${s.avgScorePct}%` : "No tests yet"}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-ink">{s.contentProgressPct}%</td>
                        <td className="px-4 py-2.5 text-inkmuted">
                          {s.lastActivity
                            ? new Date(s.lastActivity).toLocaleDateString(undefined, { dateStyle: "medium" })
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => setExpandedId((id) => (id === s.student_id ? null : s.student_id))}
                            className="text-xs font-medium text-copper-dark hover:underline"
                          >
                            {expandedId === s.student_id ? "Hide" : "Details"}
                          </button>
                        </td>
                      </tr>
                      {expandedId === s.student_id && (
                        <tr>
                          <td colSpan={5} className="bg-paper px-4 py-3">
                            {s.results.length === 0 ? (
                              <p className="text-xs text-inkmuted">No test attempts yet in this subject.</p>
                            ) : (
                              <ul className="space-y-1">
                                {s.results.map((r, i) => (
                                  <li key={i} className="flex items-center justify-between text-xs">
                                    <span className="text-ink">{r.test_title}</span>
                                    <span className="font-mono text-inkmuted">
                                      {r.score}/{r.total} ·{" "}
                                      {new Date(r.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
