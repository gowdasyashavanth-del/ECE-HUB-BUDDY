import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface Section { id: string; name: string; }
interface Student { id: string; full_name: string; email: string; usn: string | null; }
interface CrRow { id: string; student_id: string; designation: "CR1" | "CR2"; }

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// This page never writes to cr_designations directly. Assignment goes
// through assign_cr_designation() and ending goes through
// end_cr_designation() (16G final pass) — both SECURITY DEFINER RPCs
// that check is_admin() OR is_class_teacher_of_section() themselves and
// enforce "at most one current CR1 and one current CR2 per section."
// A raw table write from here would risk violating that invariant.
export function TeacherCrPage() {
  const { profile } = useAuth();
  const [sections, setSections] = useState<Section[] | null>(null);
  const [sectionId, setSectionId] = useState("");
  const [roster, setRoster] = useState<Student[]>([]);
  const [crRows, setCrRows] = useState<CrRow[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draftStudent, setDraftStudent] = useState<Record<"CR1" | "CR2", string>>({ CR1: "", CR2: "" });
  const [saving, setSaving] = useState<"CR1" | "CR2" | null>(null);

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
    const [rosterRes, crRes] = await Promise.all([
      supabase.from("student_assignments").select("users(id, full_name, email, usn)").eq("section_id", sec).eq("is_current", true),
      supabase.from("cr_designations").select("id, student_id, designation").eq("section_id", sec).eq("is_current", true),
    ]);
    setRosterLoading(false);
    setRoster((rosterRes.data ?? []).map((r: any) => first<Student>(r.users)).filter(Boolean) as Student[]);
    setCrRows((crRes.data ?? []) as CrRow[]);
  }

  function selectSection(id: string) {
    setSectionId(id);
    if (id) loadRoster(id);
  }

  async function assign(designation: "CR1" | "CR2") {
    if (!supabase || !sectionId || !draftStudent[designation]) return;
    setSaving(designation);
    setActionError(null);
    const { error: err } = await supabase.rpc("assign_cr_designation", {
      p_student_id: draftStudent[designation],
      p_section_id: sectionId,
      p_designation: designation,
    });
    setSaving(null);
    if (err) { setActionError(friendlyDbError(err, "CR assignment")); return; }
    setDraftStudent((d) => ({ ...d, [designation]: "" }));
    await loadRoster(sectionId);
  }

  async function endDesignation(row: CrRow) {
    if (!supabase) return;
    if (!window.confirm(`End ${row.designation} designation for this student?`)) return;
    setActionError(null);
    const { error: err } = await supabase.rpc("end_cr_designation", { p_id: row.id });
    if (err) { setActionError(friendlyDbError(err, "CR designation")); return; }
    await loadRoster(sectionId);
  }

  if (error) return <ErrorState message={error} />;
  if (sections === null) return <LoadingState label="Loading your class-teacher sections…" />;

  return (
    <div>
      <PageHeader title="CR1 / CR2" subtitle="Assign or change class representatives for your own section." />

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
          ) : roster.length === 0 ? (
            <EmptyState title="No students assigned to this section." message="" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {(["CR1", "CR2"] as const).map((designation) => {
                const current = crRows.find((r) => r.designation === designation);
                const currentStudent = current ? roster.find((s) => s.id === current.student_id) : null;
                return (
                  <div key={designation} className="rounded-lg border border-line bg-panel p-4">
                    <p className="font-display text-sm font-semibold text-ink">{designation}</p>
                    {current ? (
                      <div className="mt-2 flex items-center justify-between">
                        <div>
                          <p className="text-sm text-ink">{currentStudent?.full_name ?? "Unknown student"}</p>
                          <p className="font-mono text-xs text-inkmuted">{currentStudent?.usn ?? currentStudent?.email}</p>
                        </div>
                        <button onClick={() => endDesignation(current)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger">End</button>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-inkmuted">Not assigned</p>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <select
                        value={draftStudent[designation]}
                        onChange={(e) => setDraftStudent((d) => ({ ...d, [designation]: e.target.value }))}
                        className="flex-1 rounded-md border border-line bg-paper px-2 py-1.5 text-xs text-ink"
                      >
                        <option value="">{current ? "Replace with…" : "Assign…"}</option>
                        {roster.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
                      </select>
                      <button
                        onClick={() => assign(designation)}
                        disabled={!draftStudent[designation] || saving === designation}
                        className="rounded-md bg-copper px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {saving === designation ? "Saving…" : "Save"}
                      </button>
                    </div>
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
