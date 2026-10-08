import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import {
  SUGGESTED_SLOTS,
  OFFICIAL_TIMETABLE_COLUMNS,
  PERIOD_SLOTS,
  TIMETABLE_DAYS,
  DAY_NAMES,
  rangesOverlap,
  timeToMinutes,
  formatTimeRange12,
} from "../../lib/timetableSlots";

interface Year { id: string; name: string; }
interface Reg { id: string; name: string; academic_year_id: string; }
interface Prog { id: string; name: string; regulation_id: string; }
interface Sem { id: string; number: number; program_id: string; }
interface Sect { id: string; name: string; semester_id: string; academic_year_id: string; }
interface Subj { id: string; name: string; code: string | null; semester_id: string; }
interface Teacher { id: string; full_name: string; email: string; }
interface TA { teacher_id: string; section_id: string; subject_id: string; }
interface Batch { id: string; section_id: string; name: string; }
interface Entry {
  id: string;
  section_id: string;
  day_of_week: number;
  period_order: number;
  start_time: string;
  end_time: string;
  subject_id: string | null;
  teacher_id: string | null;
  room: string | null;
  lab_batch_id: string | null;
  block_type: string;
  label: string | null;
  notes: string | null;
}

const BLOCK_TYPES = ["lecture", "lab", "activity", "break", "other"] as const;
const DAYS = TIMETABLE_DAYS; // Monday..Saturday [1, 2, 3, 4, 5, 6]

type FormState = {
  id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  block_type: string;
  subject_id: string;
  teacher_id: string;
  lab_batch_id: string;
  room: string;
  label: string;
  notes: string;
  period_order: number;
};

const emptyForm = (day: number, start: string, end: string, period: number): FormState => ({
  id: null,
  day_of_week: day,
  start_time: start,
  end_time: end,
  block_type: "lecture",
  subject_id: "",
  teacher_id: "",
  lab_batch_id: "",
  room: "",
  label: "",
  notes: "",
  period_order: period,
});

const selectCls = "mt-1 w-full rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-ink";

export function AdminTimetablePage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [years, setYears] = useState<Year[]>([]);
  const [regs, setRegs] = useState<Reg[]>([]);
  const [programs, setPrograms] = useState<Prog[]>([]);
  const [semesters, setSemesters] = useState<Sem[]>([]);
  const [sections, setSections] = useState<Sect[]>([]);
  const [subjects, setSubjects] = useState<Subj[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherAssignments, setTeacherAssignments] = useState<TA[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [allEntries, setAllEntries] = useState<Entry[]>([]);

  const [yearId, setYearId] = useState("");
  const [regId, setRegId] = useState("");
  const [progId, setProgId] = useState("");
  const [semId, setSemId] = useState("");
  const [sectionId, setSectionId] = useState("");

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase) return;
    setLoadError(null);
    setLoading(true);
    const [y, r, p, s, sec, subj, t, ta, lb, ent] = await Promise.all([
      supabase.from("academic_years").select("id, name").order("name"),
      supabase.from("regulations").select("id, name, academic_year_id"),
      supabase.from("programs").select("id, name, regulation_id"),
      supabase.from("semesters").select("id, number, program_id"),
      supabase.from("sections").select("id, name, semester_id, academic_year_id"),
      supabase.from("subjects").select("id, name, code, semester_id"),
      supabase.from("users").select("id, full_name, email").eq("role", "teacher").order("full_name"),
      supabase.from("teacher_assignments").select("teacher_id, section_id, subject_id"),
      supabase.from("lab_batches").select("id, section_id, name"),
      supabase
        .from("timetable_entries")
        .select("id, section_id, day_of_week, period_order, start_time, end_time, subject_id, teacher_id, room, lab_batch_id, block_type, label, notes")
        .eq("is_current", true),
    ]);
    setLoading(false);
    const firstErr = [y, r, p, s, sec, subj, t, ta, lb, ent].find((res) => res.error);
    if (firstErr?.error) {
      setLoadError(friendlyDbError(firstErr.error, "Timetable data"));
      return;
    }
    setYears(y.data ?? []);
    setRegs(r.data ?? []);
    setPrograms(p.data ?? []);
    setSemesters(s.data ?? []);
    setSections(sec.data ?? []);
    setSubjects(subj.data ?? []);
    setTeachers(t.data ?? []);
    setTeacherAssignments(ta.data ?? []);
    setBatches(lb.data ?? []);
    setAllEntries((ent.data ?? []) as Entry[]);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const filteredRegs = useMemo(() => regs.filter((r) => r.academic_year_id === yearId), [regs, yearId]);
  const filteredPrograms = useMemo(() => programs.filter((p) => p.regulation_id === regId), [programs, regId]);
  const filteredSemesters = useMemo(() => semesters.filter((s) => s.program_id === progId), [semesters, progId]);
  const filteredSections = useMemo(
    () => sections.filter((s) => s.semester_id === semId && s.academic_year_id === yearId),
    [sections, semId, yearId]
  );
  const sectionSubjects = useMemo(() => subjects.filter((s) => s.semester_id === semId), [subjects, semId]);
  const sectionBatches = useMemo(() => batches.filter((b) => b.section_id === sectionId), [batches, sectionId]);
  const sectionEntries = useMemo(() => allEntries.filter((e) => e.section_id === sectionId), [allEntries, sectionId]);

  const eligibleTeachers = useMemo(() => {
    if (!form?.subject_id) return [];
    const ids = teacherAssignments
      .filter((a) => a.section_id === sectionId && a.subject_id === form.subject_id)
      .map((a) => a.teacher_id);
    return teachers.filter((t) => ids.includes(t.id));
  }, [teacherAssignments, teachers, sectionId, form?.subject_id]);

  function entriesForSlot(day: number, start: string, end: string) {
    return sectionEntries.filter(
      (e) => e.day_of_week === day && rangesOverlap(e.start_time.slice(0, 5), e.end_time.slice(0, 5), start, end)
    );
  }

  function openAdd(day: number, start = "09:00", end = "09:55") {
    setForm(emptyForm(day, start, end, PERIOD_SLOTS.length + 1));
    setFormError(null);
  }

  function openEdit(e: Entry) {
    setForm({
      id: e.id,
      day_of_week: e.day_of_week,
      start_time: e.start_time.slice(0, 5),
      end_time: e.end_time.slice(0, 5),
      block_type: e.block_type,
      subject_id: e.subject_id ?? "",
      teacher_id: e.teacher_id ?? "",
      lab_batch_id: e.lab_batch_id ?? "",
      room: e.room ?? "",
      label: e.label ?? "",
      notes: e.notes ?? "",
      period_order: e.period_order,
    });
    setFormError(null);
  }

  function applyPreset(index: number) {
    if (!form) return;
    const preset = SUGGESTED_SLOTS[index];
    if (!preset) return;
    setForm({ ...form, start_time: preset.start, end_time: preset.end, block_type: preset.blockType });
  }

  async function handleEnd(entry: Entry) {
    if (!supabase) return;
    if (!window.confirm("End this timetable entry? It will be preserved in history, not deleted.")) return;
    const { error } = await supabase.from("timetable_entries").update({ is_current: false }).eq("id", entry.id);
    if (error) {
      window.alert(friendlyDbError(error, "Timetable entry"));
      return;
    }
    await loadAll();
  }

  async function handleSave() {
    if (!supabase || !form) return;
    setFormError(null);

    if (form.end_time <= form.start_time) {
      setFormError("End time must be after start time.");
      return;
    }
    if (form.block_type === "lab" && !form.lab_batch_id) {
      setFormError("Select a lab batch for a lab block.");
      return;
    }
    if ((form.block_type === "lecture" || form.block_type === "lab") && !form.subject_id) {
      setFormError("Select a subject for this block type.");
      return;
    }

    const others = allEntries.filter((e) => e.id !== form.id && e.day_of_week === form.day_of_week);
    const timeClash = (e: Entry) => rangesOverlap(form.start_time, form.end_time, e.start_time, e.end_time);

    const exact = others.find(
      (e) =>
        e.section_id === sectionId &&
        e.start_time.slice(0, 5) === form.start_time &&
        e.end_time.slice(0, 5) === form.end_time &&
        e.subject_id === (form.subject_id || null) &&
        e.teacher_id === (form.teacher_id || null) &&
        (e.room ?? "").trim().toLowerCase() === form.room.trim().toLowerCase() &&
        e.lab_batch_id === (form.block_type === "lab" ? form.lab_batch_id || null : null) &&
        e.block_type === form.block_type
    );
    if (exact) {
      setFormError("A timetable entry with these exact details already exists.");
      return;
    }
    const newBatch = form.block_type === "lab" ? form.lab_batch_id || null : null;
    const sectionClash = others.find(
      (e) =>
        e.section_id === sectionId &&
        timeClash(e) &&
        (e.lab_batch_id === null || newBatch === null || e.lab_batch_id === newBatch)
    );
    if (sectionClash) {
      setFormError(
        `This section already has a class during this time (${formatTimeRange12(sectionClash.start_time, sectionClash.end_time)}).`
      );
      return;
    }

    if (form.teacher_id) {
      const clash = others.find((e) => e.teacher_id === form.teacher_id && timeClash(e));
      if (clash) {
        setFormError(
          `This teacher is already assigned during this time (${formatTimeRange12(clash.start_time, clash.end_time)}).`
        );
        return;
      }
    }
    if (form.room.trim()) {
      const roomNorm = form.room.trim().toLowerCase();
      const clash = others.find((e) => (e.room ?? "").trim().toLowerCase() === roomNorm && timeClash(e));
      if (clash) {
        setFormError(
          `This room is already occupied during this time (${formatTimeRange12(clash.start_time, clash.end_time)}).`
        );
        return;
      }
    }

    setSaving(true);
    const payload = {
      academic_year_id: yearId,
      semester_id: semId,
      section_id: sectionId,
      day_of_week: form.day_of_week,
      period_order: Math.max(1, Math.floor(timeToMinutes(form.start_time) / 5) + 1),
      start_time: form.start_time,
      end_time: form.end_time,
      subject_id: form.subject_id || null,
      teacher_id: form.teacher_id || null,
      room: form.room.trim() || null,
      lab_batch_id: form.block_type === "lab" ? form.lab_batch_id || null : null,
      block_type: form.block_type,
      label: form.label.trim() || null,
      notes: form.notes.trim() || null,
    };

    if (form.id) {
      const endRes = await supabase.from("timetable_entries").update({ is_current: false }).eq("id", form.id);
      if (endRes.error) {
        setSaving(false);
        setFormError(friendlyDbError(endRes.error, "Timetable entry"));
        return;
      }
    }
    const { error } = await supabase.from("timetable_entries").insert(payload);
    if (error && form.id) {
      await supabase.from("timetable_entries").update({ is_current: true }).eq("id", form.id);
    }
    setSaving(false);
    if (error) {
      setFormError(friendlyDbError(error, "Timetable entry"));
      return;
    }
    setForm(null);
    await loadAll();
  }

  function describeEntry(e: Entry) {
    const subject = subjects.find((s) => s.id === e.subject_id);
    const teacher = teachers.find((t) => t.id === e.teacher_id);
    const batch = batches.find((b) => b.id === e.lab_batch_id);

    if (e.block_type === "break") {
      return <span className="font-semibold text-amber-800 dark:text-amber-300 text-xs">{e.label || "Break"}</span>;
    }
    if (e.block_type === "activity" || e.block_type === "other") {
      return (
        <div className="flex flex-col items-center justify-center text-center w-full">
          <span className="font-bold text-xs text-ink leading-tight">{e.label || e.block_type}</span>
          {e.room && <span className="text-[10px] font-mono font-semibold text-copper-dark mt-1">{e.room}</span>}
        </div>
      );
    }

    const subjectDisplay = subject ? (subject.code || subject.name) : (e.label || "—");

    return (
      <div className="flex flex-col items-center justify-center text-center w-full leading-tight">
        <div className="font-bold text-xs text-ink tracking-tight break-words">
          {subjectDisplay}
          {batch ? <span className="text-[10px] text-copper-dark font-normal"> · {batch.name}</span> : null}
        </div>
        {teacher && (
          <div className="text-[11px] font-medium text-inkmuted mt-1 truncate max-w-full" title={teacher.full_name || teacher.email}>
            {teacher.full_name || teacher.email}
          </div>
        )}
        {e.room && (
          <div className="text-[10px] font-mono font-semibold text-copper-dark mt-1 uppercase tracking-wider">
            {e.room}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Timetable"
        subtitle="Official college schedule grid, dynamically generated from teacher assignments and section entries."
      />

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}
      {loading && !loadError && <LoadingState label="Loading…" />}

      {!loading && !loadError && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <select
              value={yearId}
              onChange={(e) => {
                setYearId(e.target.value);
                setRegId("");
                setProgId("");
                setSemId("");
                setSectionId("");
              }}
              className={selectCls}
            >
              <option value="">Academic Year</option>
              {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
            <select
              value={regId}
              onChange={(e) => {
                setRegId(e.target.value);
                setProgId("");
                setSemId("");
                setSectionId("");
              }}
              className={selectCls}
              disabled={!yearId}
            >
              <option value="">Regulation</option>
              {filteredRegs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <select
              value={progId}
              onChange={(e) => {
                setProgId(e.target.value);
                setSemId("");
                setSectionId("");
              }}
              className={selectCls}
              disabled={!regId}
            >
              <option value="">Program</option>
              {filteredPrograms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select
              value={semId}
              onChange={(e) => {
                setSemId(e.target.value);
                setSectionId("");
              }}
              className={selectCls}
              disabled={!progId}
            >
              <option value="">Semester</option>
              {filteredSemesters.map((s) => <option key={s.id} value={s.id}>Semester {s.number}</option>)}
            </select>
            <select
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              className={selectCls}
              disabled={!semId}
            >
              <option value="">Section</option>
              {filteredSections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
            </select>
          </div>

          {!sectionId ? (
            <EmptyState title="Select a section" message="Select an academic year, semester and section to view the timetable." />
          ) : sectionEntries.length === 0 ? (
            <EmptyState
              title="No timetable has been created for this section yet"
              message="Add the first entry to get started."
              action={{ label: "+ Add entry", onClick: () => openAdd(1) }}
            />
          ) : (
            <>
              <div className="mb-3 flex justify-end">
                <button
                  onClick={() => openAdd(1)}
                  className="rounded-md bg-copper px-3 py-1.5 text-sm font-medium text-white hover:bg-copper-dark"
                >
                  + Add entry
                </button>
              </div>

              {/* Desktop / Tablet Official Academic Timetable Grid */}
              <div className="hidden sm:block overflow-x-auto rounded-xl border border-line bg-panel shadow-xs">
                <table className="w-full min-w-[1020px] border-collapse text-xs">
                  <thead>
                    <tr className="bg-paper/70">
                      <th className="w-28 min-w-[100px] border-b border-r border-line p-2.5 text-center font-bold uppercase tracking-wider text-ink">
                        DAY
                      </th>
                      {OFFICIAL_TIMETABLE_COLUMNS.map((col, idx) => {
                        if (col.type === "break") {
                          return (
                            <th
                              key={col.label}
                              className="w-16 min-w-[56px] max-w-[64px] border-b border-r border-line bg-amber-500/10 p-2 text-center select-none"
                            >
                              <div className="font-bold text-[11px] text-amber-900 dark:text-amber-200 uppercase tracking-widest">
                                {col.label}
                              </div>
                              <div className="text-[9px] font-medium text-amber-800/80 dark:text-amber-300/80 whitespace-nowrap mt-0.5">
                                {formatTimeRange12(col.start, col.end)}
                              </div>
                            </th>
                          );
                        }
                        return (
                          <th
                            key={idx}
                            className="min-w-[125px] border-b border-r border-line p-2 text-center"
                          >
                            <div className="font-semibold text-ink whitespace-nowrap">
                              {formatTimeRange12(col.start, col.end)}
                            </div>
                            <div className="text-[10px] font-medium text-inkmuted uppercase tracking-wider mt-0.5">
                              {col.label}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map((d, dayIdx) => (
                      <tr key={d} className="hover:bg-paper/20 transition-colors">
                        {/* Day Column */}
                        <td className="border-b border-r border-line bg-paper/40 px-3 py-3 text-center font-bold text-xs text-ink uppercase tracking-wider whitespace-nowrap align-middle">
                          {DAY_NAMES[d]}
                        </td>

                        {/* Slots */}
                        {OFFICIAL_TIMETABLE_COLUMNS.map((col, colIdx) => {
                          if (col.type === "break") {
                            // Break column spans all day rows seamlessly without distorting row heights
                            if (dayIdx === 0) {
                              return (
                                <td
                                  key={col.label}
                                  rowSpan={DAYS.length}
                                  className="w-16 min-w-[56px] max-w-[64px] border-b border-r border-line bg-amber-500/5 dark:bg-amber-950/20 text-center align-middle select-none p-0"
                                >
                                  <div className="flex h-full flex-col items-center justify-center py-6">
                                    <span className="font-bold text-xs uppercase tracking-widest text-amber-900 dark:text-amber-200 [writing-mode:vertical-rl] rotate-180">
                                      {col.label}
                                    </span>
                                  </div>
                                </td>
                              );
                            }
                            return null;
                          }

                          // Regular Period Slot with robust content-driven sizing and generous vertical breathing room
                          const cellEntries = entriesForSlot(d, col.start, col.end);
                          return (
                            <td
                              key={colIdx}
                              className="min-w-[125px] max-w-[160px] border-b border-r border-line px-2 py-2.5 align-middle"
                            >
                              {cellEntries.length === 0 ? (
                                <button
                                  onClick={() => openAdd(d, col.start, col.end)}
                                  className="flex min-h-[76px] w-full items-center justify-center rounded-md border border-dashed border-transparent hover:border-line hover:bg-paper/60 text-transparent hover:text-inkmuted text-sm font-semibold transition-all"
                                  title={`Add class for ${DAY_NAMES[d]} (${formatTimeRange12(col.start, col.end)})`}
                                >
                                  +
                                </button>
                              ) : (
                                <div className="space-y-1.5">
                                  {cellEntries.map((e) => (
                                    <button
                                      key={e.id}
                                      onClick={() => openEdit(e)}
                                      className="w-full min-h-[76px] rounded-md border border-line bg-panel p-2 text-center hover:border-copper hover:shadow-xs transition-all flex flex-col justify-center items-center shadow-2xs"
                                    >
                                      {describeEntry(e)}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Purpose-Built Day Timetable */}
              <MobileDayView
                days={DAYS}
                entriesForSlot={entriesForSlot}
                subjects={subjects}
                teachers={teachers}
                batches={batches}
                onAdd={openAdd}
                onEdit={openEdit}
              />
            </>
          )}
        </>
      )}

      {/* Add / Edit Entry Modal */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setForm(null)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-panel p-5 shadow-xl"
          >
            <h2 className="font-display text-lg font-semibold text-ink">
              {form.id ? "Edit entry" : "Add entry"}
            </h2>

            <label className="mt-3 block text-xs font-medium text-inkmuted">Quick preset (optional)</label>
            <select
              onChange={(e) => applyPreset(Number(e.target.value))}
              defaultValue=""
              className={selectCls}
            >
              <option value="" disabled>Choose a preset…</option>
              {SUGGESTED_SLOTS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label} ({formatTimeRange12(p.start, p.end)})
                </option>
              ))}
            </select>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-inkmuted">Day</label>
                <select
                  value={form.day_of_week}
                  onChange={(e) => setForm({ ...form, day_of_week: Number(e.target.value) })}
                  className={selectCls}
                >
                  {DAYS.map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-inkmuted">Block type</label>
                <select
                  value={form.block_type}
                  onChange={(e) => setForm({ ...form, block_type: e.target.value })}
                  className={selectCls}
                >
                  {BLOCK_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-inkmuted">Start time</label>
                <input
                  type="time"
                  value={form.start_time}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                  className={selectCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-inkmuted">End time</label>
                <input
                  type="time"
                  value={form.end_time}
                  onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                  className={selectCls}
                />
              </div>
            </div>

            {(form.block_type === "lecture" || form.block_type === "lab") && (
              <>
                <label className="mt-3 block text-xs font-medium text-inkmuted">Subject</label>
                <select
                  value={form.subject_id}
                  onChange={(e) => setForm({ ...form, subject_id: e.target.value, teacher_id: "" })}
                  className={selectCls}
                >
                  <option value="">Select subject…</option>
                  {sectionSubjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.code ? ` (${s.code})` : ""}
                    </option>
                  ))}
                </select>

                <label className="mt-3 block text-xs font-medium text-inkmuted">Teacher</label>
                <select
                  value={form.teacher_id}
                  onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}
                  className={selectCls}
                  disabled={!form.subject_id}
                >
                  <option value="">{form.subject_id ? "Select teacher…" : "Select a subject first"}</option>
                  {eligibleTeachers.map((t) => (
                    <option key={t.id} value={t.id}>{t.full_name || t.email}</option>
                  ))}
                </select>
                {form.subject_id && eligibleTeachers.length === 0 && (
                  <p className="mt-1 text-xs text-inkmuted">
                    No teacher is assigned to this subject in this section yet — add one on Teacher Assignments first.
                  </p>
                )}
              </>
            )}

            {form.block_type === "lab" && (
              <>
                <label className="mt-3 block text-xs font-medium text-inkmuted">Lab batch</label>
                <select
                  value={form.lab_batch_id}
                  onChange={(e) => setForm({ ...form, lab_batch_id: e.target.value })}
                  className={selectCls}
                >
                  <option value="">Select batch…</option>
                  {sectionBatches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {sectionBatches.length === 0 && (
                  <p className="mt-1 text-xs text-inkmuted">
                    No lab batches exist for this section yet — create one on Lab Batches first.
                  </p>
                )}
              </>
            )}

            {(form.block_type === "activity" || form.block_type === "other" || form.block_type === "break") && (
              <>
                <label className="mt-3 block text-xs font-medium text-inkmuted">Label</label>
                <input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="e.g. Technical Activity / NPTEL"
                  className={selectCls}
                />
              </>
            )}

            <label className="mt-3 block text-xs font-medium text-inkmuted">Room</label>
            <input
              value={form.room}
              onChange={(e) => setForm({ ...form, room: e.target.value })}
              placeholder="e.g. TB-EC-203"
              className={selectCls}
            />

            <label className="mt-3 block text-xs font-medium text-inkmuted">Notes (optional)</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={selectCls}
              rows={2}
            />

            {formError && (
              <p className="mt-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
                {formError}
              </p>
            )}

            <div className="mt-5 flex justify-between gap-2">
              <div>
                {form.id && (
                  <button
                    onClick={() => {
                      const e = sectionEntries.find((x) => x.id === form.id);
                      if (e) {
                        setForm(null);
                        handleEnd(e);
                      }
                    }}
                    className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-danger hover:border-danger"
                  >
                    End entry
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setForm(null)}
                  className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-md bg-copper px-3 py-1.5 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact, purpose-built mobile timetable view (single-level cards, compact break strips, lightweight free periods)
 */
function MobileDayView({
  days,
  entriesForSlot,
  subjects,
  teachers,
  batches,
  onAdd,
  onEdit,
}: {
  days: number[];
  entriesForSlot: (day: number, start: string, end: string) => Entry[];
  subjects: Subj[];
  teachers: Teacher[];
  batches: Batch[];
  onAdd: (day: number, start?: string, end?: string) => void;
  onEdit: (e: Entry) => void;
}) {
  const [activeDay, setActiveDay] = useState(days[0]);

  return (
    <div className="sm:hidden">
      {/* Compact horizontal day selector (single scrollable row, never wraps) */}
      <div className="mb-3.5 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {days.map((d) => (
          <button
            key={d}
            onClick={() => setActiveDay(d)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
              activeDay === d
                ? "bg-copper text-white shadow-xs"
                : "border border-line text-ink bg-panel hover:border-copper"
            }`}
          >
            {DAY_NAMES[d]}
          </button>
        ))}
      </div>

      {/* Purpose-built vertical period list */}
      <div className="space-y-2">
        {OFFICIAL_TIMETABLE_COLUMNS.map((col, idx) => {
          // Compact break strip
          if (col.type === "break") {
            return (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-amber-400/30 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-900 dark:text-amber-200 shadow-2xs"
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <span className="uppercase tracking-wider">{col.label}</span>
                </div>
                <span className="font-mono text-[11px] font-normal text-amber-800/80 dark:text-amber-300">
                  {formatTimeRange12(col.start, col.end)}
                </span>
              </div>
            );
          }

          const cellEntries = entriesForSlot(activeDay, col.start, col.end);

          // Lightweight Free Period Card
          if (cellEntries.length === 0) {
            return (
              <div
                key={idx}
                className="rounded-lg border border-dashed border-line/60 bg-paper/30 px-3.5 py-2 text-xs"
              >
                <div className="flex items-center justify-between text-inkmuted font-medium">
                  <span className="font-bold text-xs text-ink/80">P{col.periodNumber}</span>
                  <span className="font-mono text-[11px]">{formatTimeRange12(col.start, col.end)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-inkmuted/70 italic">Free period</span>
                  <button
                    onClick={() => onAdd(activeDay, col.start, col.end)}
                    className="text-xs font-semibold text-copper-dark hover:underline"
                  >
                    + Add
                  </button>
                </div>
              </div>
            );
          }

          // Single-level compact period card (no nested redundant containers)
          return (
            <div key={idx} className="space-y-1.5">
              {cellEntries.map((e) => {
                const subject = subjects.find((s) => s.id === e.subject_id);
                const teacher = teachers.find((t) => t.id === e.teacher_id);
                const batch = batches.find((b) => b.id === e.lab_batch_id);
                const subjectDisplay = subject ? (subject.code || subject.name) : (e.label || "—");

                return (
                  <div
                    key={e.id}
                    onClick={() => onEdit(e)}
                    className="rounded-lg border border-line bg-panel p-3 shadow-2xs hover:border-copper transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between text-xs font-medium text-inkmuted">
                      <span className="font-bold text-xs text-ink">P{col.periodNumber}</span>
                      <span className="font-mono text-[11px]">{formatTimeRange12(col.start, col.end)}</span>
                    </div>
                    <div className="border-t border-line/50 my-2" />
                    <div className="text-center">
                      <div className="font-bold text-sm text-ink tracking-tight">
                        {subjectDisplay}
                        {batch ? <span className="text-xs text-copper-dark font-normal"> · {batch.name}</span> : ""}
                      </div>
                      {teacher && (
                        <div className="text-xs font-medium text-inkmuted mt-0.5">
                          {teacher.full_name || teacher.email}
                        </div>
                      )}
                      {e.room && (
                        <div className="text-xs font-mono font-semibold text-copper-dark mt-1 tracking-wide">
                          {e.room}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
