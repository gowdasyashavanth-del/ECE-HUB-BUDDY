// The one recurring signature element: a short right-angle "trace" with
// a solder-dot, used sparingly as a section divider — never as generic
// decoration, only where it marks an actual transition (between nav
// groups, above a page title).
export function TraceDivider({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1" aria-hidden={!label}>
      <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
        <path d="M0 5H8L11 1V9L14 5H20" stroke="currentColor" strokeWidth="1.5" className="text-line" />
        <circle cx="14" cy="5" r="1.5" fill="currentColor" className="text-copper" />
      </svg>
      {label && (
        <span className="font-mono text-[11px] uppercase tracking-widest text-inkmuted">{label}</span>
      )}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
