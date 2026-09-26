import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface TestRow {
  id: string; title: string; duration_min: number | null;
  subjects: { name: string } | null;
}
interface ResultRow { test_id: string; score: number; total: number; created_at: string; }

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// No manual subject filtering here at all — tests_select RLS (student_
// enrolled_in_subject + is_published) already ensures this query only
// ever returns tests this student is actually allowed to take.
export function TestsListPage() {
  const [tests, setTests] = useState<TestRow[] | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!supabase) return;
    setError(null);
    const { data: testRows, error: testErr } = await supabase
      .from("tests")
      .select("id, title, duration_min, subjects(name)")
      .eq("is_published", true);
    if (testErr) { setError(friendlyDbError(testErr, "Tests")); return; }
    setTests((testRows ?? []) as unknown as TestRow[]);

    const { data: resultRows, error: resultErr } = await supabase
      .from("results")
      .select("test_id, score, total, created_at")
      .order("created_at", { ascending: false });
    if (resultErr) { setError(friendlyDbError(resultErr, "Results")); return; }
    setResults(resultRows ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  function bestResultFor(testId: string): ResultRow | null {
    const attempts = results.filter((r) => r.test_id === testId);
    if (attempts.length === 0) return null;
    return attempts.reduce((best, r) => (r.score / r.total > best.score / best.total ? r : best));
  }

  return (
    <div>
      <PageHeader title="Tests" subtitle="Tests available for your enrolled subjects." />

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && tests === null && <LoadingState label="Loading tests…" />}
      {!error && tests !== null && tests.length === 0 && (
        <EmptyState title="No tests available yet" message="Your teachers haven't published any tests for your subjects yet." />
      )}

      {!error && tests !== null && tests.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tests.map((t) => {
            const best = bestResultFor(t.id);
            return (
              <div key={t.id} className="rounded-lg border border-line bg-panel p-4">
                <p className="font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">{first<{ name: string }>(t.subjects as never)?.name ?? "—"}</p>
                <p className="mt-1 font-body text-sm font-medium text-ink">{t.title}</p>
                <p className="mt-1 text-xs text-inkmuted">{t.duration_min ? `${t.duration_min} min` : "No time limit"}</p>
                {best && (
                  <p className="mt-2 font-mono text-xs text-trace-dark">Best: {best.score}/{best.total}</p>
                )}
                <Link
                  to={`/student/tests/${t.id}`}
                  className="mt-3 inline-block rounded-md bg-copper px-3 py-1.5 text-xs font-medium text-white hover:bg-copper-dark"
                >
                  {best ? "Retake Test" : "Start Test"}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
