// Date-window queries for the Planner. Overlap is expressed as TWO plain
// indexed filters instead of one compound OR, so each half is a standard
// query on `anchor_at` / `end_at`:
//
//   point events (end_at IS NULL):  from <= anchor_at < to
//   ranged events (end_at set):     anchor_at < to  AND  end_at > from
//
// Their union is exactly: event_start < window_end AND event_end > window_start
// (with a point counted as inclusive at the window start, exclusive at the end).
// RLS still decides which rows exist for the caller — nothing here widens it.
import { supabase } from "./supabaseClient";
import { PLANNER_SELECT, normalizeEvent, overlapsWindow, sortByAnchor, type PlannerEvent } from "./planner";

const LIMIT = 500;

function merge(...lists: PlannerEvent[][]): PlannerEvent[] {
  const byId = new Map<string, PlannerEvent>();
  for (const list of lists) for (const ev of list) byId.set(ev.id, ev);
  return Array.from(byId.values()).sort(sortByAnchor);
}

export async function fetchOverlapping(
  from: Date,
  to: Date
): Promise<{ events: PlannerEvent[]; error: { code?: string; message?: string } | null; truncated: boolean }> {
  if (!supabase) return { events: [], error: { message: "Not connected." }, truncated: false };
  const f = from.toISOString();
  const t = to.toISOString();
  const [points, ranges] = await Promise.all([
    supabase.from("planner_events").select(PLANNER_SELECT).is("end_at", null)
      .gte("anchor_at", f).lt("anchor_at", t).order("anchor_at", { ascending: true }).limit(LIMIT),
    supabase.from("planner_events").select(PLANNER_SELECT)
      .lt("anchor_at", t).gt("end_at", f).order("anchor_at", { ascending: true }).limit(LIMIT),
  ]);
  const error = points.error ?? ranges.error;
  if (error) return { events: [], error, truncated: false };
  const events = merge((points.data ?? []).map(normalizeEvent), (ranges.data ?? []).map(normalizeEvent))
    // Defensive re-check with the identical rule (guards timestamp-precision edges).
    .filter((ev) => overlapsWindow(ev, from, to));
  return { events, error: null, truncated: (points.data?.length ?? 0) >= LIMIT || (ranges.data?.length ?? 0) >= LIMIT };
}

// Events that haven't finished yet: start today or later, or a multi-day
// event that started earlier and is still running.
export async function fetchNotOver(
  startOfToday: Date,
  now: Date,
  limit: number
): Promise<{ events: PlannerEvent[]; error: { code?: string; message?: string } | null }> {
  if (!supabase) return { events: [], error: { message: "Not connected." } };
  const [upcoming, running] = await Promise.all([
    supabase.from("planner_events").select(PLANNER_SELECT)
      .gte("anchor_at", startOfToday.toISOString()).order("anchor_at", { ascending: true }).limit(limit),
    supabase.from("planner_events").select(PLANNER_SELECT)
      .lt("anchor_at", startOfToday.toISOString()).gt("end_at", now.toISOString())
      .order("anchor_at", { ascending: true }).limit(limit),
  ]);
  const error = upcoming.error ?? running.error;
  if (error) return { events: [], error };
  return { events: merge((running.data ?? []).map(normalizeEvent), (upcoming.data ?? []).map(normalizeEvent)), error: null };
}
