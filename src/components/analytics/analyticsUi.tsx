import type { ReactNode } from "react";

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-3">
      <p className="font-mono text-[11px] uppercase tracking-wide text-inkmuted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-inkmuted">{hint}</p>}
    </div>
  );
}

export function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-md border border-line bg-panel p-4">
      <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
      {subtitle && <p className="mb-3 text-xs text-inkmuted">{subtitle}</p>}
      <div className={subtitle ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

export function Bar({ pct, tone = "trace", label }: { pct: number | null; tone?: "trace" | "copper" | "danger"; label?: string }) {
  const v = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const fill = tone === "copper" ? "bg-copper" : tone === "danger" ? "bg-danger" : "bg-trace";
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-paper"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === null ? undefined : Math.round(v)}
      aria-label={label}
    >
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${v}%` }} />
    </div>
  );
}

// Labelled bar row: "Network Analysis ████░░ 82%"
export function BarRow({ label, pct, right, tone }: { label: string; pct: number | null; right?: string; tone?: "trace" | "copper" | "danger" }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-ink">{label}</span>
        <span className="shrink-0 font-mono text-xs text-inkmuted">{right ?? (pct === null ? "—" : `${Math.round(pct)}%`)}</span>
      </div>
      <Bar pct={pct} tone={tone} label={label} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-line px-3 py-4 text-sm text-inkmuted">{children}</p>;
}

// Compact bar chart of real percentages (e.g. recent attempts). Rendered
// only when there are at least two data points — one bar is not a trend.
export function MiniBars({ points }: { points: { label: string; value: number }[] }) {
  if (points.length < 2) return null;
  return (
    <div className="flex h-24 items-end gap-1.5" role="img" aria-label={`Scores: ${points.map((p) => `${p.label} ${Math.round(p.value)}%`).join(", ")}`}>
      {points.map((p, i) => (
        <div key={`${p.label}-${i}`} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="font-mono text-[10px] text-inkmuted">{Math.round(p.value)}</span>
          <div className="w-full rounded-t bg-trace" style={{ height: `${Math.max(4, p.value)}%` }} title={`${p.label}: ${Math.round(p.value)}%`} />
        </div>
      ))}
    </div>
  );
}
