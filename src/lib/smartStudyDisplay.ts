// Smart Study — DISPLAY helpers only.
//
// Everything that decides WHAT is recommended and HOW URGENT it is lives in
// the database function smart_study_overview(). This file only turns the
// values that function returned into words and formatting: label text for
// a category / priority / action, and a "Due today / tomorrow / in N days"
// line derived from the real due_at timestamp in the viewer's local time.
// There is deliberately no scoring, ranking or threshold logic here.
import { calendarDayDiff, fmtDate, fmtTime } from "./planner";
import type { SmartStudyAction, SmartStudyCategory, SmartStudyPriority } from "./smartStudy";

export const CATEGORY_LABEL: Record<SmartStudyCategory, string> = {
  DEADLINE: "Deadline",
  TEST: "Test",
  CONTENT: "Content",
  REVIEW: "Review",
  CONTINUE: "Continue Studying",
  EXPLORE: "Explore",
};

export const PRIORITY_LABEL: Record<SmartStudyPriority, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};

export const ACTION_LABEL: Record<SmartStudyAction, string> = {
  study_topic: "Open in Study Mode",
  open_content: "Open content",
  open_test: "Open test",
  open_note: "Open notes",
  open_formula: "Open formulas",
  open_planner_event: "View in Planner",
};

export interface DueInfo {
  /** "Due tomorrow", "Overdue", "Starts in 3 days" … */
  relative: string;
  /** "Tue, 22 Sep · 5:00 PM" in the viewer's local time */
  exact: string;
  overdue: boolean;
}

// Calendar-day arithmetic in the browser's own time zone (Asia/Kolkata for
// BGSIT students), so "tomorrow" means tomorrow on THEIR calendar and never
// an off-by-one from UTC. Returns null when the backend supplied no due_at.
export function dueInfo(dueAt: string | null, category: SmartStudyCategory, now: Date): DueInfo | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  const exact = `${fmtDate(d)} · ${fmtTime(d)}`;
  const days = calendarDayDiff(now, d);
  const isTest = category === "TEST";
  const verb = isTest ? "Starts" : "Due";
  const past = d.getTime() < now.getTime();

  if (past) {
    return isTest ? { relative: "Started", exact, overdue: false } : { relative: "Overdue", exact, overdue: true };
  }
  if (days <= 0) return { relative: `${verb} today`, exact, overdue: false };
  if (days === 1) return { relative: `${verb} tomorrow`, exact, overdue: false };
  return { relative: `${verb} in ${days} days`, exact, overdue: false };
}
