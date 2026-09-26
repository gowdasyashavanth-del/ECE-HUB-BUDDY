// These are UI convenience presets for the "Add entry" form dropdown
// only — picking one just pre-fills start/end time and block_type,
// which the admin can still freely change. Nothing in the data model,
// validation, or rendering depends on this list; the grid is always
// built from whatever start_time/end_time values are actually stored
// on each timetable_entries row, so changing period timings later
// never requires a code change here.
export interface SlotPreset {
  label: string;
  start: string; // HH:MM, 24h
  end: string;
  blockType: "lecture" | "break";
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

export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(aEnd) > timeToMinutes(bStart);
}
