import {
  EVENT_TYPE_META, PRIORITY_LABEL, STATUS_LABEL, countdownLabel, deriveStatus, targetLabel, whenLabel,
  type EventStatus, type PlannerEvent, type PlannerPriority,
} from "../../lib/planner";

const GROUP_TONE = {
  assessment: "bg-copper-light text-copper-dark",
  work: "bg-trace-light text-trace-dark",
  event: "bg-paper text-inkmuted border border-line",
} as const;

export function TypeBadge({ type }: { type: PlannerEvent["event_type"] }) {
  const meta = EVENT_TYPE_META[type];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${GROUP_TONE[meta.group]}`}>
      {meta.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: PlannerPriority }) {
  if (priority === "normal") return null;
  const cls = priority === "critical" ? "bg-danger text-white" : "border border-copper text-copper-dark";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${cls}`}>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

const STATUS_TONE: Record<EventStatus, string> = {
  overdue: "bg-danger/10 text-danger",
  today: "bg-trace-light text-trace-dark",
  due_soon: "bg-copper-light text-copper-dark",
  upcoming: "bg-paper text-inkmuted border border-line",
  completed: "bg-paper text-inkmuted border border-line",
};

export function StatusBadge({ status }: { status: EventStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// Left edge colour carries priority / urgency without adding noise.
function edgeClass(ev: PlannerEvent, status: EventStatus): string {
  if (status === "overdue" || ev.priority === "critical") return "border-l-danger";
  if (ev.priority === "important" || status === "due_soon") return "border-l-copper";
  if (status === "today") return "border-l-trace";
  return "border-l-line";
}

export function EventRow({
  ev, now, onSelect, showDate = true,
}: { ev: PlannerEvent; now: Date; onSelect: (ev: PlannerEvent) => void; showDate?: boolean }) {
  const status = deriveStatus(ev, now);
  const dim = status === "completed";
  const target = targetLabel(ev);
  return (
    <button
      type="button"
      onClick={() => onSelect(ev)}
      className={`block w-full rounded-md border border-l-4 border-line bg-panel px-3 py-2.5 text-left transition-colors hover:border-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper ${edgeClass(ev, status)} ${dim ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <TypeBadge type={ev.event_type} />
        <PriorityBadge priority={ev.priority} />
        {status !== "upcoming" && <StatusBadge status={status} />}
      </div>
      <p className="mt-1.5 font-body text-sm font-medium text-ink">{ev.title}</p>
      {target && <p className="text-xs text-inkmuted">{target}</p>}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-xs text-inkmuted">
        <span>{showDate ? whenLabel(ev) : whenLabel(ev).split(" · ").slice(1).join(" · ") || whenLabel(ev)}</span>
        {!dim && <span className="font-mono text-[11px] text-ink">{countdownLabel(ev, now)}</span>}
      </div>
    </button>
  );
}

// Compact chip used inside calendar cells.
export function EventChip({ ev, now, onSelect }: { ev: PlannerEvent; now: Date; onSelect: (ev: PlannerEvent) => void }) {
  const status = deriveStatus(ev, now);
  const tone =
    status === "overdue" || ev.priority === "critical" ? "bg-danger/10 text-danger"
    : ev.priority === "important" || status === "due_soon" ? "bg-copper-light text-copper-dark"
    : "bg-trace-light text-trace-dark";
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onSelect(ev); }}
      title={`${ev.title} — ${EVENT_TYPE_META[ev.event_type].label}`}
      className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] leading-tight ${tone} ${status === "completed" ? "opacity-60" : ""}`}
    >
      {ev.title}
    </button>
  );
}

