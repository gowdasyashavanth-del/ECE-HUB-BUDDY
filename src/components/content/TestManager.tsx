import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../ui/PageHeader";
import { LoadingState } from "../ui/LoadingState";
import { ErrorState } from "../ui/ErrorState";
import { EmptyState } from "../ui/EmptyState";
import { Badge } from "../ui/Badge";

interface Subject { id: string; name: string; }
interface QuestionRow { id: string; topic_id: string; question_text: string; }
interface TestRow {
  id: string; subject_id: string | null; title: string; question_ids: string[];
  duration_min: number | null; is_published: boolean;
}

// question_ids is a plain array (the schema's existing design — not a
// join table, matching the approved architecture from Phase 2/3). The
// picker below only ever offers questions from the CHOSEN subject, but
// the real guarantee against cross-subject question IDs is the
// trg_validate_test_questions trigger (migration 15/16) — if this UI
// somehow sent a bad ID anyway, the database rejects it, not this code.
export function TestManager() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "super_admin";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questionsBySubject, setQuestionsBySubject] = useState<Record<string, QuestionRow[]>>({});
  const [tests, setTests] = useState<TestRow[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fSubjectId, setFSubjectId] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [fDuration, setFDuration] = useState("30");
  const [fPublished, setFPublished] = useState(false);
  const [fSelectedQuestionIds, setFSelectedQuestionIds] = useState<Set<string>>(new Set());
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

    if (subjectRows.length === 0) { setTests([]); setLoading(false); return; }
    const subjectIds = subjectRows.map((s) => s.id);

    // Questions grouped by subject, via topic -> unit -> subject.
    const { data: unitRows } = await supabase.from("units").select("id, subject_id").in("subject_id", subjectIds);
    const { data: topicRows } = await supabase.from("topics").select("id, unit_id").in("unit_id", (unitRows ?? []).map((u) => u.id));
    const topicToSubject = new Map<string, string>();
    (topicRows ?? []).forEach((t) => {
      const unit = (unitRows ?? []).find((u) => u.id === t.unit_id);
      if (unit) topicToSubject.set(t.id, unit.subject_id);
    });
    const topicIds = (topicRows ?? []).map((t) => t.id);
    let qBySubject: Record<string, QuestionRow[]> = {};
    if (topicIds.length > 0) {
      const { data: qRows, error: qErr } = await supabase.from("questions").select("id, topic_id, question_text").in("topic_id", topicIds);
      if (qErr) { setLoading(false); setLoadError(friendlyDbError(qErr, "Questions")); return; }
      (qRows ?? []).forEach((q) => {
        const subjId = topicToSubject.get(q.topic_id);
        if (!subjId) return;
        (qBySubject[subjId] ??= []).push(q);
      });
    }
    setQuestionsBySubject(qBySubject);

    const { data: testRows, error: testErr } = await supabase
      .from("tests")
      .select("id, subject_id, title, question_ids, duration_min, is_published")
      .in("subject_id", subjectIds);
    setLoading(false);
    if (testErr) { setLoadError(friendlyDbError(testErr, "Tests")); return; }
    setTests((testRows ?? []) as TestRow[]);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  function subjectName(id: string | null) { return subjects.find((s) => s.id === id)?.name ?? "—"; }

  function openCreate() {
    setEditingId(null);
    setFSubjectId(""); setFTitle(""); setFDuration("30"); setFPublished(false);
    setFSelectedQuestionIds(new Set());
    setFormError(null);
    setFormOpen(true);
  }
  function openEdit(row: TestRow) {
    setEditingId(row.id);
    setFSubjectId(row.subject_id ?? "");
    setFTitle(row.title);
    setFDuration(String(row.duration_min ?? 30));
    setFPublished(row.is_published);
    setFSelectedQuestionIds(new Set(row.question_ids));
    setFormError(null);
    setFormOpen(true);
  }

  function toggleQuestion(id: string) {
    setFSelectedQuestionIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (!supabase) return;
    setFormError(null);
    if (!fSubjectId) return setFormError("Select a subject.");
    if (!fTitle.trim()) return setFormError("Title is required.");
    if (fSelectedQuestionIds.size === 0) return setFormError("Select at least one question.");

    const payload = {
      subject_id: fSubjectId,
      topic_id: null,
      title: fTitle.trim(),
      question_ids: Array.from(fSelectedQuestionIds),
      duration_min: Number(fDuration) || 30,
      is_published: fPublished,
    };

    setSaving(true);
    const query = editingId
      ? supabase.from("tests").update(payload).eq("id", editingId)
      : supabase.from("tests").insert({ ...payload, created_by: profile?.id });
    const { error } = await query;
    setSaving(false);
    if (error) { setFormError(friendlyDbError(error, "Test")); return; }
    setFormOpen(false);
    await loadAll();
  }

  async function handleDelete(row: TestRow) {
    if (!supabase) return;
    if (!window.confirm(`Delete test "${row.title}"? Any results students have already earned for it will also be removed.`)) return;
    setRowActionError(null);
    const { error } = await supabase.from("tests").delete().eq("id", row.id);
    if (error) { setRowActionError(friendlyDbError(error, "Test")); return; }
    await loadAll();
  }

  const availableQuestions = useMemo(() => (fSubjectId ? questionsBySubject[fSubjectId] ?? [] : []), [fSubjectId, questionsBySubject]);
  const inputClass = "mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none";
  const ghostBtn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper hover:text-copper-dark";
  const dangerBtn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger";

  if (!profile) return null;

  return (
    <div>
      <PageHeader
        title="Tests"
        subtitle={isAdmin ? "Create and manage tests across all subjects." : "Create and manage tests for the subjects you're assigned to."}
        action={<button onClick={openCreate} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark">+ Add Test</button>}
      />

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}
      {loading && !loadError && <LoadingState label="Loading tests…" />}
      {!loading && !loadError && subjects.length === 0 && (
        <EmptyState title={isAdmin ? "No subjects exist yet" : "No subjects assigned to you yet"} message={isAdmin ? "Create subjects under Academic Management first." : "Your Super Admin hasn't assigned you to any subject yet."} />
      )}

      {!loading && !loadError && subjects.length > 0 && (
        <>
          {formOpen && (
            <div className="mb-6 rounded-lg border border-line bg-panel p-5">
              <p className="mb-3 font-display text-sm font-semibold text-ink">{editingId ? "Edit Test" : "New Test"}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Subject</label>
                  <select value={fSubjectId} onChange={(e) => { setFSubjectId(e.target.value); setFSelectedQuestionIds(new Set()); }} className={inputClass}>
                    <option value="">Select…</option>
                    {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-inkmuted">Title</label>
                  <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="e.g. Unit 1 Quiz — Circuit Laws" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Duration (minutes)</label>
                  <input type="number" min={1} value={fDuration} onChange={(e) => setFDuration(e.target.value)} className={inputClass} />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input type="checkbox" id="tpub" checked={fPublished} onChange={(e) => setFPublished(e.target.checked)} />
                  <label htmlFor="tpub" className="text-sm text-ink">Published (visible to enrolled students)</label>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-xs font-medium text-inkmuted">
                  Questions {fSubjectId && `(${availableQuestions.length} available for this subject)`}
                </p>
                {!fSubjectId && <p className="mt-1 text-sm text-inkmuted">Select a subject first.</p>}
                {fSubjectId && availableQuestions.length === 0 && (
                  <p className="mt-1 text-sm text-inkmuted">No questions exist for this subject yet — add some on the Questions page first.</p>
                )}
                {availableQuestions.length > 0 && (
                  <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-line p-2">
                    {availableQuestions.map((q) => (
                      <label key={q.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-paper">
                        <input type="checkbox" checked={fSelectedQuestionIds.has(q.id)} onChange={() => toggleQuestion(q.id)} className="mt-0.5" />
                        <span>{q.question_text}</span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-inkmuted">{fSelectedQuestionIds.size} selected.</p>
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

          {tests.length === 0 && <EmptyState title="No tests yet" message="Create your first test above." />}

          {tests.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-line bg-panel">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper">
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Title</th>
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Subject</th>
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Questions</th>
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Duration</th>
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Status</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t) => (
                    <tr key={t.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-medium text-ink">{t.title}</td>
                      <td className="px-4 py-2.5 text-xs text-inkmuted">{subjectName(t.subject_id)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-inkmuted">{t.question_ids?.length ?? 0}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-inkmuted">{t.duration_min} min</td>
                      <td className="px-4 py-2.5"><Badge tone={t.is_published ? "active" : "archived"}>{t.is_published ? "Published" : "Draft"}</Badge></td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1.5">
                          <button onClick={() => openEdit(t)} className={ghostBtn}>Edit</button>
                          {isAdmin && <button onClick={() => handleDelete(t)} className={dangerBtn}>Delete</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
