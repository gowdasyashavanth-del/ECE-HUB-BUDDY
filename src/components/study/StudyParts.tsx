import { Link } from "react-router-dom";
import { EmptyState } from "../ui/EmptyState";
import { studyUrl } from "../../lib/study";

export function NotFound({ what }: { what: "topic" | "subject" }) {
  return (
    <div>
      <EmptyState
        title={`${what === "topic" ? "Topic" : "Subject"} not found or unavailable.`}
        message="It may not exist, or it isn't part of your courses."
      />
      <p className="mt-4 text-center text-sm">
        <Link to={studyUrl()} className="inline-flex min-h-[44px] items-center font-medium text-copper-dark hover:underline">← Back to Study Mode</Link>
      </p>
    </div>
  );
}

export function ProgressBar({ pct, label }: { pct: number; label: string }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label}>
      <div className="h-full rounded-full bg-trace" style={{ width: `${v}%` }} />
    </div>
  );
}

export function SectionCard({ id, icon, title, children }: { id?: string; icon: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-5 scroll-mt-20 rounded-lg border border-line bg-panel p-4">
      <h2 className="mb-3 font-display text-base font-semibold text-ink">
        <span aria-hidden="true">{icon}</span> {title}
      </h2>
      {children}
    </section>
  );
}
