import { useEffect, useState } from "react";
import { getStudentSummary, fmtPct, type StudentSummary } from "../../lib/analytics";
import { StatCard } from "../analytics/analyticsUi";

// A small, real-data-only summary at the top of Smart Study, giving the
// student context for WHY recommendations exist. This calls the EXISTING
// analytics_student_summary() function (Phase 3) — the same one Student
// Analytics itself uses — and only formats what it returns. No score,
// percentage, or threshold is computed here; every number is exactly
// what Analytics already calculated. Failure is silent (the summary is
// a bonus, not the page's main content), and a field the backend
// couldn't compute (e.g. no tests attempted yet) is simply omitted
// rather than shown as 0% or invented.
export function AcademicSnapshot() {
  const [summary, setSummary] = useState<StudentSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStudentSummary().then((r) => {
      if (cancelled) return;
      if (!r.error) setSummary(r.data);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  if (!loaded || !summary || summary.subjects_count === 0) return null;

  return (
    <section aria-label="Academic snapshot" className="mb-6">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-inkmuted">Academic snapshot</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Content progress" value={fmtPct(summary.overall_progress_pct)} />
        <StatCard
          label="Recent test average"
          value={summary.avg_latest_pct === null ? "No attempts yet" : fmtPct(summary.avg_latest_pct, 1)}
        />
        <StatCard label="Active subjects" value={summary.subjects_count} />
      </div>
    </section>
  );
}
