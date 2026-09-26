import { useMemo } from "react";
import {
  addDays, calendarDayDiff, dayKey, deriveStatus, eventDayKeys, fmtDate, fmtDateLong, sortByAnchor, startOfLocalDay, startOfWeek,
  type PlannerEvent,
} from "../../lib/planner";
import { EmptyState } from "../ui/EmptyState";
import { EventChip, EventRow } from "./plannerUi";

interface ViewProps {
  events: PlannerEvent[];
  now: Date;
  onSelect: (ev: PlannerEvent) => void;
}

const EMPTY = "No upcoming academic events";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ─── Upcoming ─────────────────────────────────────────────────────────
export function UpcomingView({ events, now, onSelect }: ViewProps) {
  const groups = useMemo(() => {
    const sorted = [...events].sort(sortByAnchor);
    const overdue: PlannerEvent[] = [];
    const live: PlannerEvent[] = [];
    for (const ev of sorted) {
      const s = deriveStatus(ev, now);
      if (s === "overdue") overdue.push(ev);
      else if (s !== "completed") live.push(ev);
    }
    const comingUp = live.slice(0, 3);
    const rest = live.slice(3);
    const weekEnd = addDays(startOfLocalDay(now), 7);
    const thisWeek = rest.filter((e) => new Date(e.anchor_at) < weekEnd);
    const later = rest.filter((e) => new Date(e.anchor_at) >= weekEnd);
    return { overdue, comingUp, thisWeek, later };
  }, [events, now]);

  if (!groups.overdue.length && !groups.comingUp.length) {
    return <EmptyState title={EMPTY} message="Tests, assignments, IAs, exams and other events posted for you will appear here." />;
  }
  return (
    <div>
      {groups.overdue.length > 0 && (
        <Section title="⚠ Overdue">
          {groups.overdue.map((e) => <EventRow key={e.id} ev={e} now={now} onSelect={onSelect} />)}
        </Section>
      )}
      {groups.comingUp.length > 0 && (
        <Section title="🔥 Coming up">
          {groups.comingUp.map((e) => <EventRow key={e.id} ev={e} now={now} onSelect={onSelect} />)}
        </Section>
      )}
      {groups.thisWeek.length > 0 && (
        <Section title="📅 This week">
          {groups.thisWeek.map((e) => <EventRow key={e.id} ev={e} now={now} onSelect={onSelect} />)}
        </Section>
      )}
      {groups.later.length > 0 && (
        <Section title="Later">
          {groups.later.map((e) => <EventRow key={e.id} ev={e} now={now} onSelect={onSelect} />)}
        </Section>
      )}
    </div>
  );
}

// ─── List (chronological, grouped by day) ─────────────────────────────
export function ListView({ events, now, onSelect }: ViewProps) {
  const days = useMemo(() => {
    const map = new Map<string, PlannerEvent[]>();
    for (const ev of [...events].sort(sortByAnchor)) {
      const k = dayKey(new Date(ev.anchor_at));
      map.set(k, [...(map.get(k) ?? []), ev]);
    }
    return Array.from(map.entries());
  }, [events]);

  if (days.length === 0) return <EmptyState title={EMPTY} message="Nothing matches the current filters in this date range." />;
  return (
    <div>
      {days.map(([k, evs]) => {
        const d = new Date(evs[0].anchor_at);
        const diff = calendarDayDiff(now, d);
        const tag = diff === 0 ? " · Today" : diff === 1 ? " · Tomorrow" : "";
        return (
          <Section key={k} title={`${fmtDate(d)}${tag}`}>
            {evs.map((e) => <EventRow key={e.id} ev={e} now={now} onSelect={onSelect} showDate={false} />)}
          </Section>
        );
      })}
    </div>
  );
}

function groupByDay(events: PlannerEvent[]): Map<string, PlannerEvent[]> {
  const map = new Map<string, PlannerEvent[]>();
  for (const ev of [...events].sort(sortByAnchor)) {
    for (const k of eventDayKeys(ev)) map.set(k, [...(map.get(k) ?? []), ev]);
  }
  return map;
}

// ─── Week ─────────────────────────────────────────────────────────────
export function WeekView({ events, now, onSelect, cursor }: ViewProps & { cursor: Date }) {
  const start = startOfWeek(cursor);
  const byDay = useMemo(() => groupByDay(events), [events]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const todayKey = dayKey(now);
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
      {days.map((d) => {
        const k = dayKey(d);
        const evs = byDay.get(k) ?? [];
        return (
          <div key={k} className={`min-h-[5rem] rounded-md border bg-panel p-2 ${k === todayKey ? "border-trace" : "border-line"}`}>
            <p className={`mb-1.5 font-mono text-[11px] uppercase tracking-wide ${k === todayKey ? "text-trace-dark" : "text-inkmuted"}`}>{fmtDate(d)}</p>
            {evs.length === 0 ? (
              <p className="text-[11px] text-inkmuted/70 md:hidden">No events</p>
            ) : (
              <div className="space-y-1">
                {evs.map((e) => <EventChip key={`${k}-${e.id}`} ev={e} now={now} onSelect={onSelect} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Month ────────────────────────────────────────────────────────────
export function MonthView({
  events, now, onSelect, cursor, selectedDay, onSelectDay,
}: ViewProps & { cursor: Date; selectedDay: string | null; onSelectDay: (k: string) => void }) {
  const byDay = useMemo(() => groupByDay(events), [events]);
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const weeks = Math.ceil((((first.getDay() + 6) % 7) + new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const todayKey = dayKey(now);
  const selectedEvents = selectedDay ? byDay.get(selectedDay) ?? [] : [];

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center font-mono text-[10px] uppercase tracking-wide text-inkmuted">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const k = dayKey(d);
          const evs = byDay.get(k) ?? [];
          const inMonth = d.getMonth() === cursor.getMonth();
          const isSel = selectedDay === k;
          return (
            <div
              key={k}
              role="button"
              tabIndex={0}
              aria-label={`${fmtDateLong(d)}, ${evs.length} event${evs.length === 1 ? "" : "s"}`}
              onClick={() => onSelectDay(k)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectDay(k); } }}
              className={`min-h-[3.25rem] cursor-pointer rounded-md border p-1 sm:min-h-[5.5rem] sm:p-1.5 ${inMonth ? "bg-panel" : "bg-paper/60"} ${k === todayKey ? "border-trace" : isSel ? "border-copper" : "border-line"}`}
            >
              <p className={`text-[11px] sm:text-xs ${k === todayKey ? "font-semibold text-trace-dark" : inMonth ? "text-ink" : "text-inkmuted/60"}`}>{d.getDate()}</p>
              <div className="mt-0.5 hidden space-y-0.5 sm:block">
                {evs.slice(0, 2).map((e) => <EventChip key={`${k}-${e.id}`} ev={e} now={now} onSelect={onSelect} />)}
                {evs.length > 2 && <p className="text-[10px] text-inkmuted">+{evs.length - 2} more</p>}
              </div>
              {evs.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
                  {evs.slice(0, 3).map((e) => <span key={`${k}-${e.id}`} className="h-1.5 w-1.5 rounded-full bg-copper" />)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedDay && (
        <div className="mt-4">
          <p className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">
            {fmtDateLong(new Date(`${selectedDay}T00:00:00`))}
          </p>
          {selectedEvents.length === 0 ? (
            <p className="text-sm text-inkmuted">No events on this day.</p>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((e) => <EventRow key={e.id} ev={e} now={now} onSelect={onSelect} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
