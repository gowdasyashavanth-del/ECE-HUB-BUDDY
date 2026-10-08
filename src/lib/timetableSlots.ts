// Timetable presentation slots and utilities for ECE Hub Buddy.
// Configured to match the official college timetable structure.

import { formatTime12, formatTimeRange12 } from "./timeFormat";

export { formatTime12, formatTimeRange12 };

export interface SlotPreset {
  label: string;
  start: string; // HH:MM, 24h
  end: string;
  blockType: "lecture" | "break";
}

export interface TimetableColumn {
  type: "period" | "break";
  label: string;
  periodNumber?: number;
  start: string; // HH:MM 24h
  end: string;   // HH:MM 24h
}

export const SUGGESTED_SLOTS: SlotPreset[] = [
  { label: "Period 1", start: "09:00", end: "09:55", blockType: "lecture" },
  { label: "Period 2", start: "09:55", end: "10:50", blockType: "lecture" },
  { label: "Tea Break", start: "10:50", end: "11:00", blockType: "break" },
  { label: "Period 3", start: "11:00", end: "11:55", blockType: "lecture" },
  { label: "Period 4", start: "11:55", end: "12:50", blockType: "lecture" },
  { label: "Lunch", start: "12:50", end: "13:45", blockType: "break" },
  { label: "Period 5", start: "13:45", end: "14:35", blockType: "lecture" },
  { label: "Period 6", start: "14:35", end: "15:25", blockType: "lecture" },
  { label: "Period 7", start: "15:25", end: "16:15", blockType: "lecture" },
];

/**
 * Official academic timetable layout grid columns:
 * 9:00–9:55 | 9:55–10:50 | TEA BREAK | 11:00–11:55 | 11:55–12:50 | LUNCH | 1:45–2:35 | 2:35–3:25 | 3:25–4:15
 */
export const OFFICIAL_TIMETABLE_COLUMNS: TimetableColumn[] = [
  { type: "period", label: "Period 1", periodNumber: 1, start: "09:00", end: "09:55" },
  { type: "period", label: "Period 2", periodNumber: 2, start: "09:55", end: "10:50" },
  { type: "break",  label: "TEA BREAK", start: "10:50", end: "11:00" },
  { type: "period", label: "Period 3", periodNumber: 3, start: "11:00", end: "11:55" },
  { type: "period", label: "Period 4", periodNumber: 4, start: "11:55", end: "12:50" },
  { type: "break",  label: "LUNCH",     start: "12:50", end: "13:45" },
  { type: "period", label: "Period 5", periodNumber: 5, start: "13:45", end: "14:35" },
  { type: "period", label: "Period 6", periodNumber: 6, start: "14:35", end: "15:25" },
  { type: "period", label: "Period 7", periodNumber: 7, start: "15:25", end: "16:15" },
];

export const PERIOD_SLOTS = OFFICIAL_TIMETABLE_COLUMNS.filter((c) => c.type === "period");

export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const TIMETABLE_DAYS = [1, 2, 3, 4, 5, 6]; // Monday .. Saturday

export function timeToMinutes(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(aEnd) > timeToMinutes(bStart);
}
