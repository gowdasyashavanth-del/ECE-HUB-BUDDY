export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-panel px-6 py-10 text-center font-body">
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-inkmuted">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
