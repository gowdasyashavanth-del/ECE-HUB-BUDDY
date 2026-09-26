import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../ui/PageHeader";
import { LoadingState } from "../ui/LoadingState";
import { ErrorState } from "../ui/ErrorState";
import { EmptyState } from "../ui/EmptyState";

interface Subject { id: string; name: string; }
interface Unit { id: string; name: string; subject_id: string; }
interface Topic { id: string; name: string; unit_id: string; }
interface QuestionRow {
  id: string; topic_id: string; question_text: string;
  options: Record<string, string>; correct_answer: string; explanation: string | null; difficulty: string;
}

const OPTION_KEYS = ["A", "B", "C", "D"] as const;

// MCQ convention used throughout this app (the `options` jsonb column
// itself is unconstrained by the schema, so this is a documented
// application-level convention, not a DB requirement): options is a
// {"A": "...", "B": "...", ...} label -> text map, and correct_answer
// is one of those labels. Chosen because the schema (options jsonb +
// correct_answer text) implies simple MCQ, matching "if only MCQ is
// supported, implement it properly" rather than inventing question
// types the schema has no room for.
export function QuestionManager() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "super_admin";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [filterSubjectId, setFilterSubjectId] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fSubjectId, setFSubjectId] = useState("");
  const [fUnitId, setFUnitId] = useState("");
  const [fTopicId, setFTopicId] = useState("");
  const [fText, setFText] = useState("");
  const [fOptions, setFOptions] = useState<Record<string, string>>({ A: "", B: "", C: "", D: "" });
  const [fCorrect, setFCorrect] = useState("A");
  const [fExplanation, setFExplanation] = useState("");
  const [fDifficulty, setFDifficulty] = useState("Medium");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowActionError, setRowActionError] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase || !profile) return;
    setLoadError(null);
    setLoading(true);

    let subjectRows: Subject[] = [];
    if (isAdmin) {
      const { data, error } = await supabase.from("subjects").select("id, name").order("name");
      if (error) { setLoading(false); setLoadError(friendlyDbError(error, "Subjects")); return; }
      subjectRows = data ?? [];
    } else {
      const { data, error } = await supabase.from("teacher_assignments").select("subjects(id, name)").eq("teacher_id", profile.id);
      if (error) { setLoading(false); setLoadError(friendlyDbError(error, "Your subjects")); return; }
      const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
      const seen = new Set<string>();
      subjectRows = (data ?? [])
        .map((r: any) => first<Subject>(r.subjects))
        .filter((s): s is Subject => !!s && !seen.has(s.id) && (seen.add(s.id), true));
    }
    setSubjects(subjectRows);

    if (subjectRows.length === 0) { setUnits([]); setTopics([]); setRows([]); setLoading(false); return; }

    const { data: unitRows, error: unitErr } = await supabase.from("units").select("id, name, subject_id").in("subject_id", subjectRows.map((s) => s.id));
    if (unitErr) { setLoading(false); setLoadError(friendlyDbError(unitErr, "Units")); return; }
    setUnits(unitRows ?? []);

    const unitIds = (unitRows ?? []).map((u) => u.id);
    let topicRows: Topic[] = [];
    if (unitIds.length > 0) {
      const { data, error } = await supabase.from("topics").select("id, name, unit_id").in("unit_id", unitIds);
      if (error) { setLoading(false); setLoadError(friendlyDbError(error, "Topics")); return; }
      topicRows = data ?? [];
    }
    setTopics(topicRows);

    const topicIds = topicRows.map((t) => t.id);
    let qRows: QuestionRow[] = [];
    if (topicIds.length > 0) {
      const { data, error } = await supabase
        .from("questions")
        .select("id, topic_id, question_text, options, correct_answer, explanation, difficulty")
        .in("topic_id", topicIds);
      if (error) { setLoading(false); setLoadError(friendlyDbError(error, "Questions")); return; }
      qRows = (data ?? []) as QuestionRow[];
    }
    setRows(qRows);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const unitsForSubject = (subjectId: string) => units.filter((u) => u.subject_id === subjectId);
  const topicsForUnit = (unitId: string) => topics.filter((t) => t.unit_id === unitId);

  const visibleRows = useMemo(() => {
    if (!filterSubjectId) return rows;
    const unitIds = new Set(units.filter((u) => u.subject_id === filterSubjectId).map((u) => u.id));
    const topicIds = new Set(topics.filter((t) => unitIds.has(t.unit_id)).map((t) => t.id));
    return rows.filter((r) => topicIds.has(r.topic_id));
  }, [rows, filterSubjectId, units, topics]);

  function topicLabel(topicId: string): string {
    const topic = topics.find((t) => t.id === topicId);
    const unit = topic ? units.find((u) => u.id === topic.unit_id) : undefined;
    const subject = unit ? subjects.find((s) => s.id === unit.subject_id) : undefined;
    return `${subject?.name ?? "—"} · ${topic?.name ?? "—"}`;
  }

  function openCreate() {
    setEditingId(null);
    setFSubjectId(""); setFUnitId(""); setFTopicId("");
    setFText(""); setFOptions({ A: "", B: "", C: "", D: "" }); setFCorrect("A");
    setFExplanation(""); setFDifficulty("Medium");
    setFormError(null);
    setFormOpen(true);
  }
  function openEdit(row: QuestionRow) {
    const topic = topics.find((t) => t.id === row.topic_id);
    const unit = topic ? units.find((u) => u.id === topic.unit_id) : undefined;
    setEditingId(row.id);
    setFSubjectId(unit?.subject_id ?? ""); setFUnitId(unit?.id ?? ""); setFTopicId(row.topic_id);
    setFText(row.question_text);
    setFOptions({ A: "", B: "", C: "", D: "", ...row.options });
    setFCorrect(row.correct_answer);
    setFExplanation(row.explanation ?? "");
    setFDifficulty(row.difficulty);
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit() {
    if (!supabase) return;
    setFormError(null);
    if (!fTopicId) return setFormError("Select Subject → Unit → Topic.");
    if (!fText.trim()) return setFormError("Question text is required.");
    const filledOptions = Object.fromEntries(Object.entries(fOptions).filter(([, v]) => v.trim()));
    if (Object.keys(filledOptions).length < 2) return setFormError("Provide at least 2 options.");
    if (!filledOptions[fCorrect]) return setFormError("The correct answer must match a filled-in option.");

    const payload = {
      topic_id: fTopicId,
      question_text: fText.trim(),
      options: filledOptions,
      correct_answer: fCorrect,
      explanation: fExplanation.trim() || null,
      difficulty: fDifficulty,
    };

    setSaving(true);
    const query = editingId
      ? supabase.from("questions").update(payload).eq("id", editingId)
      : supabase.from("questions").insert(payload);
    const { error } = await query;
    setSaving(false);
    if (error) { setFormError(friendlyDbError(error, "Question")); return; }
    setFormOpen(false);
    await loadAll();
  }

  async function handleDelete(row: QuestionRow) {
    if (!supabase) return;
    if (!window.confirm("Delete this question? If it's used in a test, the test will need to be updated too.")) return;
    setRowActionError(null);
    const { error } = await supabase.from("questions").delete().eq("id", row.id);
    if (error) { setRowActionError(friendlyDbError(error, "Question")); return; }
    await loadAll();
  }

  const inputClass = "mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none";
  const ghostBtn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper hover:text-copper-dark";
  const dangerBtn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger";

  if (!profile) return null;

  return (
    <div>
      <PageHeader
        title="Questions"
        subtitle={isAdmin ? "Manage MCQ questions across all subjects." : "Manage questions for the subjects you're assigned to."}
        action={<button onClick={openCreate} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark">+ Add Question</button>}
      />

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}
      {loading && !loadError && <LoadingState label="Loading questions…" />}
      {!loading && !loadError && subjects.length === 0 && (
        <EmptyState title={isAdmin ? "No subjects exist yet" : "No subjects assigned to you yet"} message={isAdmin ? "Create subjects under Academic Management first." : "Your Super Admin hasn't assigned you to any subject yet."} />
      )}

      {!loading && !loadError && subjects.length > 0 && (
        <>
          <div className="mb-4">
            <label className="block text-xs font-medium text-inkmuted">Filter by subject</label>
            <select value={filterSubjectId} onChange={(e) => setFilterSubjectId(e.target.value)} className={`${inputClass} max-w-xs`}>
              <option value="">All subjects</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {formOpen && (
            <div className="mb-6 rounded-lg border border-line bg-panel p-5">
              <p className="mb-3 font-display text-sm font-semibold text-ink">{editingId ? "Edit Question" : "New Question"}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Subject</label>
                  <select value={fSubjectId} onChange={(e) => { setFSubjectId(e.target.value); setFUnitId(""); setFTopicId(""); }} className={inputClass}>
                    <option value="">Select…</option>
                    {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Unit</label>
                  <select value={fUnitId} disabled={!fSubjectId} onChange={(e) => { setFUnitId(e.target.value); setFTopicId(""); }} className={inputClass}>
                    <option value="">{fSubjectId ? "Select…" : "Select subject first"}</option>
                    {unitsForSubject(fSubjectId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Topic</label>
                  <select value={fTopicId} disabled={!fUnitId} onChange={(e) => setFTopicId(e.target.value)} className={inputClass}>
                    <option value="">{fUnitId ? "Select…" : "Select unit first"}</option>
                    {topicsForUnit(fUnitId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-xs font-medium text-inkmuted">Question text</label>
                <textarea value={fText} onChange={(e) => setFText(e.target.value)} rows={2} className={inputClass} />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {OPTION_KEYS.map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correct"
                      checked={fCorrect === k}
                      onChange={() => setFCorrect(k)}
                      aria-label={`Option ${k} is correct`}
                    />
                    <input
                      value={fOptions[k] ?? ""}
                      onChange={(e) => setFOptions((o) => ({ ...o, [k]: e.target.value }))}
                      placeholder={`Option ${k}`}
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-inkmuted">Select the radio button next to the correct option.</p>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Explanation (optional)</label>
                  <textarea value={fExplanation} onChange={(e) => setFExplanation(e.target.value)} rows={2} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Difficulty</label>
                  <select value={fDifficulty} onChange={(e) => setFDifficulty(e.target.value)} className={inputClass}>
                    <option>Easy</option><option>Medium</option><option>Hard</option>
                  </select>
                </div>
              </div>

              {formError && <p className="mt-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}

              <div className="mt-4 flex gap-2">
                <button onClick={handleSubmit} disabled={saving} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-60">
                  {saving ? "Saving…" : editingId ? "Save changes" : "Create"}
                </button>
                <button onClick={() => setFormOpen(false)} className="rounded-md border border-line px-4 py-2 text-sm text-ink hover:border-copper hover:text-copper-dark">Cancel</button>
              </div>
            </div>
          )}

          {rowActionError && <div className="mb-4"><ErrorState message={rowActionError} onRetry={() => setRowActionError(null)} /></div>}

          {visibleRows.length === 0 && <EmptyState title="No questions yet" message="Add your first question above." />}

          {visibleRows.length > 0 && (
            <div className="space-y-2">
              {visibleRows.map((row) => (
                <div key={row.id} className="rounded-lg border border-line bg-panel p-4">
                  <p className="font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">{topicLabel(row.topic_id)} · {row.difficulty}</p>
                  <p className="mt-1 text-sm text-ink">{row.question_text}</p>
                  <p className="mt-1 text-xs text-trace-dark">Correct: {row.correct_answer} — {row.options[row.correct_answer]}</p>
                  <div className="mt-2 flex gap-1.5">
                    <button onClick={() => openEdit(row)} className={ghostBtn}>Edit</button>
                    {isAdmin && <button onClick={() => handleDelete(row)} className={dangerBtn}>Delete</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
