import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface Section { id: string; name: string; }
interface Batch { id: string; name: string; }
interface Student { id: string; full_name: string; email: string; usn: string | null; }
interface AssignmentRow { student_id: string; lab_batch_id: string; }

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// Assignment goes exclusively through assign_lab_batch() (already
// existed pre-16G, already checks is_admin() OR
// is_class_teacher_of_section() itself, already ends the previous
// current assignment and stamps assigned_by = auth.uid()). This page
// has no direct table write to student_lab_batch_assignments at all —
// it's purely a Class Teacher-facing surface for an RPC that already
// supported this.
export function TeacherLabBatchesPage() {
  const { profile } = useAuth();
  const [sections, setSections] = useState<Section[] | null>(null);
  const [sectionId, setSectionId] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [roster, setRoster] = useState<Student[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);

  useEffect(() => {
    async function loadSections() {
      if (!supabase || !profile) return;
      setError(null);
      const { data, error: err } = await supabase
        .from("class_teacher_assignments")
        .select("section_id, sections(name)")
        .eq("teacher_id", profile.id)
        .eq("is_current", true);
      if (err) { setError(friendlyDbError(err, "Your class-teacher sections")); return; }
      setSections((data ?? []).map((r: any) => ({ id: r.section_id, name: first<{ name: string }>(r.sections)?.name ?? "—" })));
    }
    loadSections();
  }, [profile]);

  async function loadRoster(sec: string) {
    if (!supabase) return;
    setRosterLoading(true);
    setActionError(null);
    const [batchRes, rosterRes, assignRes] = await Promise.all([
      supabase.from("lab_batches").select("id, name").eq("section_id", sec).order("name"),
      supabase.from("student_assignments").select("users(id, full_name, email, usn)").eq("section_id", sec).eq("is_current", true),
      supabase.from("student_lab_batch_assignments").select("student_id, lab_batch_id").eq("section_id", sec).eq("is_current", true),
    ]);
    setRosterLoading(false);
    setBatches((batchRes.data ?? []) as Batch[]);
    setRoster((rosterRes.data ?? []).map((r: any) => first<Student>(r.users)).filter(Boolean) as Student[]);
    setAssignments((assignRes.data ?? []) as AssignmentRow[]);
  }

  function selectSection(id: string) {
    setSectionId(id);
    if (id) loadRoster(id);
  }

  async function assign(studentId: string, batchId: string) {
    if (!supabase || !batchId) return;
    setSavingStudentId(studentId);
    setActionError(null);
    const { error: err } = await supabase.rpc("assign_lab_batch", { p_student_id: studentId, p_lab_batch_id: batchId });
    setSavingStudentId(null);
    if (err) { setActionError(friendlyDbError(err, "Lab batch assignment")); return; }
    await loadRoster(sectionId);
  }

  if (error) return <ErrorState message={error} />;
  if (sections === null) return <LoadingState label="Loading your class-teacher sections…" />;

  return (
    <div>
      <PageHeader title="Lab Batches" subtitle="Assign students in your section to a lab batch." />

      {sections.length === 0 ? (
        <EmptyState title="You're not a Class Teacher yet" message="This page is only for sections where you're assigned as Class Teacher." />
      ) : (
        <>
          <select value={sectionId} onChange={(e) => selectSection(e.target.value)} className="mb-4 rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-ink">
            <option value="">Select section</option>
            {sections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
          </select>

          {actionError && <p className="mb-4 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{actionError}</p>}

          {!sectionId ? null : rosterLoading ? (
            <LoadingState label="Loading roster…" />
          ) : batches.length === 0 ? (
            <EmptyState title="No lab batches configured for this section." message="Ask your Super Admin to create lab batches first." />
          ) : roster.length === 0 ? (
            <EmptyState title="No students assigned to this section." message="" />
          ) : (
            <div className="space-y-2">
              {roster.map((s) => {
                const current = assignments.find((a) => a.student_id === s.id);
                return (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-ink">{s.full_name || s.email}</p>
                      <p className="text-xs text-inkmuted">{s.usn ?? s.email}</p>
                    </div>
                    <select
                      value={current?.lab_batch_id ?? ""}
                      onChange={(e) => e.target.value && assign(s.id, e.target.value)}
                      disabled={savingStudentId === s.id}
                      className="rounded-md border border-line bg-paper px-2 py-1.5 text-xs text-ink"
                    >
                      <option value="">Not assigned</option>
                      {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
