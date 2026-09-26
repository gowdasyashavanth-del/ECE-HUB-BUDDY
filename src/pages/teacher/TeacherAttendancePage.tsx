import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

type Status = "present" | "absent" | "late" | "excused";
const STATUSES: Status[] = ["present", "absent", "late", "excused"];

interface Student { id: string; full_name: string; email: string; }
interface SectionOpt { id: string; name: string; }
interface SubjectOpt { id: string; name: string; code: string | null; }
interface Rec { id: string; student_id: string; status: Status; }

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const todayStr = () => new Date().toISOString().slice(0, 10);

// Every write here goes straight to attendance_records, whose RLS
// (Phase 16A) + validation trigger (migration 25) are the actual
// security/integrity boundary — this page only ever offers the
// teacher their own teacher_assignments (subject mode) or their own
// class_teacher_assignments (class mode), never a free-form
// section/subject/student picker.
export function TeacherAttendancePage() {
  const { profile } = useAuth();
  const [mode, setMode] = useState<"subject" | "class">("subject");

  const [mySections, setMySections] = useState<{ section_id: string; subject_id: string; sectionName: string; subjectName: string }[]>([]);
  const [classSections, setClassSections] = useState<SectionOpt[]>([]);

  const [sectionId, setSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [date, setDate] = useState(todayStr());

  const [students, setStudents] = useState<Student[]>([]);
  const [subjectsForClassMode, setSubjectsForClassMode] = useState<SubjectOpt[]>([]);
  const [existing, setExisting] = useState<Record<string, Rec>>({}); // key: subjectId|studentId (class mode) or studentId (subject mode)
  const [draft, setDraft] = useState<Record<string, Status>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<string | null>(null);

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
        }))
      );
      setClassSections((cta.data ?? []).map((r: any) => ({ id: r.section_id, name: first<{ name: string }>(r.sections)?.name ?? "—" })));
    }
    loadScopes();
  }, [profile]);

  // ── Load roster + existing attendance whenever the selection is complete ──
  useEffect(() => {
    async function loadRoster() {
      if (!supabase || !sectionId || !date) return;
      if (mode === "subject" && !subjectId) return;
      setSaveResult(null);
      setSaveError(null);

      const rosterRes = await supabase
        .from("student_assignments")
        .select("users(id, full_name, email)")
        .eq("section_id", sectionId)
        .eq("is_current", true);
      if (rosterRes.error) {
        setError("We couldn't load the class roster.");
        return;
      }
      const roster = (rosterRes.data ?? []).map((r: any) => first<Student>(r.users)).filter(Boolean) as Student[];
      setStudents(roster);

      if (mode === "subject") {
        const attRes = await supabase
          .from("attendance_records")
          .select("id, student_id, status")
          .eq("section_id", sectionId)
          .eq("subject_id", subjectId)
          .eq("attendance_date", date);
        const map: Record<string, Rec> = {};
        (attRes.data ?? []).forEach((r: any) => { map[r.student_id] = r; });
        setExisting(map);
        const d: Record<string, Status> = {};
        roster.forEach((s) => { d[s.id] = map[s.id]?.status ?? "present"; });
        setDraft(d);
      } else {
        // class mode: every subject taught in this section, matrix by student
        const subjRes = await supabase
          .from("teacher_assignments")
          .select("subject_id, subjects(id, name, code)")
          .eq("section_id", sectionId);
        const uniqueSubjects = new Map<string, SubjectOpt>();
        (subjRes.data ?? []).forEach((r: any) => {
          const s = first<SubjectOpt>(r.subjects);
          if (s) uniqueSubjects.set(s.id, s);
        });
        setSubjectsForClassMode(Array.from(uniqueSubjects.values()));

        const attRes = await supabase
          .from("attendance_records")
          .select("id, student_id, subject_id, status")
          .eq("section_id", sectionId)
          .eq("attendance_date", date);
        const map: Record<string, Rec> = {};
        (attRes.data ?? []).forEach((r: any) => { map[`${r.subject_id}|${r.student_id}`] = r; });
        setExisting(map);
      }
    }
    loadRoster();
  }, [sectionId, subjectId, date, mode]);

  const subjectsForSection = useMemo(
    () => mySections.filter((s) => s.section_id === sectionId),
    [mySections, sectionId]
  );
  const uniqueSectionOptions = useMemo(() => {
    const map = new Map<string, string>();
    mySections.forEach((s) => map.set(s.section_id, s.sectionName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [mySections]);

  function setStatus(studentId: string, status: Status) {
    setDraft((prev) => ({ ...prev, [studentId]: status }));
  }

  function markAllPresent() {
    if (!window.confirm(`Mark all ${students.length} students Present for this date? You can still change individual students afterward.`)) return;
    const d: Record<string, Status> = {};
    students.forEach((s) => { d[s.id] = "present"; });
    setDraft(d);
  }

  async function handleSave() {
    if (!supabase || !sectionId || !date || (mode === "subject" && !subjectId)) return;
    setSaving(true);
    setSaveError(null);
    setSaveResult(null);

    const failures: string[] = [];
    let successCount = 0;

    for (const student of students) {
      const status = draft[student.id];
      if (!status) continue;
      const already = existing[student.id];
      let res;
      if (already) {
        if (already.status === status) continue; // no-op, nothing changed
        res = await supabase.from("attendance_records").update({ status }).eq("id", already.id).select("id");
        if (!res.error && (!res.data || res.data.length === 0)) {
          failures.push(
            `${student.full_name || student.email}: Couldn't correct this record — ordinary subject teachers can only correct the same day's attendance. Ask your Class Teacher or Super Admin for older corrections.`
          );
          continue;
        }
      } else {
        res = await supabase.from("attendance_records").insert({
          student_id: student.id,
          section_id: sectionId,
          subject_id: subjectId,
          attendance_date: date,
          status,
        });
      }
      if (res.error) {
        failures.push(`${student.full_name || student.email}: ${friendlyDbError(res.error, "Attendance")}`);
      } else {
        successCount++;
      }
    }

    setSaving(false);
    if (failures.length > 0) {
      setSaveError(`Some records failed to save:\n${failures.join("\n")}`);
    }
    if (successCount > 0) {
      setSaveResult(`Attendance saved successfully (${successCount} record${successCount === 1 ? "" : "s"}).`);
    }
    // reload existing to reflect saved state
    const attRes = await supabase
      .from("attendance_records")
      .select("id, student_id, status")
      .eq("section_id", sectionId)
      .eq("subject_id", subjectId)
      .eq("attendance_date", date);
    const map: Record<string, Rec> = {};
    (attRes.data ?? []).forEach((r: any) => { map[r.student_id] = r; });
    setExisting(map);
  }

  if (error) return <ErrorState message={error} />;
  if (loading) return <LoadingState label="Loading your assignments…" />;

  const noScopeAtAll = mySections.length === 0 && classSections.length === 0;

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Only sections and subjects you're assigned to." />

      {noScopeAtAll ? (
        <EmptyState title="No sections assigned yet" message="Your Super Admin hasn't assigned you to teach any subject or class yet." />
      ) : (
        <>
          {classSections.length > 0 && (
            <div className="mb-4 flex gap-2">
              <button onClick={() => { setMode("subject"); setSectionId(""); setSubjectId(""); }} className={`rounded-full px-3 py-1.5 text-sm font-medium ${mode === "subject" ? "bg-copper text-white" : "border border-line text-ink"}`}>
                My Subject Attendance
              </button>
              <button onClick={() => { setMode("class"); setSectionId(""); setSubjectId(""); }} className={`rounded-full px-3 py-1.5 text-sm font-medium ${mode === "class" ? "bg-copper text-white" : "border border-line text-ink"}`}>
                My Class (as Class Teacher)
              </button>
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <select
              value={sectionId}
              onChange={(e) => { setSectionId(e.target.value); setSubjectId(""); }}
              className={selectCls}
            >
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
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={selectCls} />
          </div>

          {!sectionId || (mode === "subject" && !subjectId) ? (
            <EmptyState title="Select a section and date" message={mode === "subject" ? "Select a section, subject and date to take or correct attendance." : "Select your section and date to view class attendance."} />
          ) : students.length === 0 ? (
            <EmptyState title="No students are assigned to this section." message="" />
          ) : mode === "subject" ? (
            <SubjectRoster
              students={students}
              draft={draft}
              setStatus={setStatus}
              onMarkAllPresent={markAllPresent}
              onSave={handleSave}
              saving={saving}
              saveError={saveError}
              saveResult={saveResult}
            />
          ) : (
            <ClassMatrix students={students} subjects={subjectsForClassMode} existing={existing} />
          )}
        </>
      )}
    </div>
  );
}

const selectCls = "rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-ink";

const STATUS_STYLES: Record<Status, string> = {
  present: "bg-trace text-white",
  absent: "bg-danger text-white",
  late: "bg-copper text-white",
  excused: "bg-inkmuted text-white",
};

function SubjectRoster({
  students,
  draft,
  setStatus,
  onMarkAllPresent,
  onSave,
  saving,
  saveError,
  saveResult,
}: {
  students: Student[];
  draft: Record<string, Status>;
  setStatus: (id: string, s: Status) => void;
  onMarkAllPresent: () => void;
  onSave: () => void;
  saving: boolean;
  saveError: string | null;
  saveResult: string | null;
}) {
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button onClick={onMarkAllPresent} className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">
          Mark All Present
        </button>
      </div>

      <div className="space-y-2">
        {students.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel p-3">
            <div>
              <p className="text-sm font-medium text-ink">{s.full_name || s.email}</p>
              <p className="text-xs text-inkmuted">{s.email}</p>
            </div>
            <div className="flex gap-1.5">
              {STATUSES.map((st) => (
                <button
                  key={st}
                  onClick={() => setStatus(s.id, st)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium capitalize ${draft[s.id] === st ? STATUS_STYLES[st] : "border border-line text-inkmuted"}`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {saveError && <p className="mt-3 whitespace-pre-line rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{saveError}</p>}
      {saveResult && <p className="mt-3 rounded-md bg-trace-light px-3 py-2 text-sm text-trace-dark" role="status">{saveResult}</p>}

      <div className="sticky bottom-4 mt-4 flex justify-end">
        <button onClick={onSave} disabled={saving} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white shadow-md hover:bg-copper-dark disabled:opacity-50">
          {saving ? "Saving…" : "Save Attendance"}
        </button>
      </div>
    </div>
  );
}

function ClassMatrix({
  students,
  subjects,
  existing,
}: {
  students: Student[];
  subjects: SubjectOpt[];
  existing: Record<string, Rec>;
}) {
  function cell(studentId: string, subjectId: string): Status | null {
    return existing[`${subjectId}|${studentId}`]?.status ?? null;
  }
  function overall(studentId: string): string {
    const statuses = subjects.map((sub) => cell(studentId, sub.id)).filter(Boolean) as Status[];
    if (statuses.length === 0) return "—";
    const present = statuses.filter((s) => s === "present").length;
    return `${present}/${statuses.length}`;
  }

  if (subjects.length === 0) {
    return <EmptyState title="No subjects taught in this section yet" message="Attendance will appear here once subject teachers start recording it." />;
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-line sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-r border-line bg-paper p-2 text-left text-inkmuted">Student</th>
              {subjects.map((s) => <th key={s.id} className="border-b border-line bg-paper p-2 text-ink">{s.name}</th>)}
              <th className="border-b border-line bg-paper p-2 text-ink">Overall</th>
            </tr>
          </thead>
          <tbody>
            {students.map((stu) => (
              <tr key={stu.id}>
                <td className="border-r border-b border-line p-2 text-ink">{stu.full_name || stu.email}</td>
                {subjects.map((sub) => {
                  const st = cell(stu.id, sub.id);
                  return (
                    <td key={sub.id} className="border-b border-line p-2 text-center">
                      {st ? <span className={`rounded px-2 py-0.5 text-xs capitalize ${STATUS_STYLES[st]}`}>{st}</span> : <span className="text-inkmuted">—</span>}
                    </td>
                  );
                })}
                <td className="border-b border-line p-2 text-center text-inkmuted">{overall(stu.id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: student card -> subject list */}
      <div className="space-y-2 sm:hidden">
        {students.map((stu) => (
          <div key={stu.id} className="rounded-lg border border-line bg-panel p-3">
            <p className="text-sm font-medium text-ink">{stu.full_name || stu.email}</p>
            <p className="mb-2 text-xs text-inkmuted">Overall: {overall(stu.id)}</p>
            <div className="space-y-1">
              {subjects.map((sub) => {
                const st = cell(stu.id, sub.id);
                return (
                  <div key={sub.id} className="flex items-center justify-between text-sm">
                    <span className="text-inkmuted">{sub.name}</span>
                    {st ? <span className={`rounded px-2 py-0.5 text-xs capitalize ${STATUS_STYLES[st]}`}>{st}</span> : <span className="text-inkmuted">—</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
