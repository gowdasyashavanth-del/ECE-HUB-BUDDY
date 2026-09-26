import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import type { UserRole } from "../../lib/types";
import {
  EVENT_TYPE_META, SCOPE_LABEL, countdownLabel, deriveStatus, targetLabel, whenLabel, type PlannerEvent,
} from "../../lib/planner";
import { PriorityBadge, StatusBadge, TypeBadge } from "./plannerUi";

interface Resources {
  unitName: string | null;
  topicName: string | null;
  notes: boolean;
  formulas: boolean;
  questions: boolean;
  test: { id: string; title: string } | null;
}

const ROLE_PREFIX: Record<UserRole, string> = { student: "/student", teacher: "/teacher", super_admin: "/admin" };

export function EventDetail({
  ev, now, role, canManage, onClose, onEdit, onDelete,
}: {
  ev: PlannerEvent;
  now: Date;
  role: UserRole;
  canManage: boolean;
  onClose: () => void;
  onEdit: (ev: PlannerEvent) => void;
  onDelete: (ev: PlannerEvent) => Promise<string | null>;
}) {
  const [res, setRes] = useState<Resources | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const status = deriveStatus(ev, now);
  const prefix = ROLE_PREFIX[role];

  // Look up which learning resources REALLY exist for this event, so a
  // link is only ever shown when there is something behind it. RLS
  // already limits every one of these reads to what this user may see.
  useEffect(() => {
    if (!supabase || !ev.subject_id) { setRes(null); return; }
    let cancelled = false;
    const sid = ev.subject_id;
    const count = (table: string, build: (q: any) => any) =>
      build(supabase!.from(table).select("id", { count: "exact", head: true })).then((r: any) => (r.error ? 0 : r.count ?? 0));
    (async () => {
      const [unit, topic, notes, formulas, questions, test] = await Promise.all([
        ev.unit_id ? supabase!.from("units").select("name").eq("id", ev.unit_id).maybeSingle() : Promise.resolve({ data: null }),
        ev.topic_id ? supabase!.from("topics").select("name").eq("id", ev.topic_id).maybeSingle() : Promise.resolve({ data: null }),
        count("notes", (q) => { let x = q.eq("subject_id", sid); if (ev.section_id) x = x.eq("section_id", ev.section_id); if (ev.topic_id) x = x.eq("topic_id", ev.topic_id); return x; }),
        count("formulas", (q) => { let x = q.eq("subject_id", sid); if (ev.topic_id) x = x.eq("topic_id", ev.topic_id); return x; }),
        role !== "student" && ev.topic_id ? count("questions", (q) => q.eq("topic_id", ev.topic_id)) : Promise.resolve(0),
        ev.test_id ? supabase!.from("tests").select("id, title").eq("id", ev.test_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      setRes({
        unitName: (unit as any).data?.name ?? null,
        topicName: (topic as any).data?.name ?? null,
        notes: notes > 0,
        formulas: formulas > 0,
        questions: questions > 0,
        test: (test as any).data ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [ev.id, ev.subject_id, ev.section_id, ev.unit_id, ev.topic_id, ev.test_id, role]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function confirmDelete() {
    setBusy(true);
    setErr(null);
    const message = await onDelete(ev);
    setBusy(false);
    if (message) setErr(message);
  }

  const linkCls = "rounded-full border border-line px-3 py-1 text-xs font-medium text-ink hover:border-copper";
  const target = targetLabel(ev);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={ev.title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-xl border border-line bg-panel p-5 shadow-xl sm:max-w-lg sm:rounded-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeBadge type={ev.event_type} />
            <PriorityBadge priority={ev.priority} />
            <StatusBadge status={status} />
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-inkmuted hover:text-ink">✕</button>
        </div>

        <h2 className="mt-3 font-display text-xl font-semibold text-ink">{ev.title}</h2>
        <p className="mt-1 text-sm text-ink">{whenLabel(ev)}</p>
        {status !== "completed" && <p className="font-mono text-xs text-inkmuted">{countdownLabel(ev, now)}</p>}

        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-inkmuted">For</dt><dd className="text-ink">{target || SCOPE_LABEL[ev.target_scope]}</dd></div>
          {ev.subjects && (
            <div className="flex gap-2"><dt className="w-20 shrink-0 text-inkmuted">Subject</dt><dd className="text-ink">{ev.subjects.name}{ev.subjects.code ? ` (${ev.subjects.code})` : ""}</dd></div>
          )}
          {res?.unitName && <div className="flex gap-2"><dt className="w-20 shrink-0 text-inkmuted">Unit</dt><dd className="text-ink">{res.unitName}</dd></div>}
          {res?.topicName && <div className="flex gap-2"><dt className="w-20 shrink-0 text-inkmuted">Topic</dt><dd className="text-ink">{res.topicName}</dd></div>}
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-inkmuted">Type</dt><dd className="text-ink">{EVENT_TYPE_META[ev.event_type].label}</dd></div>
        </dl>

        {ev.description && <p className="mt-4 whitespace-pre-wrap text-sm text-ink/90">{ev.description}</p>}

        {ev.subject_id && (
          <div className="mt-4 flex flex-wrap gap-2">
            {role === "student" && <Link to={`/student/subjects/${ev.subject_id}`} className={linkCls}>View subject</Link>}
            {res?.notes && <Link to={`${prefix}/notes`} className={linkCls}>Notes</Link>}
            {res?.formulas && <Link to={`${prefix}/formulas`} className={linkCls}>Formulas</Link>}
            {res?.questions && <Link to={`${prefix}/questions`} className={linkCls}>Questions</Link>}
            {res?.test && (
              <Link to={role === "student" ? `/student/tests/${res.test.id}` : `${prefix}/tests`} className={linkCls}>
                {role === "student" ? "Practice test" : "Linked test"}: {res.test.title}
              </Link>
            )}
          </div>
        )}

        {err && <p className="mt-3 text-sm text-danger" role="alert">{err}</p>}

        {canManage && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {!confirming ? (
              <>
                <button onClick={() => onEdit(ev)} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark">Edit</button>
                <button onClick={() => setConfirming(true)} className="rounded-md border border-danger/40 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/5">Delete</button>
              </>
            ) : (
              <>
                <span className="text-sm text-ink">Delete this event?</span>
                <button disabled={busy} onClick={confirmDelete} className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{busy ? "Deleting…" : "Yes, delete"}</button>
                <button disabled={busy} onClick={() => setConfirming(false)} className="rounded-md border border-line px-4 py-2 text-sm text-ink">Cancel</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
