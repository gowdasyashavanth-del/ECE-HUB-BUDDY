import { Link } from "react-router-dom";

// Dashboard entry point. Static wording only — it never shows a
// recommendation; the real ones live on /student/smart-study.
export function SmartStudyEntryCard() {
  return (
    <section className="mb-8 rounded-lg border border-line bg-panel p-4" aria-labelledby="smart-study-card-title">
      <p id="smart-study-card-title" className="font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">
        <span aria-hidden="true">🎯</span> Smart Study
      </p>
      <p className="mb-3 mt-1 text-sm text-ink">See what needs your attention next.</p>
      <Link
        to="/student/smart-study"
        className="inline-flex min-h-[44px] items-center rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
      >
        Open Smart Study →
      </Link>
    </section>
  );
}
