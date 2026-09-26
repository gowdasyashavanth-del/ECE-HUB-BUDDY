import { Link } from "react-router-dom";
import { ContinueStudying } from "./ContinueStudying";
import { studyUrl } from "../../lib/study";

// Dashboard entry point.
export function StudyCard() {
  return (
    <section className="mb-8 rounded-lg border border-line bg-panel p-4" aria-labelledby="study-card-title">
      <p id="study-card-title" className="font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">
        <span aria-hidden="true">📚</span> Study Mode
      </p>
      <p className="mb-3 mt-1 text-sm text-ink">Continue learning from your subjects.</p>
      <div className="mb-3"><ContinueStudying fallback="Choose a topic to begin." /></div>
      <Link
        to={studyUrl()}
        className="inline-block rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
      >
        Start Studying
      </Link>
    </section>
  );
}
