import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

const IA_NUMBERS = [1, 2, 3] as const;
type IaNumber = 1 | 2 | 3;

interface Student { id: string; full_name: string; email: string; }
interface SubjectOpt { id: string; name: string; code: string | null; }
interface Assessment { id: string; subject_id: string; ia_number: number; max_marks: number; }
interface MarkRow { id: string; student_id: string; marks_obtained: number; }

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// Security model this page relies on (already enforced in the DB, not here):
//  - ia_assessments_write_admin_only: only Super Admin can create/edit an
//    IA's max_marks. Teachers never get a "configure max marks" control.
//  - ia_marks_write: a subject teacher may insert/update marks only for
//    students currently in a section they are assigned to teach that
//    subject in (migration ia_marks_section_scope).
//  - ia_marks_select (class-teacher branch) lets a Class Teacher READ all
//    IA marks for their own section, but the write policy has no
//    class-teacher branch — so class-teacher correction is NOT yet
//    authorized in the DB. This page therefore renders the class view as
//    read-only. Enabling correction there would require a new migration
//    (see Phase 16F report), which was intentionally not added.
export function TeacherIaPage() {
  const { profile } = useAuth();
  const [mode, setMode] = useState<"subject" | "class">("subject");

  const [mySections, setMySections] = useState<{ section_id: string; subject_id: string; sectionName: string; subjectName: string; subjectCode: string | null }[]>([]);
  const [classSections, setClassSections] = useState<{ id: string; name: string }[]>([]);

  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [iaNumber, setIaNumber] = useState<IaNumber>(1);

  const [students, setStudents] = useState<Student[]>([]);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [existing, setExisting] = useState<Record<string, MarkRow>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});

  const [classSubjects, setClassSubjects] = useState<SubjectOpt[]>([]);
  const [classAssessments, setClassAssessments] = useState<Record<string, Assessment>>({}); // subject_id -> assessment for selected IA
  const [classMarks, setClassMarks] = useState<Record<string, MarkRow>>({}); // `${subjectId}|${studentId}`

  const [loading, setLoading] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    async function loadScopes() {
      if (!supabase || !profile) return;
      setError(null);
      const [ta, cta] = await Promise.all([
        supabase
          .from("teacher_assignments")
          .select("section_id, subject_id, sections(name), subjects(name, code)")
          .eq("teacher_id", profile.id),
        supabase
          .from("class_teacher_assignments")
          .select("section_id, sections(name)")
          .eq("teacher_id", profile.id)
          .eq("is_current", true),
      ]);
      setLoading(false);
      if (ta.error || cta.error) {
        setError("We couldn't load your teaching assignments. Please try again.");
        return;
      }
      setMySections(
        (ta.data ?? []).map((r: any) => ({
          section_id: r.section_id,
          subject_id: r.subject_id,
          sectionName: first<{ name: string }>(r.sections)?.name ?? "—",
          subjectName: first<{ name: string; code: string | null }>(r.subjects)?.name ?? "—",
          subjectCode: first<{ name: string; code: string | null }>(r.subjects)?.code ?? null,
        }))
      );
      setClassSections((cta.data ?? []).map((r: any) => ({ id: r.section_id, name: first<{ name: string }>(r.sections)?.name ?? "—" })));
    }
    loadScopes();
  }, [profile]);

  const uniqueSectionOptions = useMemo(() => {
    const map = new Map<string, string>();
    mySections.forEach((s) => map.set(s.section_id, s.sectionName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [mySections]);
  const subjectsForSection = useMemo(() => mySections.filter((s) => s.section_id === sectionId), [mySections, sectionId]);

  // ── Subject-teacher mode: load assessment config + roster + marks ──
  useEffect(() => {
    async function loadSubjectMode() {
      if (!supabase || mode !== "subject" || !sectionId || !subjectId) return;
      setRosterLoading(true);
      setSaveError(null);
      setSaveResult(null);
      setFieldErrors({});

      const [rosterRes, assessRes] = await Promise.all([
        supabase.from("student_assignments").select("users(id, full_name, email)").eq("section_id", sectionId).eq("is_current", true),
        supabase.from("ia_assessments").select("id, subject_id, ia_number, max_marks").eq("subject_id", subjectId).eq("ia_number", iaNumber).maybeSingle(),
      ]);
      setRosterLoading(false);
      if (rosterRes.error) {
        setError("We couldn't load the class roster.");
        return;
      }
      const roster = (rosterRes.data ?? []).map((r: any) => first<Student>(r.users)).filter(Boolean) as Student[];
      setStudents(roster);
      const a = (assessRes.data as Assessment | null) ?? null;
      setAssessment(a);

      if (!a) {
        setExisting({});
        setDraft({});
        return;
      }
      const marksRes = await supabase.from("ia_marks").select("id, student_id, marks_obtained").eq("ia_assessment_id", a.id);
      const map: Record<string, MarkRow> = {};
      (marksRes.data ?? []).forEach((r: any) => { map[r.student_id] = r; });
      setExisting(map);
      const d: Record<string, string> = {};
      roster.forEach((s) => { d[s.id] = map[s.id] ? String(map[s.id].marks_obtained) : ""; });
      setDraft(d);
    }
    loadSubjectMode();
  }, [mode, sectionId, subjectId, iaNumber]);

  // ── Class-teacher mode: load all subjects taught in the section + marks for the selected IA ──
  useEffect(() => {
    async function loadClassMode() {
      if (!supabase || mode !== "class" || !sectionId) return;
      setRosterLoading(true);
      setSaveError(null);
      setSaveResult(null);

      const [rosterRes, subjRes] = await Promise.all([
        supabase.from("student_assignments").select("users(id, full_name, email)").eq("section_id", sectionId).eq("is_current", true),
        supabase.from("teacher_assignments").select("subject_id, subjects(id, name, code)").eq("section_id", sectionId),
      ]);
      setRosterLoading(false);
      if (rosterRes.error || subjRes.error) {
        setError("We couldn't load class IA data.");
        return;
      }
      const roster = (rosterRes.data ?? []).map((r: any) => first<Student>(r.users)).filter(Boolean) as Student[];
      setStudents(roster);
      const uniqueSubjects = new Map<string, SubjectOpt>();
      (subjRes.data ?? []).forEach((r: any) => {
        const s = first<SubjectOpt>(r.subjects);
        if (s) uniqueSubjects.set(s.id, s);
      });
      const subjectList = Array.from(uniqueSubjects.values());
      setClassSubjects(subjectList);

      if (subjectList.length === 0) {
        setClassAssessments({});
        setClassMarks({});
        return;
      }
      const assessRes = await supabase
        .from("ia_assessments")
        .select("id, subject_id, ia_number, max_marks")
        .in("subject_id", subjectList.map((s) => s.id))
        .eq("ia_number", iaNumber);
      const assessMap: Record<string, Assessment> = {};
      (assessRes.data ?? []).forEach((a: any) => { assessMap[a.subject_id] = a; });
      setClassAssessments(assessMap);

      const assessmentIds = Object.values(assessMap).map((a) => a.id);
      if (assessmentIds.length === 0) {
        setClassMarks({});
        return;
      }
      const marksRes = await supabase.from("ia_marks").select("id, student_id, marks_obtained, ia_assessment_id").in("ia_assessment_id", assessmentIds);
      const bySubject: Record<string, MarkRow> = {};
      const assessmentToSubject = new Map(Object.entries(assessMap).map(([subjId, a]) => [a.id, subjId]));
      (marksRes.data ?? []).forEach((r: any) => {
        const subjId = assessmentToSubject.get(r.ia_assessment_id);
        if (subjId) bySubject[`${subjId}|${r.student_id}`] = r;
      });
      setClassMarks(bySubject);
    }
    loadClassMode();
  }, [mode, sectionId, iaNumber]);

  function setDraftValue(studentId: string, value: string) {
    setDraft((prev) => ({ ...prev, [studentId]: value }));
    setFieldErrors((prev) => {
      if (!(studentId in prev)) return prev;
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
  }

  async function handleSave() {
    if (!supabase || !assessment) return;
    setSaving(true);
    setSaveError(null);
    setSaveResult(null);

    const errs: Record<string, string> = {};
    const toWrite: { student: Student; value: number }[] = [];
    for (const student of students) {
      const raw = (draft[student.id] ?? "").trim();
      if (raw === "") continue; // leave "not entered yet" alone
      const value = Number(raw);
      if (Number.isNaN(value)) {
        errs[student.id] = "Enter a number.";
        continue;
      }
      if (value < 0) {
        errs[student.id] = "Marks cannot be negative.";
        continue;
      }
      if (value > assessment.max_marks) {
        errs[student.id] = `Marks cannot exceed ${assessment.max_marks}.`;
        continue;
      }
      const already = existing[student.id];
      if (already && Number(already.marks_obtained) === value) continue; // unchanged
      toWrite.push({ student, value });
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setSaving(false);
      setSaveError("Fix the highlighted marks before saving.");
      return;
    }

    const failures: string[] = [];
    let successCount = 0;
    for (const { student, value } of toWrite) {
      const already = existing[student.id];
      const res = already
        ? await supabase.from("ia_marks").update({ marks_obtained: value }).eq("id", already.id)
        : await supabase.from("ia_marks").insert({ ia_assessment_id: assessment.id, student_id: student.id, marks_obtained: value });
      if (res.error) {
        failures.push(`${student.full_name || student.email}: ${friendlyDbError(res.error, "IA mark")}`);
      } else {
        successCount++;
      }
    }

    setSaving(false);
    if (failures.length > 0) setSaveError(`Some marks failed to save:\n${failures.join("\n")}`);
    if (successCount > 0) setSaveResult(`IA marks saved (${successCount} record${successCount === 1 ? "" : "s"}).`);

    const marksRes = await supabase.from("ia_marks").select("id, student_id, marks_obtained").eq("ia_assessment_id", assessment.id);
    const map: Record<string, MarkRow> = {};
    (marksRes.data ?? []).forEach((r: any) => { map[r.student_id] = r; });
    setExisting(map);
  }

  if (error) return <ErrorState message={error} />;
  if (loading) return <LoadingState label="Loading your assignments…" />;

  const noScopeAtAll = mySections.length === 0 && classSections.length === 0;

  return (
    <div>
      <PageHeader title="IA Marks" subtitle="Only sections and subjects you're assigned to." />

      {noScopeAtAll ? (
        <EmptyState title="No sections assigned yet" message="Your Super Admin hasn't assigned you to teach any subject or class yet." />
      ) : (
        <>
          {classSections.length > 0 && (
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => { setMode("subject"); setSectionId(""); setSubjectId(""); }}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${mode === "subject" ? "bg-copper text-white" : "border border-line text-ink"}`}
              >
                My Subject IA
              </button>
              <button
                onClick={() => { setMode("class"); setSectionId(""); setSubjectId(""); }}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${mode === "class" ? "bg-copper text-white" : "border border-line text-ink"}`}
              >
                My Class (as Class Teacher)
              </button>
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select value={sectionId} onChange={(e) => { setSectionId(e.target.value); setSubjectId(""); }} className={selectCls}>
              <option value="">Section</option>
              {(mode === "subject" ? uniqueSectionOptions : classSections).map((s) => (
                <option key={s.id} value={s.id}>Section {s.name}</option>
              ))}
            </select>
            {mode === "subject" && (
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className={selectCls} disabled={!sectionId}>
                <option value="">Subject</option>
                {subjectsForSection.map((s) => <option key={s.subject_id} value={s.subject_id}>{s.subjectName}</option>)}
              </select>
            )}
            <div className="flex gap-1.5">
              {IA_NUMBERS.map((n) => (
                <button
                  key={n}
                  onClick={() => setIaNumber(n)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${iaNumber === n ? "bg-copper text-white" : "border border-line text-ink"}`}
                >
                  IA {n}
                </button>
              ))}
            </div>
          </div>

          {!sectionId || (mode === "subject" && !subjectId) ? (
            <EmptyState
              title="Select a section and IA"
              message={mode === "subject" ? "Select a section, subject and IA number to enter or correct marks." : "Select your section and an IA number to view class-wide marks."}
            />
          ) : rosterLoading ? (
            <LoadingState label="Loading roster…" />
          ) : students.length === 0 ? (
            <EmptyState title="No students are assigned to this section." message="" />
          ) : mode === "subject" ? (
            !assessment ? (
              <EmptyState title="Not configured" message={`IA ${iaNumber} hasn't been configured for this subject yet. Ask your Super Admin to set its maximum marks first.`} />
            ) : (
              <SubjectRoster
                students={students}
                maxMarks={assessment.max_marks}
                draft={draft}
                setValue={setDraftValue}
                fieldErrors={fieldErrors}
                onSave={handleSave}
                saving={saving}
                saveError={saveError}
                saveResult={saveResult}
              />
            )
          ) : (
            <ClassMatrix students={students} subjects={classSubjects} assessments={classAssessments} marks={classMarks} iaNumber={iaNumber} />
          )}
        </>
      )}
    </div>
  );
}

const selectCls = "rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-ink";

function SubjectRoster({
  students,
  maxMarks,
  draft,
  setValue,
  fieldErrors,
  onSave,
  saving,
  saveError,
  saveResult,
}: {
  students: Student[];
  maxMarks: number;
  draft: Record<string, string>;
  setValue: (id: string, v: string) => void;
  fieldErrors: Record<string, string>;
  onSave: () => void;
  saving: boolean;
  saveError: string | null;
  saveResult: string | null;
}) {
  return (
    <div>
      <p className="mb-3 text-sm text-inkmuted">Maximum marks: <span className="font-medium text-ink">{maxMarks}</span></p>

      <div className="space-y-2">
        {students.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel p-3">
            <div>
              <p className="text-sm font-medium text-ink">{s.full_name || s.email}</p>
              <p className="text-xs text-inkmuted">{s.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={maxMarks}
                step="0.5"
                placeholder="—"
                value={draft[s.id] ?? ""}
                onChange={(e) => setValue(s.id, e.target.value)}
                className={`w-20 rounded-md border px-2 py-1.5 text-sm text-ink ${fieldErrors[s.id] ? "border-danger" : "border-line"}`}
              />
              <span className="text-xs text-inkmuted">/ {maxMarks}</span>
            </div>
            {fieldErrors[s.id] && <p className="w-full text-xs text-danger">{fieldErrors[s.id]}</p>}
          </div>
        ))}
      </div>

      {saveError && <p className="mt-3 whitespace-pre-line rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{saveError}</p>}
      {saveResult && <p className="mt-3 rounded-md bg-trace-light px-3 py-2 text-sm text-trace-dark" role="status">{saveResult}</p>}

      <div className="sticky bottom-4 mt-4 flex justify-end">
        <button onClick={onSave} disabled={saving} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white shadow-md hover:bg-copper-dark disabled:opacity-50">
          {saving ? "Saving…" : "Save IA Marks"}
        </button>
      </div>
    </div>
  );
}

function ClassMatrix({
  students,
  subjects,
  assessments,
  marks,
  iaNumber,
}: {
  students: Student[];
  subjects: SubjectOpt[];
  assessments: Record<string, Assessment>;
  marks: Record<string, MarkRow>;
  iaNumber: number;
}) {
  function cellLabel(studentId: string, subjectId: string): string {
    const a = assessments[subjectId];
    if (!a) return "Not configured";
    const m = marks[`${subjectId}|${studentId}`];
    return m ? `${m.marks_obtained}/${a.max_marks}` : `— /${a.max_marks}`;
  }

  if (subjects.length === 0) {
    return <EmptyState title="No subjects taught in this section yet" message="IA marks will appear here once subject teachers configure and enter them." />;
  }

  return (
    <>
      <p className="mb-3 text-sm text-inkmuted">Read-only — this is IA {iaNumber} across every subject taught in your section.</p>
      <div className="hidden overflow-x-auto rounded-lg border border-line sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-r border-line bg-paper p-2 text-left text-inkmuted">Student</th>
              {subjects.map((s) => <th key={s.id} className="border-b border-line bg-paper p-2 text-ink">{s.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {students.map((stu) => (
              <tr key={stu.id}>
                <td className="border-r border-b border-line p-2 text-ink">{stu.full_name || stu.email}</td>
                {subjects.map((sub) => (
                  <td key={sub.id} className="border-b border-line p-2 text-center text-inkmuted">{cellLabel(stu.id, sub.id)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 sm:hidden">
        {students.map((stu) => (
          <div key={stu.id} className="rounded-lg border border-line bg-panel p-3">
            <p className="text-sm font-medium text-ink">{stu.full_name || stu.email}</p>
            <div className="mt-2 space-y-1">
              {subjects.map((sub) => (
                <div key={sub.id} className="flex items-center justify-between text-sm">
                  <span className="text-inkmuted">{sub.name}</span>
                  <span className="text-ink">{cellLabel(stu.id, sub.id)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
