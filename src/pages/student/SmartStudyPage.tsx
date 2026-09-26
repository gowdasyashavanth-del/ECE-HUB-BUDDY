import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { EmptyState } from "../../components/ui/EmptyState";
import { RecommendationCard } from "../../components/smartstudy/RecommendationCard";
import { AcademicSnapshot } from "../../components/smartstudy/AcademicSnapshot";
import { getSmartStudy, type SmartStudyRecommendation } from "../../lib/smartStudy";

// /student/smart-study
// Renders exactly what public.smart_study_overview() returns — in the order
// the database returned it. Zero rows => an honest empty state. A failed
// request => an error with Retry. There is no fallback content of any kind,
// and nothing is stored in the browser.
export function SmartStudyPage() {
  const [recs, setRecs] = useState<SmartStudyRecommendation[] | null>(null); // null = not loaded yet
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const requestId = useRef(0);

  const load = useCallback(async (isRefresh: boolean) => {
    const id = ++requestId.current;
    if (isRefresh) setRefreshing(true);
    else { setRecs(null); }
    setError(null);
    const res = await getSmartStudy();
    if (id !== requestId.current) return; // a newer request superseded this one
    setRefreshing(false);
    if (res.error) { setError(res.error); if (!isRefresh) setRecs(null); return; }
    setNow(new Date());
    setRecs(res.data);
  }, []);

  useEffect(() => { void load(false); return () => { requestId.current++; }; }, [load]);

  const initialLoading = recs === null && !error;
  // Refresh stays clickable even while a previous refresh is still in
  // flight — a stray click just supersedes it (see requestId in load()).
  const busy = initialLoading;

  return (
    <div>
      <PageHeader
        title="Smart Study"
        subtitle="A focused view of what needs your attention next."
        action={
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={busy}
            aria-busy={refreshing}
            title="Refresh"
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-md border border-line px-3.5 py-2 text-sm font-medium text-ink hover:border-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper disabled:opacity-60"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {recs !== null && !error && <AcademicSnapshot />}

      {recs === null && !error && <LoadingState label="Loading Smart Study…" />}

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-5 py-4" role="alert">
          <p className="font-display text-sm font-semibold text-danger">Couldn't load Smart Study.</p>
          <p className="mt-1 text-sm text-ink/80">Please try again.</p>
          <button
            type="button"
            onClick={() => void load(recs !== null)}
            className="mt-3 inline-flex min-h-[44px] items-center rounded-md border border-danger/40 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger"
          >
            Retry
          </button>
        </div>
      )}

      {recs !== null && recs.length === 0 && !error && (
        <EmptyState
          title="You're all caught up."
          message="There are no priority study recommendations from your current academic data right now."
        />
      )}

      {recs !== null && recs.length > 0 && (
        <section aria-label="Study recommendations" className={refreshing ? "opacity-60 transition-opacity" : ""}>
          <ul className="space-y-3">
            {recs.map((r) => <RecommendationCard key={r.rec_id} rec={r} now={now} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
