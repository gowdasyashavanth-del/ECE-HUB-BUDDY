// Signature mark: a small schematic resistor zigzag standing in for the
// "E" of ECE — grounds the wordmark in the subject (circuits) rather
// than being a generic abstract icon.
interface LogoProps {
  compact?: boolean;
  /** "dark" (default) is the original mark for use on light/paper
   * backgrounds. "light" renders in white for use over photos or the
   * navy overlay — added for the login page hero, doesn't change any
   * existing usage since it's opt-in. */
  tone?: "dark" | "light";
}

export function Logo({ compact = false, tone = "dark" }: LogoProps) {
  const markColor = tone === "light" ? "text-white" : "text-copper";
  const textColor = tone === "light" ? "text-white" : "text-ink";
  return (
    <div className="flex items-center gap-2">
      <svg width="28" height="20" viewBox="0 0 28 20" fill="none" aria-hidden="true">
        <path
          d="M1 10H6L8.5 3L13.5 17L18.5 3L21 10H27"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={markColor}
        />
      </svg>
      {!compact && (
        <span className={`font-display text-lg font-semibold tracking-tight ${textColor}`}>
          ECE Hub Buddy
        </span>
      )}
    </div>
  );
}
