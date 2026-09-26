import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchNotOver } from "../../lib/plannerQueries";
import { friendlyDbError } from "../../lib/supabaseErrors";
import {
  countdownLabel, deriveStatus, fmtShortDate, sortByAnchor, startOfLocalDay,
  type PlannerEvent,
} from "../../lib/planner";
import { LoadingState } from "../ui/LoadingState";
import { PriorityBadge, TypeBadge } from "./plannerUi";

// Next few real events for the signed-in student (RLS decides which
// rows exist for them). Renders an honest empty state when there are none.
export function UpcomingWidget({ limit = 5 }: { limit?: number }) {
  const [events, setEvents] = useState<PlannerEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    fetchNotOver(startOfLocalDay(new Date()), new Date(), limit + 5).then(({ events: rows, error: e }) => {
      if (cancelled) return;
      if (e) { setError(friendlyDbError(e as never, "planner events")); setEvents([]); return; }
      setEvents(rows.sort(sortByAnchor).filter((ev) => deriveStatus(ev, new Date()) !== "completed").slice(0, limit));
    });
    return () => { cancelled = true; };
  }, [limit]);

  return (
    <div className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">📅 Upcoming</p>
        <Link to="/student/planner" className="text-xs font-medium text-copper-dark hover:underline">Open Planner →</Link>
      </div>
      {events === null && <LoadingState label="Loading upcoming events…" />}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {events !== null && !error && events.length === 0 && (
        <div className="rounded-md border border-dashed border-line bg-panel px-3 py-4 text-sm text-inkmuted">No upcoming academic events.</div>
      )}
      {events !== null && events.length > 0 && (
        <div className="space-y-1.5">
          {events.map((ev) => (
            <Link key={ev.id} to="/student/planner" className="flex items-center gap-3 rounded-md border border-line bg-panel px-3 py-2 text-sm hover:border-copper">
              <span className="w-14 shrink-0 font-mono text-xs text-inkmuted">{fmtShortDate(new Date(ev.anchor_at))}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{ev.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <TypeBadge type={ev.event_type} />
                  <PriorityBadge priority={ev.priority} />
                  {ev.subjects && <span className="truncate text-xs text-inkmuted">{ev.subjects.name}</span>}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-ink">{countdownLabel(ev, now)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
