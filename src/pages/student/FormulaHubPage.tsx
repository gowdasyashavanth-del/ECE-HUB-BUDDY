import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface FormulaRow {
  id: string; name: string; expression: string; description: string | null; example: string | null;
  subjects: { name: string } | null;
}

// Deliberately no subject_id filter in this query at all. RLS's
// student_enrolled_in_subject() check on the `formulas` table means
// a plain, unfiltered select already only returns formulas for
// subjects this student is actually enrolled in — nothing here does
// that filtering; the database does. Changing the URL or any local
// state can't reveal another subject's formulas, because there's no
// client-side filter to bypass in the first place.
export function FormulaHubPage() {
  const [rows, setRows] = useState<FormulaRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    if (!supabase) return;
    setError(null);
    const { data, error: err } = await supabase
      .from("formulas")
      .select("id, name, expression, description, example, subjects(name)")
      .order("name");
    if (err) {
      setError(friendlyDbError(err, "Formulas"));
      return;
    }
    setRows((data ?? []) as unknown as FormulaRow[]);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = rows?.filter(
    (r) => !search.trim() || r.name.toLowerCase().includes(search.toLowerCase()) || r.expression.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <PageHeader title="Formula Hub" subtitle="Formulas for your enrolled subjects." />

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search formulas…"
          className="w-full max-w-sm rounded-md border border-line bg-panel px-3 py-2 text-sm focus:border-copper focus:outline-none"
        />
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && rows === null && <LoadingState label="Loading formulas…" />}
      {!error && rows !== null && rows.length === 0 && (
        <EmptyState title="No formulas yet" message="Your teachers haven't added formulas for your subjects yet." />
      )}
      {!error && filtered && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((f) => (
            <div key={f.id} className="rounded-lg border border-line bg-panel p-4">
              <p className="font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">{f.subjects?.name ?? "—"}</p>
              <p className="mt-1 font-body text-sm font-medium text-ink">{f.name}</p>
              <p className="mt-1 font-mono text-base text-copper-dark">{f.expression}</p>
              {f.description && <p className="mt-1 text-xs text-inkmuted">{f.description}</p>}
            </div>
          ))}
        </div>
      )}
      {!error && filtered && filtered.length === 0 && rows && rows.length > 0 && (
        <p className="text-sm text-inkmuted">No formulas match "{search}".</p>
      )}
    </div>
  );
}
