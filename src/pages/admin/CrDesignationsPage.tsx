import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
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
interface CrRow {
  id: string;
  student_id: string;
  section_id: string;
  designation: "CR1" | "CR2";
}

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// Uses the existing cr_designations table + assign_cr_designation RPC
// exactly as built in Phase 16A. Assign/replace always goes through the
// RPC (works for admin or the section's class teacher — this page is
// admin-only UI, but the RPC's own authorization is what's actually
// enforced regardless of who calls it). "End without replacement" uses
// a direct table UPDATE, which is fine here because this page is
// admin-only and cr_designations already grants admin full direct
// write access via RLS — no new RPC needed for that one case.
export function CrDesignationsPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [studentsBySection, setStudentsBySection] = useState<Record<string, Student[]>>({});
  const [crRows, setCrRows] = useState<CrRow[]>([]);

  const [editing, setEditing] = useState<{ sectionId: string; designation: "CR1" | "CR2" } | null>(null);
  const [pickedStudentId, setPickedStudentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase) return;
    setLoadError(null);
    setLoading(true);
    const [sec, sa, cr] = await Promise.all([
      supabase
        .from("sections")
        .select("id, name, semesters(number, programs(name, regulations(name, academic_years(name))))")
        .order("name"),
      supabase
        .from("student_assignments")
        .select("section_id, users(id, full_name, email)")
        .eq("is_current", true),
      supabase.from("cr_designations").select("id, student_id, section_id, designation").eq("is_current", true),
    ]);
    setLoading(false);
    const firstErr = [sec, sa, cr].find((r) => r.error);
    if (firstErr?.error) {
      setLoadError("We couldn't load CR designation data. Please try again.");
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
    setCrRows((cr.data ?? []) as CrRow[]);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const crBySlot = useMemo(() => {
    const map = new Map<string, CrRow>();
    crRows.forEach((r) => map.set(`${r.section_id}:${r.designation}`, r));
    return map;
  }, [crRows]);

  function startEdit(sectionId: string, designation: "CR1" | "CR2", existing?: CrRow) {
    setEditing({ sectionId, designation });
    setPickedStudentId(existing?.student_id ?? "");
    setRowError(null);
  }

  async function confirmAssign() {
    if (!supabase || !editing) return;
    if (!pickedStudentId) return setRowError("Select a student.");
    setSaving(true);
    setRowError(null);
    const { error } = await supabase.rpc("assign_cr_designation", {
      p_student_id: pickedStudentId,
      p_section_id: editing.sectionId,
      p_designation: editing.designation,
    });
    setSaving(false);
    if (error) {
      setRowError(error.message);
      return;
    }
    setEditing(null);
    await loadAll();
  }

  async function handleEnd(row: CrRow) {
    if (!supabase) return;
    if (!window.confirm(`End this student's ${row.designation} designation? This is preserved in history, not deleted.`)) return;
    setRowError(null);
    const { error } = await supabase
      .from("cr_designations")
      .update({ is_current: false, ended_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      setRowError("Couldn't end this designation. " + error.message);
      return;
    }
    await loadAll();
  }

  function slotContent(sectionId: string, designation: "CR1" | "CR2") {
    const existing = crBySlot.get(`${sectionId}:${designation}`);
    const student = existing ? (studentsBySection[sectionId] ?? []).find((s) => s.id === existing.student_id) : null;
    const isEditing = editing?.sectionId === sectionId && editing.designation === designation;
    const eligible = studentsBySection[sectionId] ?? [];

    if (isEditing) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select value={pickedStudentId} onChange={(e) => setPickedStudentId(e.target.value)} className="rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-ink">
            <option value="">Select a student…</option>
            {eligible.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name || s.email}</option>
            ))}
          </select>
          <button onClick={confirmAssign} disabled={saving} className="rounded-md bg-copper px-3 py-1.5 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={() => setEditing(null)} className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink">
            Cancel
          </button>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-inkmuted">{designation}</p>
          <p className="text-sm text-ink">{student ? student.full_name || student.email : "Not assigned"}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => startEdit(sectionId, designation, existing)}
            disabled={eligible.length === 0 && !existing}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper disabled:opacity-40"
          >
            {existing ? "Replace" : "Assign"}
          </button>
          {existing && (
            <button onClick={() => handleEnd(existing)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger">
              End
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="CR1 / CR2 Designations"
        subtitle="One CR1 and one CR2 per section. A CR must currently belong to that section — this is a designation, not a role."
      />

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}
      {loading && !loadError && <LoadingState label="Loading sections…" />}

      {!loading && !loadError && sections.length === 0 && (
        <EmptyState title="No sections yet" message="Set up Academic Structure (Sections) first." />
      )}

      {rowError && <p className="mb-4 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{rowError}</p>}

      {!loading && !loadError && sections.length > 0 && (
        <div className="space-y-3">
          {sections.map((s) => {
            const eligibleCount = (studentsBySection[s.id] ?? []).length;
            return (
              <div key={s.id} className="rounded-lg border border-line bg-panel p-4">
                <p className="font-display text-sm font-semibold text-ink">Section {s.name}</p>
                <p className="mb-3 text-xs text-inkmuted">{s.breadcrumb}</p>
                {eligibleCount === 0 && (
                  <p className="mb-2 text-sm text-inkmuted">No students are currently assigned to this section.</p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md bg-paper p-3">{slotContent(s.id, "CR1")}</div>
                  <div className="rounded-md bg-paper p-3">{slotContent(s.id, "CR2")}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
