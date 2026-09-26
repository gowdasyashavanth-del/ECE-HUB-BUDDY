import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import {
  EVENT_GROUP_LABEL, EVENT_TYPES_BY_GROUP, EVENT_TYPE_META, PRIORITY_LABEL, SCOPE_LABEL,
  localInputDate, localInputTime, localToIso,
  type EventGroup, type PlannerEvent, type PlannerEventType, type PlannerPriority, type PlannerScope,
} from "../../lib/planner";

export interface TeacherScopeOption {
  section_id: string;
  subject_id: string;
  sectionName: string;
  subjectName: string;
  subjectCode: string | null;
}

export interface Hierarchy {
  years: { id: string; name: string }[];
  regs: { id: string; academic_year_id: string; name: string }[];
  programs: { id: string; regulation_id: string; name: string }[];
  semesters: { id: string; program_id: string; number: number }[];
  sections: { id: string; name: string; semester_id: string; academic_year_id: string }[];
  subjects: { id: string; name: string; code: string | null; semester_id: string }[];
}

const inputCls = "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper";
const labelCls = "mb-1 block text-xs font-medium text-inkmuted";

// Which cascade levels each admin scope needs, in order.
const SCOPE_LEVELS: Record<PlannerScope, string[]> = {
  all: [],
  academic_year: ["year"],
  regulation: ["year", "reg"],
  program: ["year", "reg", "prog"],
  semester: ["year", "reg", "prog", "sem"],
  section: ["year", "reg", "prog", "sem", "sec"],
  subject: ["year", "reg", "prog", "sem", "subj", "sec"],
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className={labelCls}>{label}</span>{children}</label>;
}

export function EventForm({
  mode, teacherOptions, hierarchy, initial, onClose, onSaved,
}: {
  mode: "teacher" | "admin";
  teacherOptions?: TeacherScopeOption[];
  hierarchy?: Hierarchy;
  initial: PlannerEvent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = initial !== null;

  const [eventType, setEventType] = useState<PlannerEventType>(initial?.event_type ?? "test");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState<PlannerPriority>(initial?.priority ?? "normal");

  // ── time fields (local wall-clock; converted to UTC on save) ──
  const meta = EVENT_TYPE_META[eventType];
  const initKind = initial ? EVENT_TYPE_META[initial.event_type].kind : null;
  const [allDay, setAllDay] = useState(initial ? initial.all_day : EVENT_TYPE_META[eventType].defaultAllDay);
  const [date, setDate] = useState(initKind === "timed" ? localInputDate(initial!.start_at) : "");
  const [startTime, setStartTime] = useState(initKind === "timed" && !initial!.all_day ? localInputTime(initial!.start_at) : "09:00");
  const [endTime, setEndTime] = useState(initKind === "timed" && !initial!.all_day && initial!.end_at ? localInputTime(initial!.end_at) : "");
  const [endDate, setEndDate] = useState(initKind === "timed" && initial!.all_day && initial!.end_at ? localInputDate(initial!.end_at) : "");
  const [assignedDate, setAssignedDate] = useState(initKind === "deadline" ? localInputDate(initial!.start_at) : "");
  const [dueDate, setDueDate] = useState(initKind === "deadline" ? localInputDate(initial!.due_at) : "");
  const [dueTime, setDueTime] = useState(initKind === "deadline" && initial!.due_at ? localInputTime(initial!.due_at) : "17:00");

  // ── targeting ──
  const [teacherKey, setTeacherKey] = useState(
    initial && initial.section_id && initial.subject_id ? `${initial.subject_id}|${initial.section_id}` : (teacherOptions && teacherOptions.length === 1 ? `${teacherOptions[0].subject_id}|${teacherOptions[0].section_id}` : "")
  );
  const [scope, setScope] = useState<PlannerScope>(initial?.target_scope ?? "subject");
  const [yearId, setYearId] = useState(initial?.academic_year_id ?? "");
  const [regId, setRegId] = useState(initial?.regulation_id ?? "");
  const [progId, setProgId] = useState(initial?.program_id ?? "");
  const [semId, setSemId] = useState(initial?.semester_id ?? "");
  const [secId, setSecId] = useState(initial?.section_id ?? "");
  const [subjId, setSubjId] = useState(initial?.subject_id ?? "");

  // ── optional unit / topic / linked test ──
  const [unitId, setUnitId] = useState(initial?.unit_id ?? "");
  const [topicId, setTopicId] = useState(initial?.topic_id ?? "");
  const [testId, setTestId] = useState(initial?.test_id ?? "");
  const [units, setUnits] = useState<{ id: string; name: string }[]>([]);
  const [topics, setTopics] = useState<{ id: string; name: string }[]>([]);
  const [tests, setTests] = useState<{ id: string; title: string }[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const levels = SCOPE_LEVELS[scope];

  // The subject the unit/topic/test pickers relate to, if any.
  const effectiveSubjectId = useMemo(() => {
    if (mode === "teacher") return teacherKey ? teacherKey.split("|")[0] : "";
    return scope === "subject" ? subjId : "";
  }, [mode, teacherKey, scope, subjId]);

  useEffect(() => {
    if (!supabase || !effectiveSubjectId) { setUnits([]); setTests([]); return; }
    let cancelled = false;
    (async () => {
      const [u, t] = await Promise.all([
        supabase!.from("units").select("id, name").eq("subject_id", effectiveSubjectId).order("order_number"),
        supabase!.from("tests").select("id, title").eq("subject_id", effectiveSubjectId).order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setUnits((u.data ?? []) as { id: string; name: string }[]);
      setTests((t.data ?? []) as { id: string; title: string }[]);
    })();
    return () => { cancelled = true; };
  }, [effectiveSubjectId]);

  useEffect(() => {
    if (!supabase || !unitId) { setTopics([]); return; }
    let cancelled = false;
    supabase.from("topics").select("id, name").eq("unit_id", unitId).order("order_number").then(({ data }) => {
      if (!cancelled) setTopics((data ?? []) as { id: string; name: string }[]);
    });
    return () => { cancelled = true; };
  }, [unitId]);

  function changeType(t: PlannerEventType) {
    setEventType(t);
    setAllDay(EVENT_TYPE_META[t].defaultAllDay);
    if (!EVENT_TYPE_META[t].canLinkTest) setTestId("");
  }
  function changeTeacherKey(k: string) { setTeacherKey(k); setUnitId(""); setTopicId(""); setTestId(""); }
  function changeScope(s: PlannerScope) {
    setScope(s);
    setUnitId(""); setTopicId(""); setTestId("");
  }

  // Cascade handlers: changing a level clears everything below it.
  const h = hierarchy;
  const regOptions = h ? h.regs.filter((r) => !yearId || r.academic_year_id === yearId) : [];
  const progOptions = h ? h.programs.filter((p) => !regId || p.regulation_id === regId) : [];
  const semOptions = h ? h.semesters.filter((s) => !progId || s.program_id === progId) : [];
  const secOptions = h ? h.sections.filter((s) => !semId || s.semester_id === semId) : [];
  const subjOptions = h ? h.subjects.filter((s) => !semId || s.semester_id === semId) : [];

  function buildTimes(): { start_at: string | null; end_at: string | null; due_at: string | null; all_day: boolean } | string {
    if (meta.kind === "deadline") {
      if (!dueDate) return "Choose a due date.";
      if (!dueTime) return "Choose a due time.";
      const due = localToIso(dueDate, dueTime);
      const start = assignedDate ? localToIso(assignedDate, "00:00") : null;
      if (start && new Date(due) < new Date(start)) return "Due date can't be before the assigned date.";
      return { start_at: start, end_at: null, due_at: due, all_day: false };
    }
    if (!date) return "Choose a date.";
    if (allDay) {
      if (endDate && endDate < date) return "End date can't be before the start date.";
      return { start_at: localToIso(date, "00:00"), end_at: endDate ? localToIso(endDate, "23:59") : null, due_at: null, all_day: true };
    }
    if (!startTime) return "Choose a start time.";
    if (endTime && endTime < startTime) return "End time can't be before the start time.";
    return { start_at: localToIso(date, startTime), end_at: endTime ? localToIso(date, endTime) : null, due_at: null, all_day: false };
  }

  async function save() {
    if (!supabase) return;
    setError(null);
    if (!title.trim()) { setError("Enter a title."); return; }

    let target: { target_scope: PlannerScope; academic_year_id: string | null; regulation_id: string | null; program_id: string | null; semester_id: string | null; section_id: string | null; subject_id: string | null };
    if (mode === "teacher") {
      if (!teacherKey) { setError("Choose the subject and section this event is for."); return; }
      const [subject_id, section_id] = teacherKey.split("|");
      target = { target_scope: "subject", academic_year_id: null, regulation_id: null, program_id: null, semester_id: null, section_id, subject_id };
    } else {
      const need = SCOPE_LEVELS[scope].filter((l) => l !== "sec" || scope === "section");
      const missing = need.find((l) => ({ year: !yearId, reg: !regId, prog: !progId, sem: !semId, sec: !secId, subj: !subjId } as Record<string, boolean>)[l]);
      if (missing) { setError("Complete every target selection."); return; }
      // Only the scope's own level is sent — the database derives and
      // validates every ancestor from it.
      target = {
        target_scope: scope,
        academic_year_id: scope === "academic_year" ? yearId : null,
        regulation_id: scope === "regulation" ? regId : null,
        program_id: scope === "program" ? progId : null,
        semester_id: scope === "semester" ? semId : null,
        section_id: scope === "section" || (scope === "subject" && secId) ? secId : null,
        subject_id: scope === "subject" ? subjId : null,
      };
    }

    const times = buildTimes();
    if (typeof times === "string") { setError(times); return; }

    const hasSubject = !!target.subject_id;
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      event_type: eventType,
      priority,
      ...target,
      unit_id: hasSubject && unitId ? unitId : null,
      topic_id: hasSubject && unitId && topicId ? topicId : null,
      test_id: hasSubject && meta.canLinkTest && testId ? testId : null,
      ...times,
    };

    setSaving(true);
    if (editing) {
      const { data, error: e } = await supabase.from("planner_events").update(payload).eq("id", initial!.id).select("id");
      setSaving(false);
      if (e) { setError(friendlyDbError(e, "event")); return; }
      if (!data || data.length === 0) { setError("You don't have permission to change this event."); return; }
    } else {
      const { error: e } = await supabase.from("planner_events").insert(payload);
      setSaving(false);
      if (e) { setError(friendlyDbError(e, "event")); return; }
    }
    onSaved();
  }

  const showSubjectExtras = !!effectiveSubjectId;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={editing ? "Edit event" : "Create event"}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-xl border border-line bg-panel p-5 shadow-xl sm:max-w-xl sm:rounded-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink">{editing ? "Edit event" : "Create event"}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-inkmuted hover:text-ink">✕</button>
        </div>

        <div className="space-y-4">
          <Field label="Event type">
            <select className={inputCls} value={eventType} onChange={(e) => changeType(e.target.value as PlannerEventType)}>
              {(Object.keys(EVENT_TYPES_BY_GROUP) as EventGroup[]).map((g) => (
                <optgroup key={g} label={EVENT_GROUP_LABEL[g]}>
                  {EVENT_TYPES_BY_GROUP[g].map((t) => <option key={t} value={t}>{EVENT_TYPE_META[t].label}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field label="Title">
            <input className={inputCls} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Unit 2 test" />
          </Field>

          {/* ── Target ── */}
          {mode === "teacher" ? (
            <Field label="Subject & section">
              <select className={inputCls} value={teacherKey} onChange={(e) => changeTeacherKey(e.target.value)}>
                <option value="">Select…</option>
                {(teacherOptions ?? []).map((o) => (
                  <option key={`${o.subject_id}|${o.section_id}`} value={`${o.subject_id}|${o.section_id}`}>
                    {o.subjectName}{o.subjectCode ? ` (${o.subjectCode})` : ""} — Section {o.sectionName}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="space-y-3 rounded-md border border-line p-3">
              <Field label="Who is this for?">
                <select className={inputCls} value={scope} onChange={(e) => changeScope(e.target.value as PlannerScope)}>
                  {(Object.keys(SCOPE_LABEL) as PlannerScope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                </select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                {levels.includes("year") && (
                  <Field label="Academic year">
                    <select className={inputCls} value={yearId} onChange={(e) => { setYearId(e.target.value); setRegId(""); setProgId(""); setSemId(""); setSecId(""); setSubjId(""); }}>
                      <option value="">Select…</option>
                      {h?.years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                    </select>
                  </Field>
                )}
                {levels.includes("reg") && (
                  <Field label="Regulation">
                    <select className={inputCls} value={regId} onChange={(e) => { setRegId(e.target.value); setProgId(""); setSemId(""); setSecId(""); setSubjId(""); }}>
                      <option value="">Select…</option>
                      {regOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </Field>
                )}
                {levels.includes("prog") && (
                  <Field label="Program">
                    <select className={inputCls} value={progId} onChange={(e) => { setProgId(e.target.value); setSemId(""); setSecId(""); setSubjId(""); }}>
                      <option value="">Select…</option>
                      {progOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                )}
                {levels.includes("sem") && (
                  <Field label="Semester">
                    <select className={inputCls} value={semId} onChange={(e) => { setSemId(e.target.value); setSecId(""); setSubjId(""); setUnitId(""); setTopicId(""); setTestId(""); }}>
                      <option value="">Select…</option>
                      {semOptions.map((s) => <option key={s.id} value={s.id}>Semester {s.number}</option>)}
                    </select>
                  </Field>
                )}
                {levels.includes("subj") && (
                  <Field label="Subject">
                    <select className={inputCls} value={subjId} onChange={(e) => { setSubjId(e.target.value); setUnitId(""); setTopicId(""); setTestId(""); }}>
                      <option value="">Select…</option>
                      {subjOptions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ""}</option>)}
                    </select>
                  </Field>
                )}
                {levels.includes("sec") && (
                  <Field label={scope === "subject" ? "Section (optional)" : "Section"}>
                    <select className={inputCls} value={secId} onChange={(e) => setSecId(e.target.value)}>
                      <option value="">{scope === "subject" ? "All sections" : "Select…"}</option>
                      {secOptions.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
                    </select>
                  </Field>
                )}
              </div>
            </div>
          )}

          {/* ── Time fields, adapted to the event type ── */}
          {meta.kind === "deadline" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Assigned on (optional)"><input type="date" className={inputCls} value={assignedDate} onChange={(e) => setAssignedDate(e.target.value)} /></Field>
              <Field label="Due date"><input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
              <Field label="Due time"><input type="time" className={inputCls} value={dueTime} onChange={(e) => setDueTime(e.target.value)} /></Field>
            </div>
          ) : (
            <div className="space-y-3">
              {meta.allowAllDay && (
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All-day event
                </label>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                {allDay ? (
                  <Field label="End date (optional)"><input type="date" className={inputCls} value={endDate} min={date || undefined} onChange={(e) => setEndDate(e.target.value)} /></Field>
                ) : (
                  <>
                    <Field label="Start time"><input type="time" className={inputCls} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
                    <Field label="End time (optional)"><input type="time" className={inputCls} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
                  </>
                )}
              </div>
            </div>
          )}

          <div>
            <span className={labelCls}>Priority</span>
            <div className="flex gap-2" role="radiogroup" aria-label="Priority">
              {(Object.keys(PRIORITY_LABEL) as PlannerPriority[]).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={priority === p} onClick={() => setPriority(p)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${priority === p ? "bg-copper text-white" : "border border-line text-ink"}`}>
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          {showSubjectExtras && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Unit (optional)">
                <select className={inputCls} value={unitId} onChange={(e) => { setUnitId(e.target.value); setTopicId(""); }}>
                  <option value="">None</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="Topic (optional)">
                <select className={inputCls} value={topicId} disabled={!unitId} onChange={(e) => setTopicId(e.target.value)}>
                  <option value="">None</option>
                  {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              {meta.canLinkTest && tests.length > 0 && (
                <div className="sm:col-span-2">
                  <Field label="Linked practice test (optional)">
                    <select className={inputCls} value={testId} onChange={(e) => setTestId(e.target.value)}>
                      <option value="">None</option>
                      {tests.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                    </select>
                  </Field>
                </div>
              )}
            </div>
          )}

          <Field label="Description (optional)">
            <textarea className={inputCls} rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>

        {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="rounded-md border border-line px-4 py-2 text-sm text-ink">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-60">
            {saving ? "Saving…" : editing ? "Save changes" : "Create event"}
          </button>
        </div>
      </div>
    </div>
  );
}
