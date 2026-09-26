import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { fetchOverlapping } from "../../lib/plannerQueries";
import { useAuth } from "../../contexts/AuthContext";
import type { UserRole } from "../../lib/types";
import {
  EVENT_GROUP_LABEL, EVENT_TYPES_BY_GROUP, EVENT_TYPE_META, PLANNER_SELECT, PRIORITY_LABEL, SCOPE_LABEL,
  addDays, normalizeEvent, startOfLocalDay, startOfWeek, fmtShortDate,
  type EventGroup, type PlannerEvent, type PlannerEventType, type PlannerPriority, type PlannerScope,
} from "../../lib/planner";
import { PageHeader } from "../ui/PageHeader";
import { LoadingState } from "../ui/LoadingState";
import { ErrorState } from "../ui/ErrorState";
import { EventDetail } from "./EventDetail";
import { EventForm, type Hierarchy, type TeacherScopeOption } from "./EventForm";
import { ListView, MonthView, UpcomingView, WeekView } from "./PlannerViews";

type View = "upcoming" | "month" | "week" | "list";
const VIEWS: { key: View; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "list", label: "List" },
];

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// Date window fetched for each view — bounded, indexed on anchor_at,
// so the page never pulls the whole table.
function windowFor(view: View, cursor: Date, now: Date): { from: Date; to: Date } {
  const today = startOfLocalDay(now);
  switch (view) {
    case "upcoming": return { from: addDays(today, -14), to: addDays(today, 90) };
    case "list": return { from: addDays(today, -30), to: addDays(today, 180) };
    case "week": { const s = startOfWeek(cursor); return { from: s, to: addDays(s, 7) }; }
    case "month": {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const s = startOfWeek(first);
      const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const weeks = Math.ceil((((first.getDay() + 6) % 7) + days) / 7);
      return { from: s, to: addDays(s, weeks * 7) };
    }
  }
}

const selectCls = "rounded-md border border-line bg-panel px-2.5 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper";

export function PlannerPage({ role }: { role: UserRole }) {
  const { profile } = useAuth();
  const now = useNow(60_000);
  const [searchParams, setSearchParams] = useSearchParams();

  const [view, setView] = useState<View>(() => (typeof window !== "undefined" && window.innerWidth < 640 ? "list" : "upcoming"));
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [events, setEvents] = useState<PlannerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | PlannerEventType>("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"" | PlannerPriority>("");
  const [scopeFilter, setScopeFilter] = useState<"" | PlannerScope>("");
  const [hidePast, setHidePast] = useState(true);

  const [selected, setSelected] = useState<PlannerEvent | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PlannerEvent | null>(null);

  const [teacherOptions, setTeacherOptions] = useState<TeacherScopeOption[] | null>(role === "teacher" ? null : []);
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);

  // ── Teacher: the (subject, section) pairs they actually teach. Used
  //    only to build the form and hide buttons — the DB re-checks every
  //    write against teacher_assignments regardless. ──
  useEffect(() => {
    if (role !== "teacher" || !supabase || !profile) return;
    let cancelled = false;
    supabase
      .from("teacher_assignments")
      .select("section_id, subject_id, sections(id, name), subjects(id, name, code)")
      .eq("teacher_id", profile.id)
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) { setTeacherOptions([]); return; }
        setTeacherOptions(
          (data ?? []).map((r: any) => ({
            section_id: r.section_id,
            subject_id: r.subject_id,
            sectionName: first<{ name: string }>(r.sections)?.name ?? "—",
            subjectName: first<{ name: string }>(r.subjects)?.name ?? "—",
            subjectCode: first<{ code: string | null }>(r.subjects)?.code ?? null,
          }))
        );
      });
    return () => { cancelled = true; };
  }, [role, profile]);

  // ── Admin: the existing academic hierarchy (no parallel structure). ──
  useEffect(() => {
    if (role !== "super_admin" || !supabase) return;
    let cancelled = false;
    Promise.all([
      supabase.from("academic_years").select("id, name").order("name"),
      supabase.from("regulations").select("id, academic_year_id, name").order("name"),
      supabase.from("programs").select("id, regulation_id, name").order("name"),
      supabase.from("semesters").select("id, program_id, number").order("number"),
      supabase.from("sections").select("id, name, semester_id, academic_year_id").order("name"),
      supabase.from("subjects").select("id, name, code, semester_id").order("order_number"),
    ]).then(([y, r, p, sem, sec, sub]) => {
      if (cancelled) return;
      if ([y, r, p, sem, sec, sub].some((x) => x.error)) return;
      setHierarchy({
        years: (y.data ?? []) as Hierarchy["years"],
        regs: (r.data ?? []) as Hierarchy["regs"],
        programs: (p.data ?? []) as Hierarchy["programs"],
        semesters: (sem.data ?? []) as Hierarchy["semesters"],
        sections: (sec.data ?? []) as Hierarchy["sections"],
        subjects: (sub.data ?? []) as Hierarchy["subjects"],
      });
    });
    return () => { cancelled = true; };
  }, [role]);

  // ── Events for the active view's date window (RLS decides which). ──
  const win = useMemo(() => windowFor(view, cursor, new Date()), [view, cursor]);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Overlap, not "starts inside": a multi-day event that began before
    // the window (or ends after it) is still returned.
    fetchOverlapping(win.from, win.to).then(({ events: rows, error: e, truncated: t }) => {
      if (cancelled) return;
      setLoading(false);
      if (e) { setError(friendlyDbError(e as never, "planner events")); return; }
      setEvents(rows);
      setTruncated(t);
    });
    return () => { cancelled = true; };
  }, [win, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Deep link from Global Search (?event=<id>): fetch that one event —
  // through RLS like everything else — and open its detail.
  const deepLinkId = searchParams.get("event");
  useEffect(() => {
    if (!supabase || !deepLinkId) return;
    let cancelled = false;
    supabase.from("planner_events").select(PLANNER_SELECT).eq("id", deepLinkId).maybeSingle().then(({ data }) => {
      if (cancelled) return;
      if (data) {
        const ev = normalizeEvent(data);
        setSelected(ev);
        setCursor(new Date(ev.anchor_at));
      }
      const next = new URLSearchParams(searchParams);
      next.delete("event");
      setSearchParams(next, { replace: true });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkId]);

  const canManage = useCallback((ev: PlannerEvent) => {
    if (role === "super_admin") return true;
    if (role !== "teacher" || !teacherOptions) return false;
    return ev.target_scope === "subject" && !!ev.section_id && !!ev.subject_id &&
      teacherOptions.some((o) => o.subject_id === ev.subject_id && o.section_id === ev.section_id);
  }, [role, teacherOptions]);

  const canCreate = role === "super_admin" || (role === "teacher" && (teacherOptions?.length ?? 0) > 0);

  const subjectOptions = useMemo(() => {
    const m = new Map<string, string>();
    events.forEach((e) => { if (e.subjects) m.set(e.subjects.id, e.subjects.name); });
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [events]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (typeFilter && e.event_type !== typeFilter) return false;
      if (subjectFilter && e.subject_id !== subjectFilter) return false;
      if (priorityFilter && e.priority !== priorityFilter) return false;
      if (scopeFilter && e.target_scope !== scopeFilter) return false;
      if (q && !`${e.title} ${e.description ?? ""} ${e.subjects?.name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [events, search, typeFilter, subjectFilter, priorityFilter, scopeFilter]);

  const listEvents = useMemo(() => {
    if (!hidePast) return filtered;
    const today = startOfLocalDay(now).getTime();
    return filtered.filter((e) => new Date(e.anchor_at).getTime() >= today || e.event_type === "assignment" || e.event_type === "project_submission" || e.event_type === "lab_record_submission");
  }, [filtered, hidePast, now]);

  const anyFilter = !!(search || typeFilter || subjectFilter || priorityFilter || scopeFilter);

  async function deleteEvent(ev: PlannerEvent): Promise<string | null> {
    if (!supabase) return "Not connected.";
    const { data, error: e } = await supabase.from("planner_events").delete().eq("id", ev.id).select("id");
    if (e) return friendlyDbError(e, "event");
    if (!data || data.length === 0) return "You don't have permission to delete this event.";
    setSelected(null);
    reload();
    return null;
  }

  function shift(delta: number) {
    if (view === "week") setCursor((c) => addDays(c, delta * 7));
    else if (view === "month") setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
    setSelectedDay(null);
  }

  const periodLabel =
    view === "month"
      ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : view === "week"
        ? `${fmtShortDate(startOfWeek(cursor))} – ${fmtShortDate(addDays(startOfWeek(cursor), 6))}`
        : "";

  const subtitle =
    role === "student" ? "Everything coming up for your section, in one place."
    : role === "teacher" ? "Events for the subjects and sections you teach. You can manage the ones for your own subjects."
    : "Plan and manage academic events across the whole academic structure.";

  return (
    <div>
      <PageHeader
        title="Academic Planner"
        subtitle={subtitle}
        action={
          canCreate ? (
            <button
              onClick={() => { setEditing(null); setFormOpen(true); }}
              className="shrink-0 rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
            >
              + Create Event
            </button>
          ) : undefined
        }
      />

      {role === "teacher" && teacherOptions !== null && teacherOptions.length === 0 && (
        <p className="mb-4 rounded-md border border-line bg-panel px-3 py-2 text-sm text-inkmuted">
          You can create planner events once an admin assigns you a subject and section.
        </p>
      )}

      {/* View switcher */}
      <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Planner view">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            onClick={() => { setView(v.key); setSelectedDay(null); }}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${view === v.key ? "bg-copper text-white" : "border border-line text-ink hover:border-copper"}`}
          >
            {v.label}
          </button>
        ))}
        {(view === "month" || view === "week") && (
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => shift(-1)} aria-label="Previous" className="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink hover:border-copper">‹</button>
            <button onClick={() => { setCursor(new Date()); setSelectedDay(null); }} className="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink hover:border-copper">Today</button>
            <button onClick={() => shift(1)} aria-label="Next" className="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink hover:border-copper">›</button>
          </div>
        )}
      </div>
      {periodLabel && <p className="mb-3 font-display text-base font-semibold text-ink">{periodLabel}</p>}

      {/* Filters */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events…"
          aria-label="Search events"
          className={`${selectCls} col-span-2 sm:w-56`}
        />
        <select aria-label="Filter by type" className={selectCls} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as "" | PlannerEventType)}>
          <option value="">All types</option>
          {(Object.keys(EVENT_TYPES_BY_GROUP) as EventGroup[]).map((g) => (
            <optgroup key={g} label={EVENT_GROUP_LABEL[g]}>
              {EVENT_TYPES_BY_GROUP[g].map((t) => <option key={t} value={t}>{EVENT_TYPE_META[t].label}</option>)}
            </optgroup>
          ))}
        </select>
        <select aria-label="Filter by subject" className={selectCls} value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
          <option value="">All subjects</option>
          {subjectOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select aria-label="Filter by priority" className={selectCls} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as "" | PlannerPriority)}>
          <option value="">Any priority</option>
          {(Object.keys(PRIORITY_LABEL) as PlannerPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        {role === "super_admin" && (
          <select aria-label="Filter by target" className={selectCls} value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as "" | PlannerScope)}>
            <option value="">Any target</option>
            {(Object.keys(SCOPE_LABEL) as PlannerScope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
          </select>
        )}
        {view === "list" && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={hidePast} onChange={(e) => setHidePast(e.target.checked)} /> Hide past
          </label>
        )}
        {anyFilter && (
          <button
            onClick={() => { setSearch(""); setTypeFilter(""); setSubjectFilter(""); setPriorityFilter(""); setScopeFilter(""); }}
            className="text-sm font-medium text-copper-dark underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading && <LoadingState label="Loading planner…" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && (
        <>
          {view === "upcoming" && <UpcomingView events={filtered} now={now} onSelect={setSelected} />}
          {view === "list" && <ListView events={listEvents} now={now} onSelect={setSelected} />}
          {view === "week" && (
            <>
              <WeekView events={filtered} now={now} onSelect={setSelected} cursor={cursor} />
              {filtered.length === 0 && <p className="mt-3 text-sm text-inkmuted">No academic events this week.</p>}
            </>
          )}
          {view === "month" && (
            <>
              <MonthView events={filtered} now={now} onSelect={setSelected} cursor={cursor} selectedDay={selectedDay} onSelectDay={(k) => setSelectedDay(k === selectedDay ? null : k)} />
              {filtered.length === 0 && <p className="mt-3 text-sm text-inkmuted">No academic events this month.</p>}
            </>
          )}
          {truncated && <p className="mt-3 text-xs text-inkmuted">Showing the first 500 events in this range — narrow the filters or date range to see the rest.</p>}
        </>
      )}

      {selected && (
        <EventDetail
          ev={selected}
          now={now}
          role={role}
          canManage={canManage(selected)}
          onClose={() => setSelected(null)}
          onEdit={(ev) => { setSelected(null); setEditing(ev); setFormOpen(true); }}
          onDelete={deleteEvent}
        />
      )}

      {formOpen && (role === "teacher" || role === "super_admin") && (
        <EventForm
          mode={role === "teacher" ? "teacher" : "admin"}
          teacherOptions={teacherOptions ?? []}
          hierarchy={hierarchy ?? undefined}
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); reload(); }}
        />
      )}
    </div>
  );
}

