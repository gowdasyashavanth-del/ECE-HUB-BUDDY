import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../ui/PageHeader";
import { LoadingState } from "../ui/LoadingState";
import { ErrorState } from "../ui/ErrorState";
import { EmptyState } from "../ui/EmptyState";

interface ResultRow {
  id: string; score: number; total: number; created_at: string;
  users: { full_name: string; email: string } | null;
  tests: { title: string; subjects: { name: string } | null } | null;
}

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// Zero manual scoping in this query — results_select RLS already
// returns exactly what this session is allowed to see: everything for
// admin, only their own subjects' tests for a teacher (via the same
// teacher_has_subject() chain re-verified in Phase 8's investigation).
export function ResultsViewer() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "super_admin";
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    if (!supabase) return;
    setError(null);
    const { data, error: err } = await supabase
      .from("results")
      .select("id, score, total, created_at, users(full_name, email), tests(title, subjects(name))")
      .order("created_at", { ascending: false });
    if (err) { setError(friendlyDbError(err, "Results")); return; }
    setRows((data ?? []) as unknown as ResultRow[]);
  }

  useEffect(() => { load(); }, []);

  const filtered = rows?.filter((r) => {
    if (!search.trim()) return true;
    const student = first<{ full_name: string; email: string }>(r.users as never);
    const test = first<{ title: string }>(r.tests as never);
    const q = search.toLowerCase();
    return student?.full_name?.toLowerCase().includes(q) || student?.email?.toLowerCase().includes(q) || test?.title?.toLowerCase().includes(q);
  });

  return (
    <div>
      <PageHeader title="Results" subtitle={isAdmin ? "Platform-wide test results." : "Results for your assigned subjects."} />

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by student or test…"
          className="w-full max-w-sm rounded-md border border-line bg-panel px-3 py-2 text-sm focus:border-copper focus:outline-none"
        />
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && rows === null && <LoadingState label="Loading results…" />}
      {!error && rows !== null && rows.length === 0 && (
        <EmptyState title="No results yet" message="Results appear here once students start taking tests." />
      )}

      {!error && filtered && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-paper">
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Student</th>
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Test</th>
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Subject</th>
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Score</th>
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const student = first<{ full_name: string; email: string }>(r.users as never);
                const test = first<{ title: string; subjects: any }>(r.tests as never);
                const subject = test ? first<{ name: string }>(test.subjects) : null;
                return (
                  <tr key={r.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2.5 text-ink">{student?.full_name || student?.email || "—"}</td>
                    <td className="px-4 py-2.5 text-ink">{test?.title ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-inkmuted">{subject?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-inkmuted">{r.score}/{r.total} ({Math.round((r.score / r.total) * 100)}%)</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-inkmuted">{new Date(r.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
