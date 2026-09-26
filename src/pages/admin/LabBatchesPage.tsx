import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface Student {
  id: string;
  full_name: string;
  email: string;
}
interface SectionRow {
  id: string;
  name: string;
  breadcrumb: string;
}
interface Batch {
  id: string;
  section_id: string;
  name: string;
}
interface BatchAssignment {
  id: string;
  student_id: string;
  lab_batch_id: string;
  section_id: string;
}

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// lab_batches (structural entity, admin-write-only) + student_lab_
// batch_assignments (via the assign_lab_batch RPC, which is what
// actually preserves history — ends the student's old current row and
// inserts a new one — exactly as built in Phase 16A). No new table, no
// hardcoded batch names anywhere in this file.
export function LabBatchesPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [studentsBySection, setStudentsBySection] = useState<Record<string, Student[]>>({});
  const [batches, setBatches] = useState<Batch[]>([]);
  const [assignments, setAssignments] = useState<BatchAssignment[]>([]);

  const [newBatchName, setNewBatchName] = useState<Record<string, string>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pickedBatchByStudent, setPickedBatchByStudent] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [sectionError, setSectionError] = useState<Record<string, string>>({});

  async function loadAll() {
    if (!supabase) return;
    setLoadError(null);
    setLoading(true);
    const [sec, sa, lb, sla] = await Promise.all([
      supabase
        .from("sections")
        .select("id, name, semesters(number, programs(name, regulations(name, academic_years(name))))")
        .order("name"),
      supabase.from("student_assignments").select("section_id, users(id, full_name, email)").eq("is_current", true),
      supabase.from("lab_batches").select("id, section_id, name").order("name"),
      supabase.from("student_lab_batch_assignments").select("id, student_id, lab_batch_id, section_id").eq("is_current", true),
    ]);
    setLoading(false);
    const firstErr = [sec, sa, lb, sla].find((r) => r.error);
    if (firstErr?.error) {
      setLoadError("We couldn't load lab batch data. Please try again.");
      return;
    }
    setSections(
      (sec.data ?? []).map((row: any) => {
        const sem = first<{ number: number; programs: any }>(row.semesters);
        const prog = sem ? first<{ name: string; regulations: any }>(sem.programs) : null;
        const reg = prog ? first<{ name: string; academic_years: any }>(prog.regulations) : null;
        const year = reg ? first<{ name: string }>(reg.academic_years) : null;
        return {
          id: row.id,
          name: row.name,
          breadcrumb: `${prog?.name ?? "—"} · Sem ${sem?.number ?? "—"} · ${year?.name ?? "—"}`,
        };
      })
    );
    const bySection: Record<string, Student[]> = {};
    (sa.data ?? []).forEach((row: any) => {
      const u = first<Student>(row.users);
      if (!u) return;
      (bySection[row.section_id] ??= []).push(u);
    });
    setStudentsBySection(bySection);
    setBatches((lb.data ?? []) as Batch[]);
    setAssignments((sla.data ?? []) as BatchAssignment[]);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const batchesBySection = useMemo(() => {
    const map = new Map<string, Batch[]>();
    batches.forEach((b) => {
      const list = map.get(b.section_id) ?? [];
      list.push(b);
      map.set(b.section_id, list);
    });
    return map;
  }, [batches]);

  const assignmentByStudent = useMemo(() => {
    const map = new Map<string, BatchAssignment>();
    assignments.forEach((a) => map.set(a.student_id, a));
    return map;
  }, [assignments]);

  async function handleCreateBatch(sectionId: string) {
    if (!supabase) return;
    const name = (newBatchName[sectionId] ?? "").trim();
    if (!name) return;
    setSectionError((p) => ({ ...p, [sectionId]: "" }));
    const { error } = await supabase.from("lab_batches").insert({ section_id: sectionId, name });
    if (error) {
      setSectionError((p) => ({ ...p, [sectionId]: friendlyDbError(error, "Lab batch") }));
      return;
    }
    setNewBatchName((p) => ({ ...p, [sectionId]: "" }));
    await loadAll();
  }

  async function handleRename(batch: Batch) {
    if (!supabase) return;
    const name = renameValue.trim();
    if (!name) return;
    const { error } = await supabase.from("lab_batches").update({ name }).eq("id", batch.id);
    if (error) {
      setSectionError((p) => ({ ...p, [batch.section_id]: friendlyDbError(error, "Lab batch") }));
      return;
    }
    setRenamingId(null);
    await loadAll();
  }

  async function handleAssign(studentId: string, sectionId: string) {
    if (!supabase) return;
    const batchId = pickedBatchByStudent[studentId];
    if (!batchId) return;
    setSaving(true);
    setSectionError((p) => ({ ...p, [sectionId]: "" }));
    const { error } = await supabase.rpc("assign_lab_batch", { p_student_id: studentId, p_lab_batch_id: batchId });
    setSaving(false);
    if (error) {
      setSectionError((p) => ({ ...p, [sectionId]: error.message }));
      return;
    }
    await loadAll();
  }

  return (
    <div>
      <PageHeader
        title="Lab Batches"
        subtitle="Create batches per section, then assign each student to at most one current batch. Changing a batch preserves history."
      />

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}
      {loading && !loadError && <LoadingState label="Loading sections…" />}

      {!loading && !loadError && sections.length === 0 && (
        <EmptyState title="No sections yet" message="Set up Academic Structure (Sections) first." />
      )}

      {!loading && !loadError && sections.length > 0 && (
        <div className="space-y-4">
          {sections.map((s) => {
            const sectionBatches = batchesBySection.get(s.id) ?? [];
            const students = studentsBySection[s.id] ?? [];
            return (
              <div key={s.id} className="rounded-lg border border-line bg-panel p-4">
                <p className="font-display text-sm font-semibold text-ink">Section {s.name}</p>
                <p className="mb-3 text-xs text-inkmuted">{s.breadcrumb}</p>

                {sectionError[s.id] && (
                  <p className="mb-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{sectionError[s.id]}</p>
                )}

                <div className="mb-4">
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-inkmuted">Batches</p>
                  {sectionBatches.length === 0 ? (
                    <p className="text-sm text-inkmuted">No lab batches have been created for this section.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {sectionBatches.map((b) => (
                        <div key={b.id} className="flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1">
                          {renamingId === b.id ? (
                            <>
                              <input
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                className="w-20 rounded border border-line bg-panel px-1.5 py-0.5 text-xs"
                                autoFocus
                              />
                              <button onClick={() => handleRename(b)} className="text-xs font-medium text-copper-dark">Save</button>
                              <button onClick={() => setRenamingId(null)} className="text-xs text-inkmuted">✕</button>
                            </>
                          ) : (
                            <>
                              <span className="text-xs font-medium text-ink">{b.name}</span>
                              <button
                                onClick={() => { setRenamingId(b.id); setRenameValue(b.name); }}
                                className="text-xs text-inkmuted hover:text-copper-dark"
                              >
                                Rename
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newBatchName[s.id] ?? ""}
                      onChange={(e) => setNewBatchName((p) => ({ ...p, [s.id]: e.target.value }))}
                      placeholder="New batch name (e.g. A1)"
                      className="w-48 rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-ink"
                    />
                    <button
                      onClick={() => handleCreateBatch(s.id)}
                      className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper"
                    >
                      + Add batch
                    </button>
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-inkmuted">Students</p>
                  {students.length === 0 ? (
                    <p className="text-sm text-inkmuted">No students are currently assigned to this section.</p>
                  ) : sectionBatches.length === 0 ? (
                    <p className="text-sm text-inkmuted">Add a batch above before assigning students.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {students.map((stu) => {
                        const current = assignmentByStudent.get(stu.id);
                        const currentBatch = current ? sectionBatches.find((b) => b.id === current.lab_batch_id) : null;
                        return (
                          <div key={stu.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-paper px-3 py-2">
                            <div>
                              <p className="text-sm text-ink">{stu.full_name || stu.email}</p>
                              <p className="text-xs text-inkmuted">
                                {currentBatch ? `Current batch: ${currentBatch.name}` : "No batch assigned"}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <select
                                value={pickedBatchByStudent[stu.id] ?? ""}
                                onChange={(e) => setPickedBatchByStudent((p) => ({ ...p, [stu.id]: e.target.value }))}
                                className="rounded-md border border-line bg-panel px-2 py-1 text-sm text-ink"
                              >
                                <option value="">Choose batch…</option>
                                {sectionBatches.map((b) => (
                                  <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleAssign(stu.id, s.id)}
                                disabled={saving || !pickedBatchByStudent[stu.id]}
                                className="rounded-md bg-copper px-3 py-1 text-xs font-medium text-white hover:bg-copper-dark disabled:opacity-50"
                              >
                                {currentBatch ? "Change" : "Assign"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
