import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface Teacher { id: string; full_name: string; email: string; }
interface Year { id: string; name: string; }
interface Reg { id: string; name: string; academic_year_id: string; }
interface Prog { id: string; name: string; regulation_id: string; }
interface Sem { id: string; number: number; program_id: string; }
interface Sect { id: string; name: string; semester_id: string; academic_year_id: string; }
interface Subj { id: string; name: string; code: string | null; semester_id: string; }
interface Assignment { id: string; teacher_id: string; section_id: string; subject_id: string; }

// Reuses the EXISTING teacher_assignments table (teacher_id, section_id,
// subject_id) exactly as created in 04_assignments_enrollments.sql — no
// new table, no denormalized year/regulation/program/semester columns.
// The full chain is walked here purely as a UI convenience (cascading
// dropdowns); only section_id + subject_id are ever written, matching
// the schema decided when this table was designed.
export function TeacherAssignmentsPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [regs, setRegs] = useState<Reg[]>([]);
  const [programs, setPrograms] = useState<Prog[]>([]);
  const [semesters, setSemesters] = useState<Sem[]>([]);
  const [sections, setSections] = useState<Sect[]>([]);
  const [subjects, setSubjects] = useState<Subj[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const [teacherId, setTeacherId] = useState("");
  const [yearId, setYearId] = useState("");
  const [regId, setRegId] = useState("");
  const [progId, setProgId] = useState("");
  const [semId, setSemId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase) return;
    setLoadError(null);
    setLoading(true);
    const [t, y, r, p, s, sec, subj, asg] = await Promise.all([
      supabase.from("users").select("id, full_name, email").eq("role", "teacher").order("full_name"),
      supabase.from("academic_years").select("id, name").order("name"),
      supabase.from("regulations").select("id, name, academic_year_id"),
      supabase.from("programs").select("id, name, regulation_id"),
      supabase.from("semesters").select("id, number, program_id"),
      supabase.from("sections").select("id, name, semester_id, academic_year_id"),
      supabase.from("subjects").select("id, name, code, semester_id"),
      supabase.from("teacher_assignments").select("id, teacher_id, section_id, subject_id"),
    ]);
    const firstErr = [t, y, r, p, s, sec, subj, asg].find((res) => res.error);
    setLoading(false);
    if (firstErr?.error) {
      setLoadError(friendlyDbError(firstErr.error, "Assignment data"));
      return;
    }
    setTeachers(t.data ?? []);
    setYears(y.data ?? []);
    setRegs(r.data ?? []);
    setPrograms(p.data ?? []);
    setSemesters(s.data ?? []);
    setSections(sec.data ?? []);
    setSubjects(subj.data ?? []);
    setAssignments(asg.data ?? []);
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
  const filteredSubjects = useMemo(() => subjects.filter((s) => s.semester_id === semId), [subjects, semId]);

  const teacherAssignments = useMemo(() => assignments.filter((a) => a.teacher_id === teacherId), [assignments, teacherId]);

  // ── Filters for the "all current assignments" table below ─────────
  const [filterYearId, setFilterYearId] = useState("");
  const [filterSemId, setFilterSemId] = useState("");
  const [filterSectionId, setFilterSectionId] = useState("");
  const [filterSubjectId, setFilterSubjectId] = useState("");
  const [filterTeacherId, setFilterTeacherId] = useState("");
  const [reassignRowId, setReassignRowId] = useState<string | null>(null);
  const [reassignTeacherId, setReassignTeacherId] = useState("");
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [reassignSaving, setReassignSaving] = useState(false);

  const filterSemesters = useMemo(
    () => (filterYearId ? semesters.filter((s) => programs.some((p) => p.id === s.program_id && regs.some((r) => r.id === p.regulation_id && r.academic_year_id === filterYearId))) : semesters),
    [semesters, programs, regs, filterYearId]
  );
  const filterSections = useMemo(
    () => sections.filter((s) => (!filterYearId || s.academic_year_id === filterYearId) && (!filterSemId || s.semester_id === filterSemId)),
    [sections, filterYearId, filterSemId]
  );
  const filterSubjectsList = useMemo(
    () => subjects.filter((s) => !filterSemId || s.semester_id === filterSemId),
    [subjects, filterSemId]
  );

  const visibleAssignments = useMemo(() => {
    return assignments.filter((a) => {
      const section = sections.find((s) => s.id === a.section_id);
      if (filterYearId && section?.academic_year_id !== filterYearId) return false;
      if (filterSemId && section?.semester_id !== filterSemId) return false;
      if (filterSectionId && a.section_id !== filterSectionId) return false;
      if (filterSubjectId && a.subject_id !== filterSubjectId) return false;
      if (filterTeacherId && a.teacher_id !== filterTeacherId) return false;
      return true;
    });
  }, [assignments, sections, filterYearId, filterSemId, filterSectionId, filterSubjectId, filterTeacherId]);

  function startReassign(a: Assignment) {
    setReassignRowId(a.id);
    setReassignTeacherId(a.teacher_id);
    setReassignError(null);
  }

  async function confirmReassign(a: Assignment) {
    if (!supabase) return;
    if (!reassignTeacherId) return setReassignError("Select a teacher.");
    if (reassignTeacherId === a.teacher_id) {
      setReassignRowId(null);
      return;
    }
    setReassignSaving(true);
    setReassignError(null);
    // A plain UPDATE, not a delete+insert — teacher_assignments has no
    // history columns at all (no is_current/ended_at), so there is no
    // "old row preserved as history" concept to maintain here; this
    // simply changes who holds this exact section+subject slot.
    const { error } = await supabase.from("teacher_assignments").update({ teacher_id: reassignTeacherId }).eq("id", a.id);
    setReassignSaving(false);
    if (error) {
      setReassignError(friendlyDbError(error, "Assignment"));
      return;
    }
    setReassignRowId(null);
    await loadAll();
  }


  function breadcrumbFor(a: Assignment): string {
    const section = sections.find((s) => s.id === a.section_id);
    const subject = subjects.find((s) => s.id === a.subject_id);
    const sem = section ? semesters.find((s) => s.id === section.semester_id) : undefined;
    const prog = sem ? programs.find((p) => p.id === sem.program_id) : undefined;
    const reg = prog ? regs.find((r) => r.id === prog.regulation_id) : undefined;
    const year = section ? years.find((y) => y.id === section.academic_year_id) : undefined;
    return `${prog?.name ?? "—"} · ${reg?.name ?? "—"} · ${year?.name ?? "—"} · Sem ${sem?.number ?? "—"} · Section ${section?.name ?? "—"} · ${subject?.name ?? "—"}`;
  }

  async function handleAdd() {
    if (!supabase) return;
    setFormError(null);
    if (!teacherId) return setFormError("Select a teacher first.");
    if (!sectionId) return setFormError("Select a section.");
    if (!subjectId) return setFormError("Select a subject.");

    setSaving(true);
    const { error } = await supabase.from("teacher_assignments").insert({
      teacher_id: teacherId,
      section_id: sectionId,
      subject_id: subjectId,
    });
    setSaving(false);
    if (error) {
      setFormError(friendlyDbError(error, "Assignment"));
      return;
    }
    setSectionId("");
    setSubjectId("");
    await loadAll();
  }

  async function handleRemove(a: Assignment) {
    if (!supabase) return;
    if (!window.confirm("Remove this assignment? The teacher will immediately lose access to this subject/section.")) return;
    setRowError(null);
    const { error } = await supabase.from("teacher_assignments").delete().eq("id", a.id);
    if (error) {
      setRowError(friendlyDbError(error, "Assignment"));
      return;
    }
    await loadAll();
  }

  const selectClass = "mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none disabled:bg-paper disabled:text-inkmuted";

  return (
    <div>
      <PageHeader
        title="Teacher Assignments"
        subtitle="Assign a teacher to a specific Academic Year → Regulation → Program → Semester → Section → Subject. Teacher access is scoped exactly to these assignments — nothing more."
      />

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}
      {loading && !loadError && <LoadingState label="Loading assignment data…" />}

      {!loading && !loadError && teachers.length === 0 && (
        <EmptyState title="No teachers yet" message="Create a teacher account on the Teachers page first." />
      )}
      {!loading && !loadError && teachers.length > 0 && years.length === 0 && (
        <EmptyState title="No academic structure yet" message="Set up Academic Years, Regulations, Programs, Semesters, Sections and Subjects first." />
      )}

      {!loading && !loadError && teachers.length > 0 && years.length > 0 && (
        <>
          <div className="mb-6 rounded-lg border border-line bg-panel p-4">
            <p className="mb-3 font-display text-sm font-semibold text-ink">All current assignments</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <select value={filterYearId} onChange={(e) => { setFilterYearId(e.target.value); setFilterSemId(""); setFilterSectionId(""); setFilterSubjectId(""); }} className={selectClass}>
                <option value="">All years</option>
                {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
              <select value={filterSemId} onChange={(e) => { setFilterSemId(e.target.value); setFilterSectionId(""); setFilterSubjectId(""); }} className={selectClass}>
                <option value="">All semesters</option>
                {filterSemesters.map((s) => <option key={s.id} value={s.id}>Semester {s.number}</option>)}
              </select>
              <select value={filterSectionId} onChange={(e) => setFilterSectionId(e.target.value)} className={selectClass}>
                <option value="">All sections</option>
                {filterSections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
              </select>
              <select value={filterSubjectId} onChange={(e) => setFilterSubjectId(e.target.value)} className={selectClass}>
                <option value="">All subjects</option>
                {filterSubjectsList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={filterTeacherId} onChange={(e) => setFilterTeacherId(e.target.value)} className={selectClass}>
                <option value="">All teachers</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name || t.email}</option>)}
              </select>
            </div>

            {reassignError && <p className="mt-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{reassignError}</p>}

            {visibleAssignments.length === 0 ? (
              <p className="mt-4 text-sm text-inkmuted">No teacher assignments match these filters.</p>
            ) : (
              <>
                {/* Desktop table */}
                <div className="mt-4 hidden overflow-x-auto sm:block">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-inkmuted">
                        <th className="py-2 pr-3">Section</th>
                        <th className="py-2 pr-3">Subject</th>
                        <th className="py-2 pr-3">Code</th>
                        <th className="py-2 pr-3">Teacher</th>
                        <th className="py-2 pr-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAssignments.map((a) => {
                        const section = sections.find((s) => s.id === a.section_id);
                        const subject = subjects.find((s) => s.id === a.subject_id);
                        const teacher = teachers.find((t) => t.id === a.teacher_id);
                        const isReassigning = reassignRowId === a.id;
                        return (
                          <tr key={a.id} className="border-b border-line last:border-0">
                            <td className="py-2 pr-3 text-ink">{section?.name ?? "—"}</td>
                            <td className="py-2 pr-3 text-ink">{subject?.name ?? "—"}</td>
                            <td className="py-2 pr-3 font-mono text-xs text-inkmuted">{subject?.code ?? "—"}</td>
                            <td className="py-2 pr-3 text-ink">
                              {isReassigning ? (
                                <select value={reassignTeacherId} onChange={(e) => setReassignTeacherId(e.target.value)} className="rounded-md border border-line bg-paper px-2 py-1 text-sm">
                                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name || t.email}</option>)}
                                </select>
                              ) : (
                                teacher?.full_name || teacher?.email || "—"
                              )}
                            </td>
                            <td className="py-2 pr-3">
                              {isReassigning ? (
                                <div className="flex gap-2">
                                  <button onClick={() => confirmReassign(a)} disabled={reassignSaving} className="rounded-md bg-copper px-2.5 py-1 text-xs font-medium text-white hover:bg-copper-dark disabled:opacity-50">
                                    {reassignSaving ? "Saving…" : "Save"}
                                  </button>
                                  <button onClick={() => setReassignRowId(null)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink">
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex gap-2">
                                  <button onClick={() => startReassign(a)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper">
                                    Change teacher
                                  </button>
                                  <button onClick={() => handleRemove(a)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger">
                                    Remove
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="mt-4 space-y-2 sm:hidden">
                  {visibleAssignments.map((a) => {
                    const section = sections.find((s) => s.id === a.section_id);
                    const subject = subjects.find((s) => s.id === a.subject_id);
                    const teacher = teachers.find((t) => t.id === a.teacher_id);
                    const isReassigning = reassignRowId === a.id;
                    return (
                      <div key={a.id} className="rounded-lg border border-line bg-panel p-3">
                        <p className="text-sm font-medium text-ink">Section {section?.name ?? "—"} · {subject?.name ?? "—"}</p>
                        {subject?.code && <p className="font-mono text-xs text-inkmuted">{subject.code}</p>}
                        <div className="mt-1">
                          {isReassigning ? (
                            <select value={reassignTeacherId} onChange={(e) => setReassignTeacherId(e.target.value)} className="w-full rounded-md border border-line bg-paper px-2 py-1 text-sm">
                              {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name || t.email}</option>)}
                            </select>
                          ) : (
                            <p className="text-sm text-inkmuted">{teacher?.full_name || teacher?.email || "—"}</p>
                          )}
                        </div>
                        <div className="mt-2 flex gap-2">
                          {isReassigning ? (
                            <>
                              <button onClick={() => confirmReassign(a)} disabled={reassignSaving} className="rounded-md bg-copper px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                                {reassignSaving ? "Saving…" : "Save"}
                              </button>
                              <button onClick={() => setReassignRowId(null)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink">
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startReassign(a)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink">
                                Change teacher
                              </button>
                              <button onClick={() => handleRemove(a)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger">
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="mb-6 rounded-lg border border-line bg-panel p-4">
            <p className="mb-3 font-display text-sm font-semibold text-ink">Assign a teacher</p>
            <label className="block text-xs font-medium text-inkmuted">Teacher</label>
            <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className={selectClass}>
              <option value="">Select a teacher…</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.full_name || t.email}</option>
              ))}
            </select>
          </div>

          {teacherId && (
            <>
              <div className="mb-6 rounded-lg border border-line bg-panel p-4">
                <p className="mb-3 font-display text-sm font-semibold text-ink">Add assignment</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-inkmuted">Academic Year</label>
                    <select value={yearId} onChange={(e) => { setYearId(e.target.value); setRegId(""); setProgId(""); setSemId(""); setSectionId(""); setSubjectId(""); }} className={selectClass}>
                      <option value="">Select…</option>
                      {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-inkmuted">Regulation</label>
                    <select value={regId} disabled={!yearId} onChange={(e) => { setRegId(e.target.value); setProgId(""); setSemId(""); setSectionId(""); setSubjectId(""); }} className={selectClass}>
                      <option value="">{yearId ? "Select…" : "Select academic year first"}</option>
                      {filteredRegs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-inkmuted">Program</label>
                    <select value={progId} disabled={!regId} onChange={(e) => { setProgId(e.target.value); setSemId(""); setSectionId(""); setSubjectId(""); }} className={selectClass}>
                      <option value="">{regId ? "Select…" : "Select regulation first"}</option>
                      {filteredPrograms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-inkmuted">Semester</label>
                    <select value={semId} disabled={!progId} onChange={(e) => { setSemId(e.target.value); setSectionId(""); setSubjectId(""); }} className={selectClass}>
                      <option value="">{progId ? "Select…" : "Select program first"}</option>
                      {filteredSemesters.map((s) => <option key={s.id} value={s.id}>Semester {s.number}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-inkmuted">Section</label>
                    <select value={sectionId} disabled={!semId} onChange={(e) => setSectionId(e.target.value)} className={selectClass}>
                      <option value="">{semId ? "Select…" : "Select semester first"}</option>
                      {filteredSections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
                    </select>
                    {semId && filteredSections.length === 0 && (
                      <p className="mt-1 text-xs text-inkmuted">No sections exist for this semester in this academic year yet.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-inkmuted">Subject</label>
                    <select value={subjectId} disabled={!semId} onChange={(e) => setSubjectId(e.target.value)} className={selectClass}>
                      <option value="">{semId ? "Select…" : "Select semester first"}</option>
                      {filteredSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ""}</option>)}
                    </select>
                    {semId && filteredSubjects.length === 0 && (
                      <p className="mt-1 text-xs text-inkmuted">No subjects exist for this semester yet.</p>
                    )}
                  </div>
                </div>

                {formError && <p className="mt-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}

                <button
                  onClick={handleAdd}
                  disabled={saving || !sectionId || !subjectId}
                  className="mt-4 rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-50"
                >
                  {saving ? "Adding…" : "+ Add Assignment"}
                </button>
              </div>

              {rowError && (
                <div className="mb-4">
                  <ErrorState message={rowError} onRetry={() => setRowError(null)} />
                </div>
              )}

              <p className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">
                Current assignments ({teacherAssignments.length})
              </p>

              {teacherAssignments.length === 0 && (
                <EmptyState title="No assignments yet" message="This teacher has no assigned subjects/sections — add one above." />
              )}

              {teacherAssignments.length > 0 && (
                <div className="space-y-2">
                  {teacherAssignments.map((a) => (
                    <div key={a.id} className="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3">
                      <p className="font-mono text-xs text-ink">{breadcrumbFor(a)}</p>
                      <button
                        onClick={() => handleRemove(a)}
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
