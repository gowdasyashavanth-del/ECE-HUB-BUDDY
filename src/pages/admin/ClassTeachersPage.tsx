import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface Teacher {
  id: string;
  full_name: string;
  email: string;
}
interface SectionRow {
  id: string;
  name: string;
  breadcrumb: string;
}
interface Assignment {
  id: string;
  teacher_id: string;
  section_id: string;
  assigned_at: string;
}

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// Uses the existing class_teacher_assignments table + assign_class_teacher
// RPC from Phase 16A exactly as designed — this page is a UI only.
// Every write goes through the RPC (admin-only, atomically ends the
// section's previous class teacher and inserts the new one), never a
// direct table write, so history (is_current/ended_at) is preserved
// automatically without any logic duplicated here.
export function ClassTeachersPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [current, setCurrent] = useState<Assignment[]>([]);

  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [pickedTeacherId, setPickedTeacherId] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase) return;
    setLoadError(null);
    setLoading(true);
    const [t, sec, asg] = await Promise.all([
      supabase.from("users").select("id, full_name, email").eq("role", "teacher").order("full_name"),
      supabase
        .from("sections")
        .select("id, name, semesters(number, programs(name, regulations(name, academic_years(name))))")
        .order("name"),
      supabase.from("class_teacher_assignments").select("id, teacher_id, section_id, assigned_at").eq("is_current", true),
    ]);
    setLoading(false);
    const firstErr = [t, sec, asg].find((r) => r.error);
    if (firstErr?.error) {
      setLoadError(friendlyDbError(firstErr.error, "Class teacher data"));
      return;
    }
    setTeachers(t.data ?? []);
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
    setCurrent(asg.data ?? []);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const currentBySection = useMemo(() => {
    const map = new Map<string, Assignment>();
    current.forEach((a) => map.set(a.section_id, a));
    return map;
  }, [current]);

  function startEdit(sectionId: string, existing?: Assignment) {
    setEditingSectionId(sectionId);
    setPickedTeacherId(existing?.teacher_id ?? "");
    setRowError(null);
  }

  async function confirmAssign(sectionId: string) {
    if (!supabase) return;
    if (!pickedTeacherId) return setRowError("Select a teacher.");
    setSaving(true);
    setRowError(null);
    const { error } = await supabase.rpc("assign_class_teacher", {
      p_teacher_id: pickedTeacherId,
      p_section_id: sectionId,
    });
    setSaving(false);
    if (error) {
      setRowError(error.message);
      return;
    }
    setEditingSectionId(null);
    await loadAll();
  }

  return (
    <div>
      <PageHeader
        title="Class Teachers"
        subtitle="Exactly one current class teacher per section. Replacing one ends the previous assignment (history preserved) and starts a new one."
      />

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}
      {loading && !loadError && <LoadingState label="Loading sections…" />}

      {!loading && !loadError && teachers.length === 0 && (
        <EmptyState title="No teachers yet" message="Create a teacher account on the Teachers page first." />
      )}

      {!loading && !loadError && teachers.length > 0 && sections.length === 0 && (
        <EmptyState title="No sections yet" message="Set up Academic Structure (Sections) first." />
      )}

      {rowError && <p className="mb-4 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{rowError}</p>}

      {!loading && !loadError && sections.length > 0 && (
        <div className="space-y-2">
          {sections.map((s) => {
            const assignment = currentBySection.get(s.id);
            const teacher = assignment ? teachers.find((t) => t.id === assignment.teacher_id) : null;
            const isEditing = editingSectionId === s.id;
            return (
              <div key={s.id} className="rounded-lg border border-line bg-panel p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-sm font-semibold text-ink">Section {s.name}</p>
                    <p className="text-xs text-inkmuted">{s.breadcrumb}</p>
                  </div>

                  {isEditing ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={pickedTeacherId}
                        onChange={(e) => setPickedTeacherId(e.target.value)}
                        className="rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-ink"
                      >
                        <option value="">Select a teacher…</option>
                        {teachers.map((t) => (
                          <option key={t.id} value={t.id}>{t.full_name || t.email}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => confirmAssign(s.id)}
                        disabled={saving}
                        className="rounded-md bg-copper px-3 py-1.5 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-50"
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => setEditingSectionId(null)} className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-sm text-ink">{teacher ? (teacher.full_name || teacher.email) : "No class teacher assigned"}</p>
                        {assignment && (
                          <p className="text-xs text-inkmuted">
                            Since {new Date(assignment.assigned_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => startEdit(s.id, assignment)}
                        className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper"
                      >
                        {assignment ? "Change" : "Assign"}
                      </button>
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
