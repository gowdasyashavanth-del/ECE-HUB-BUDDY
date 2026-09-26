import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../ui/PageHeader";
import { LoadingState } from "../ui/LoadingState";
import { ErrorState } from "../ui/ErrorState";
import { EmptyState } from "../ui/EmptyState";

interface Subject { id: string; name: string; }
interface FormulaRow {
  id: string; subject_id: string; name: string; expression: string;
  description: string | null; example: string | null;
}

// Same role-aware-but-not-security-relying pattern as ContentManager:
// the subject picker is scoped to what this user can usefully act on,
// but formulas_insert/update/delete RLS (teacher_has_subject()/is_admin())
// is what actually enforces it regardless of what this UI shows.
//
// Scope note: `formulas.variables` (jsonb) isn't edited here — a
// structured per-variable editor is more than "core workflow" needs
// this phase; description/example (both plain text) cover the same
// need for now. variables defaults to '[]' via the schema.
export function FormulaManager() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "super_admin";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [rows, setRows] = useState<FormulaRow[]>([]);
  const [filterSubjectId, setFilterSubjectId] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fSubjectId, setFSubjectId] = useState("");
  const [fName, setFName] = useState("");
  const [fExpr, setFExpr] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fExample, setFExample] = useState("");
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

    if (subjectRows.length === 0) {
      setRows([]); setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("formulas")
      .select("id, subject_id, name, expression, description, example")
      .in("subject_id", subjectRows.map((s) => s.id))
      .order("name");
    setLoading(false);
    if (error) { setLoadError(friendlyDbError(error, "Formulas")); return; }
    setRows((data ?? []) as FormulaRow[]);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const visibleRows = useMemo(
    () => (filterSubjectId ? rows.filter((r) => r.subject_id === filterSubjectId) : rows),
    [rows, filterSubjectId]
  );

  function subjectName(id: string) { return subjects.find((s) => s.id === id)?.name ?? "—"; }

  function openCreate() {
    setEditingId(null);
    setFSubjectId(""); setFName(""); setFExpr(""); setFDesc(""); setFExample("");
    setFormError(null);
    setFormOpen(true);
  }
  function openEdit(row: FormulaRow) {
    setEditingId(row.id);
    setFSubjectId(row.subject_id); setFName(row.name); setFExpr(row.expression);
    setFDesc(row.description ?? ""); setFExample(row.example ?? "");
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit() {
    if (!supabase) return;
    setFormError(null);
    if (!fSubjectId) return setFormError("Select a subject.");
    if (!fName.trim()) return setFormError("Name is required.");
    if (!fExpr.trim()) return setFormError("Expression is required.");

    const payload: Record<string, unknown> = {
      subject_id: fSubjectId,
      name: fName.trim(),
      expression: fExpr.trim(),
      description: fDesc.trim() || null,
      example: fExample.trim() || null,
    };
    if (!editingId) payload.created_by = profile?.id;

    setSaving(true);
    const query = editingId
      ? supabase.from("formulas").update(payload).eq("id", editingId)
      : supabase.from("formulas").insert(payload);
    const { error } = await query;
    setSaving(false);
    if (error) { setFormError(friendlyDbError(error, "Formula")); return; }
    setFormOpen(false);
    await loadAll();
  }

  async function handleDelete(row: FormulaRow) {
    if (!supabase) return;
    if (!window.confirm(`Delete formula "${row.name}"?`)) return;
    setRowActionError(null);
    const { error } = await supabase.from("formulas").delete().eq("id", row.id);
    if (error) { setRowActionError(friendlyDbError(error, "Formula")); return; }
    await loadAll();
  }

  const inputClass = "mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none";
  const ghostBtn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper hover:text-copper-dark";
  const dangerBtn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger";

  if (!profile) return null;

  return (
    <div>
      <PageHeader
        title="Formulas"
        subtitle={isAdmin ? "Manage formulas across all subjects." : "Manage formulas for the subjects you're assigned to."}
        action={
          <button onClick={openCreate} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark">
            + Add Formula
          </button>
        }
      />

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}
      {loading && !loadError && <LoadingState label="Loading formulas…" />}

      {!loading && !loadError && subjects.length === 0 && (
        <EmptyState
          title={isAdmin ? "No subjects exist yet" : "No subjects assigned to you yet"}
          message={isAdmin ? "Create subjects under Academic Management first." : "Your Super Admin hasn't assigned you to any subject yet."}
        />
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
              <p className="mb-3 font-display text-sm font-semibold text-ink">{editingId ? "Edit Formula" : "New Formula"}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Subject</label>
                  <select value={fSubjectId} onChange={(e) => setFSubjectId(e.target.value)} className={inputClass}>
                    <option value="">Select…</option>
                    {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Name</label>
                  <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Ohm's Law" className={inputClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-inkmuted">Expression</label>
                  <input value={fExpr} onChange={(e) => setFExpr(e.target.value)} placeholder="e.g. V = I × R" className={`${inputClass} font-mono`} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-inkmuted">Description (variables, units, etc.)</label>
                  <textarea value={fDesc} onChange={(e) => setFDesc(e.target.value)} rows={2} className={inputClass} placeholder="V = Voltage (V), I = Current (A), R = Resistance (Ω)" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-inkmuted">Example (optional)</label>
                  <textarea value={fExample} onChange={(e) => setFExample(e.target.value)} rows={2} className={inputClass} />
                </div>
              </div>

              {formError && <p className="mt-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}

              <div className="mt-4 flex gap-2">
                <button onClick={handleSubmit} disabled={saving} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-60">
                  {saving ? "Saving…" : editingId ? "Save changes" : "Create"}
                </button>
                <button onClick={() => setFormOpen(false)} className="rounded-md border border-line px-4 py-2 text-sm text-ink hover:border-copper hover:text-copper-dark">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {rowActionError && <div className="mb-4"><ErrorState message={rowActionError} onRetry={() => setRowActionError(null)} /></div>}

          {visibleRows.length === 0 && (
            <EmptyState title="No formulas yet" message="Add your first formula above." />
          )}

          {visibleRows.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visibleRows.map((row) => (
                <div key={row.id} className="rounded-lg border border-line bg-panel p-4">
                  <p className="font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">{subjectName(row.subject_id)}</p>
                  <p className="mt-1 font-body text-sm font-medium text-ink">{row.name}</p>
                  <p className="mt-1 font-mono text-base text-copper-dark">{row.expression}</p>
                  {row.description && <p className="mt-1 text-xs text-inkmuted">{row.description}</p>}
                  <div className="mt-3 flex gap-1.5">
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
