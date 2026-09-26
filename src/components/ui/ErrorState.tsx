export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 px-5 py-4 font-body" role="alert">
      <p className="font-display text-sm font-semibold text-danger">{title}</p>
      <p className="mt-1 text-sm text-ink/80">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 text-sm font-medium text-danger underline underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
        >
          Try again
        </button>
      )}
    </div>
  );
}
