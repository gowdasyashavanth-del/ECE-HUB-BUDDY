export function Badge({ tone, children }: { tone: "current" | "active" | "archived" | "muted"; children: React.ReactNode }) {
  const styles: Record<typeof tone, string> = {
    current: "bg-trace-light text-trace-dark",
    active: "bg-trace-light text-trace-dark",
    archived: "bg-copper-light text-copper-dark",
    muted: "bg-paper text-inkmuted border border-line",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${styles[tone]}`}>
      {children}
    </span>
  );
}
