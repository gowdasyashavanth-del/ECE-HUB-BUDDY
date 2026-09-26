export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-inkmuted font-body" role="status" aria-live="polite">
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-copper opacity-60" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-copper" />
      </span>
      <span className="text-sm">{label}</span>
    </div>
  );
}
