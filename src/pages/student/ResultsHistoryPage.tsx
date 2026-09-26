import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { exportToCsv, exportToPdf } from "../../lib/exportRows";

interface ResultRow {
  id: string;
  score: number;
  total: number;
  created_at: string;
  test_title: string;
  subject_id: string | null;
  subject_name: string;
}

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// RLS (results_select) already restricts this query to the caller's own
// rows — no manual student_id filter is added or needed. This page only
// reads `results`/`tests`/`subjects`; it never touches `questions` or any
// column that could expose a correct answer.
export function ResultsHistoryPage() {
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<string>("all");

  async function load() {
    if (!supabase) return;
    setError(null);
    const { data, error: fetchErr } = await supabase
      .from("results")
      .select("id, score, total, created_at, tests(title, subject_id, subjects(name))")
      .order("created_at", { ascending: false });

    if (fetchErr) {
      setError(friendlyDbError(fetchErr, "Results"));
      return;
    }

    setResults(
      (data ?? []).map((r: any) => {
        const test = first<{ title: string; subject_id: string | null; subjects: any }>(r.tests);
        const subject = test ? first<{ name: string }>(test.subjects) : null;
        return {
          id: r.id,
          score: r.score,
          total: r.total,
          created_at: r.created_at,
          test_title: test?.title ?? "Untitled test",
          subject_id: test?.subject_id ?? null,
          subject_name: subject?.name ?? "Unknown subject",
        };
      })
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subjects = useMemo(() => {
    if (!results) return [];
    const map = new Map<string, string>();
    for (const r of results) {
      if (r.subject_id) map.set(r.subject_id, r.subject_name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [results]);

  const filtered = useMemo(() => {
    if (!results) return [];
    if (subjectFilter === "all") return results;
    return results.filter((r) => r.subject_id === subjectFilter);
  }, [results, subjectFilter]);

  // Exports operate only on `filtered` — rows already returned by the
  // RLS-scoped query above (the caller's own results only). No extra
  // fetch, no broader scope.
  const exportColumns = [
    { header: "Test", value: (r: ResultRow) => r.test_title },
    { header: "Subject", value: (r: ResultRow) => r.subject_name },
    { header: "Score", value: (r: ResultRow) => `${r.score}/${r.total}` },
    { header: "Percent", value: (r: ResultRow) => (r.total > 0 ? Math.round((r.score / r.total) * 100) : 0) },
    { header: "Date", value: (r: ResultRow) => new Date(r.created_at).toLocaleString() },
  ];

  return (
    <div>
      <PageHeader
        title="My Results"
        subtitle="Your complete test-attempt history."
        action={
          results && results.length > 0 ? (
            <div className="flex gap-2">
              <button onClick={() => exportToCsv("my-results", exportColumns, filtered)} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-copper">Export CSV</button>
              <button onClick={() => exportToPdf("My Results", exportColumns, filtered)} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-copper">Export PDF</button>
            </div>
          ) : undefined
        }
      />

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && results === null && <LoadingState label="Loading your results…" />}

      {!error && results !== null && results.length === 0 && (
        <EmptyState
          title="No test attempts yet"
          message="Once you take a test, your scores will appear here."
        />
      )}

      {!error && results !== null && results.length > 0 && (
        <>
          {subjects.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-widest text-inkmuted">Subject</span>
              <select
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
              >
                <option value="all">All subjects</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState title="No results for this subject" message="Try a different subject filter." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-panel">
              <table className="min-w-full divide-y divide-line text-sm">
                <thead>
                  <tr className="text-left font-mono text-[11px] uppercase tracking-widest text-inkmuted">
                    <th className="px-4 py-2.5">Test</th>
                    <th className="px-4 py-2.5">Subject</th>
                    <th className="px-4 py-2.5">Score</th>
                    <th className="px-4 py-2.5">%</th>
                    <th className="px-4 py-2.5">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((r) => {
                    const pct = r.total > 0 ? Math.round((r.score / r.total) * 100) : 0;
                    return (
                      <tr key={r.id}>
                        <td className="px-4 py-2.5 font-medium text-ink">{r.test_title}</td>
                        <td className="px-4 py-2.5 text-inkmuted">{r.subject_name}</td>
                        <td className="px-4 py-2.5 font-mono text-ink">
                          {r.score}/{r.total}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-ink">{pct}%</td>
                        <td className="px-4 py-2.5 text-inkmuted">
                          {new Date(r.created_at).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
