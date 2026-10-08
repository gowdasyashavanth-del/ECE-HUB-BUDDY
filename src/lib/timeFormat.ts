/**
 * Centralized 12-hour time formatting utility for ECE Hub Buddy.
 * Converts 24-hour database time strings ("09:00:00", "13:45", etc.)
 * or Date objects into readable 12-hour user-facing strings (e.g., "9:00 AM", "1:45 PM").
 *
 * NOTE: Presentation only. Underlying database times and calculations remain 24-hour.
 */

export function formatTime12(time: string | Date | null | undefined): string {
  if (!time) return "";
  if (time instanceof Date) {
    if (isNaN(time.getTime())) return "";
    let h = time.getHours();
    const m = time.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  const str = String(time).trim();
  // If ISO date string like "2026-09-20T09:00:00Z"
  if (str.includes("T")) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return formatTime12(d);
    }
  }

  // Standard "HH:MM" or "HH:MM:SS"
  const parts = str.split(":");
  if (parts.length >= 2) {
    let h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return str;
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  return str;
}

export function formatTimeRange12(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  if (!start && !end) return "";
  if (start && !end) return formatTime12(start);
  if (!start && end) return formatTime12(end);
  return `${formatTime12(start)} – ${formatTime12(end)}`;
}
