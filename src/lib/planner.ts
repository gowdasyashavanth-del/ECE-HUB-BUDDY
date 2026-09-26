// Academic Planner — shared model + pure helpers.
//
// Everything here is derived from real `planner_events` rows. There is
// no sample/demo data in this file: it only defines types, labels and
// the date math that turns stored timestamps into a status/countdown.
// Status and countdown are NEVER stored — they are computed from the
// event's timestamps and the user's local clock on every render.

export type PlannerEventType =
  | "test" | "ia" | "exam" | "quiz" | "practical_exam"
  | "assignment" | "project_submission" | "lab_record_submission"
  | "seminar" | "presentation" | "viva"
  | "workshop" | "technical_event" | "holiday" | "academic_event";

export type PlannerPriority = "normal" | "important" | "critical";

export type PlannerScope =
  | "all" | "academic_year" | "regulation" | "program" | "semester" | "section" | "subject";

export type EventGroup = "assessment" | "work" | "event";

interface TypeMeta {
  label: string;
  group: EventGroup;
  // deadline = has a due date; timed = has a start (and optional end)
  kind: "deadline" | "timed";
  // may be an all-day event (date only, optional end date)
  allowAllDay: boolean;
  defaultAllDay: boolean;
  // can point at an existing test
  canLinkTest: boolean;
}

export const EVENT_TYPE_META: Record<PlannerEventType, TypeMeta> = {
  test:                  { label: "Test",                  group: "assessment", kind: "timed",    allowAllDay: false, defaultAllDay: false, canLinkTest: true },
  ia:                    { label: "IA",                    group: "assessment", kind: "timed",    allowAllDay: false, defaultAllDay: false, canLinkTest: false },
  exam:                  { label: "Exam",                  group: "assessment", kind: "timed",    allowAllDay: false, defaultAllDay: false, canLinkTest: false },
  quiz:                  { label: "Quiz",                  group: "assessment", kind: "timed",    allowAllDay: false, defaultAllDay: false, canLinkTest: true },
  practical_exam:        { label: "Practical Exam",        group: "assessment", kind: "timed",    allowAllDay: false, defaultAllDay: false, canLinkTest: false },
  assignment:            { label: "Assignment",            group: "work",       kind: "deadline", allowAllDay: false, defaultAllDay: false, canLinkTest: false },
  project_submission:    { label: "Project Submission",    group: "work",       kind: "deadline", allowAllDay: false, defaultAllDay: false, canLinkTest: false },
  lab_record_submission: { label: "Lab Record Submission", group: "work",       kind: "deadline", allowAllDay: false, defaultAllDay: false, canLinkTest: false },
  seminar:               { label: "Seminar",               group: "work",       kind: "timed",    allowAllDay: false, defaultAllDay: false, canLinkTest: false },
  presentation:          { label: "Presentation",          group: "work",       kind: "timed",    allowAllDay: false, defaultAllDay: false, canLinkTest: false },
  viva:                  { label: "Viva",                  group: "work",       kind: "timed",    allowAllDay: false, defaultAllDay: false, canLinkTest: false },
  workshop:              { label: "Workshop",              group: "event",      kind: "timed",    allowAllDay: true,  defaultAllDay: false, canLinkTest: false },
  technical_event:       { label: "Technical Event",       group: "event",      kind: "timed",    allowAllDay: true,  defaultAllDay: false, canLinkTest: false },
  holiday:               { label: "Holiday",               group: "event",      kind: "timed",    allowAllDay: true,  defaultAllDay: true,  canLinkTest: false },
  academic_event:        { label: "Academic Event",        group: "event",      kind: "timed",    allowAllDay: true,  defaultAllDay: false, canLinkTest: false },
};

export const EVENT_GROUP_LABEL: Record<EventGroup, string> = {
  assessment: "Assessments",
  work: "Academic work",
  event: "Academic & department events",
};

export const EVENT_TYPES_BY_GROUP: Record<EventGroup, PlannerEventType[]> = {
  assessment: ["test", "ia", "exam", "quiz", "practical_exam"],
  work: ["assignment", "project_submission", "lab_record_submission", "seminar", "presentation", "viva"],
  event: ["workshop", "technical_event", "holiday", "academic_event"],
};

export const PRIORITY_LABEL: Record<PlannerPriority, string> = {
  normal: "Normal",
  important: "Important",
  critical: "Critical",
};

export const SCOPE_LABEL: Record<PlannerScope, string> = {
  all: "All students",
  academic_year: "Academic year",
  regulation: "Regulation",
  program: "Program",
  semester: "Semester",
  section: "Section",
  subject: "Subject",
};

export interface PlannerEvent {
  id: string;
  title: string;
  description: string | null;
  event_type: PlannerEventType;
  priority: PlannerPriority;
  target_scope: PlannerScope;
  academic_year_id: string | null;
  regulation_id: string | null;
  program_id: string | null;
  semester_id: string | null;
  section_id: string | null;
  subject_id: string | null;
  unit_id: string | null;
  topic_id: string | null;
  test_id: string | null;
  start_at: string | null;
  end_at: string | null;
  due_at: string | null;
  all_day: boolean;
  anchor_at: string;
  created_by: string | null;
  subjects: { id: string; name: string; code: string | null } | null;
  sections: { id: string; name: string } | null;
}

// Only the columns the UI uses (no over-fetching), with the subject /
// section names embedded so a list never needs extra round-trips.
export const PLANNER_SELECT =
  "id, title, description, event_type, priority, target_scope, academic_year_id, regulation_id, program_id, semester_id, section_id, subject_id, unit_id, topic_id, test_id, start_at, end_at, due_at, all_day, anchor_at, created_by, subjects(id, name, code), sections(id, name)";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// PostgREST returns embedded many-to-one relations as an object (or an
// array depending on version) — normalise once, right at the boundary.
export function normalizeEvent(row: any): PlannerEvent {
  return { ...row, subjects: one(row.subjects), sections: one(row.sections) } as PlannerEvent;
}

export const isDeadlineType = (t: PlannerEventType) => EVENT_TYPE_META[t].kind === "deadline";

// ─── Local-time helpers (display uses the browser's own timezone; the
//     database keeps UTC timestamptz) ────────────────────────────────

export const startOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const sameLocalDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);

// Whole calendar days from `from` to `to` in local time (DST-safe).
export function calendarDayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

export function startOfWeek(d: Date): Date {
  // Weeks start on Monday (Indian academic calendar convention).
  const day = (d.getDay() + 6) % 7;
  return startOfLocalDay(addDays(d, -day));
}

export function localInputDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return dayKey(new Date(iso));
}
export function localInputTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function localToIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

export const fmtDate = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
export const fmtDateLong = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const fmtShortDate = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });

// ─── Derived status & countdown ───────────────────────────────────────

export type EventStatus = "overdue" | "today" | "due_soon" | "upcoming" | "completed";

export const STATUS_LABEL: Record<EventStatus, string> = {
  overdue: "Overdue",
  today: "Today",
  due_soon: "Due soon",
  upcoming: "Upcoming",
  completed: "Completed",
};

const DUE_SOON_MS = 48 * 3_600_000;

function eventEnd(ev: PlannerEvent): Date {
  if (ev.end_at) return new Date(ev.end_at);
  const anchor = new Date(ev.anchor_at);
  return ev.all_day ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 23, 59, 59) : anchor;
}

// "Completed" here only means "the scheduled time has passed" — the
// planner does not track submissions, so a missed deadline is shown as
// Overdue, never as a fabricated "submitted".
export function deriveStatus(ev: PlannerEvent, now: Date): EventStatus {
  const anchor = new Date(ev.anchor_at);
  if (isDeadlineType(ev.event_type)) {
    if (now.getTime() > anchor.getTime()) return "overdue";
  } else if (now.getTime() > eventEnd(ev).getTime()) {
    return "completed";
  }
  if (sameLocalDay(anchor, now) || (ev.start_at && new Date(ev.start_at) <= now)) return "today";
  if (anchor.getTime() - now.getTime() <= DUE_SOON_MS) return "due_soon";
  return "upcoming";
}

export function countdownLabel(ev: PlannerEvent, now: Date): string {
  const anchor = new Date(ev.anchor_at);
  const days = calendarDayDiff(now, anchor);
  const deadline = isDeadlineType(ev.event_type);

  if (days === 0) {
    if (ev.all_day) return "Today";
    const diff = anchor.getTime() - now.getTime();
    if (diff > 0) {
      const mins = Math.round(diff / 60_000);
      if (mins < 60) return `In ${Math.max(mins, 1)} min`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m ? `In ${h}h ${m}m` : `In ${h}h`;
    }
    if (!deadline && now.getTime() <= eventEnd(ev).getTime()) return "Happening now";
    return deadline ? "Was due today" : "Earlier today";
  }
  if (days === 1) return "Tomorrow";
  if (days === -1) return deadline ? "Was due yesterday" : "Yesterday";
  if (days > 1) return `In ${days} days`;
  return `${-days} days ago`;
}

// "Sep 23 · 10:00 AM – 12:00 PM" / "Due Sep 23 · 5:00 PM" / "Sep 23 (all day)"
export function whenLabel(ev: PlannerEvent): string {
  const anchor = new Date(ev.anchor_at);
  if (isDeadlineType(ev.event_type)) return `Due ${fmtDate(anchor)} · ${fmtTime(anchor)}`;
  if (ev.all_day) {
    const end = ev.end_at ? new Date(ev.end_at) : null;
    if (end && !sameLocalDay(anchor, end)) return `${fmtDate(anchor)} – ${fmtDate(end)}`;
    return `${fmtDate(anchor)} · All day`;
  }
  const end = ev.end_at ? new Date(ev.end_at) : null;
  if (end && sameLocalDay(anchor, end)) return `${fmtDate(anchor)} · ${fmtTime(anchor)} – ${fmtTime(end)}`;
  if (end) return `${fmtDate(anchor)} ${fmtTime(anchor)} – ${fmtDate(end)} ${fmtTime(end)}`;
  return `${fmtDate(anchor)} · ${fmtTime(anchor)}`;
}

// Every local day an event occupies (multi-day all-day events span days).
// An event that ends exactly at local midnight does NOT occupy the day
// that starts at that instant.
export function eventDayKeys(ev: PlannerEvent): string[] {
  const startAt = new Date(ev.anchor_at);
  const start = startOfLocalDay(startAt);
  if (!ev.end_at || isDeadlineType(ev.event_type)) return [dayKey(start)];
  let endAt = new Date(ev.end_at);
  if (endAt.getTime() > startAt.getTime()) endAt = new Date(endAt.getTime() - 1);
  const end = startOfLocalDay(endAt);
  const keys: string[] = [];
  for (let d = start, i = 0; d <= end && i < 62; d = addDays(d, 1), i++) keys.push(dayKey(d));
  return keys.length ? keys : [dayKey(start)];
}

// ─── Window overlap (Month / Week / List filtering) ───────────────────
// An event overlaps the visible window [from, to) when
//     event_start < to  AND  event_end > from
// Point events (no end_at: single-time events and deadlines) sit at
// anchor_at and count when from <= anchor_at < to — so a point exactly
// at the window start is inside, and one exactly at the window end is not.
export function overlapsWindow(ev: Pick<PlannerEvent, "anchor_at" | "end_at">, from: Date, to: Date): boolean {
  const start = new Date(ev.anchor_at).getTime();
  const w0 = from.getTime();
  const w1 = to.getTime();
  if (!ev.end_at) return start >= w0 && start < w1;
  return start < w1 && new Date(ev.end_at).getTime() > w0;
}

export function targetLabel(ev: PlannerEvent): string {
  if (ev.subjects && ev.sections) return `${ev.subjects.name} · Section ${ev.sections.name}`;
  if (ev.subjects) return `${ev.subjects.name} · all sections`;
  if (ev.sections) return `Section ${ev.sections.name}`;
  switch (ev.target_scope) {
    case "all": return "All students";
    case "academic_year": return "Whole academic year";
    case "regulation": return "Whole regulation";
    case "program": return "Whole program";
    case "semester": return "Whole semester";
    default: return "";
  }
}

export function sortByAnchor(a: PlannerEvent, b: PlannerEvent): number {
  return new Date(a.anchor_at).getTime() - new Date(b.anchor_at).getTime();
}
