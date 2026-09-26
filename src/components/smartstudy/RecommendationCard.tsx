import { Link } from "react-router-dom";
import { actionRoute, type SmartStudyRecommendation } from "../../lib/smartStudy";
import { ACTION_LABEL, CATEGORY_LABEL, PRIORITY_LABEL, dueInfo } from "../../lib/smartStudyDisplay";

// One recommendation, exactly as the database returned it. Nothing here is
// computed, re-ranked or invented.
const EDGE: Record<SmartStudyRecommendation["priority"], string> = {
  high: "border-l-danger",
  medium: "border-l-copper",
  low: "border-l-line",
};
const PRIORITY_BADGE: Record<SmartStudyRecommendation["priority"], string> = {
  high: "bg-danger/10 text-danger",
  medium: "bg-copper-light text-copper-dark",
  low: "border border-line bg-paper text-inkmuted",
};

export function RecommendationCard({ rec, now }: { rec: SmartStudyRecommendation; now: Date }) {
  // Only a route the existing mapping can build from real ids. If it can't
  // (null), the card is simply not actionable — no URL is ever guessed.
  const route = actionRoute(rec);
  const due = dueInfo(rec.due_at, rec.category, now);

  return (
    <li className={`rounded-lg border border-l-4 border-line bg-panel p-4 ${EDGE[rec.priority]}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide ${PRIORITY_BADGE[rec.priority]}`}>
          {PRIORITY_LABEL[rec.priority]}
        </span>
        <span className="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-inkmuted">
          {CATEGORY_LABEL[rec.category]}
        </span>
        {rec.subject_name && (
          <span className="min-w-0 max-w-full break-words text-xs text-inkmuted">{rec.subject_name}</span>
        )}
      </div>

      <h3 className="mt-2 break-words font-display text-base font-semibold text-ink">{rec.title}</h3>
      <p className="mt-1 break-words text-sm text-ink/80">{rec.reason}</p>

      {due && (
        <p className="mt-2 break-words text-xs text-inkmuted">
          <span className={`font-medium ${due.overdue ? "text-danger" : "text-ink"}`}>{due.relative}</span>
          <span aria-hidden="true"> · </span>
          <span>{due.exact}</span>
        </p>
      )}

      {route && (
        <Link
          to={route}
          className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper sm:w-auto"
        >
          {ACTION_LABEL[rec.action_type]} →
        </Link>
      )}
    </li>
  );
}
