import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { Badge } from "../../components/ui/Badge";

// Real Supabase Auth + application-profile + assignment creation.
// The Auth Admin API call (the only privileged step) happens inside the
// `admin-create-user` Edge Function, which uses the service-role key
// ONLY there — never in this client code. Everything else here (lists,
// duplicate checks, password reset emails, demote) goes through the
// existing RLS/is_admin() paths the rest of the admin panel already
// uses; no new client-side authorization of any kind.

interface Year { id: string; name: string; }
interface Reg { id: string; name: string; academic_year_id: string; }
interface Prog { id: string; name: string; regulation_id: string; }
interface Sem { id: string; number: number; name: string | null; program_id: string; }
interface Sect { id: string; name: string; semester_id: string; academic_year_id: string; }
interface Subj { id: string; name: string; semester_id: string; }

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: "student" | "teacher" | "super_admin";
  usn: string | null;
  employee_id: string | null;
  created_at: string;
}
interface StudentAssignmentRow {
  student_id: string;
  is_current: boolean;
  section_id: string;
  semester_id: string;
}
interface TeacherAssignmentRow {
  teacher_id: string;
  section_id: string;
  subject_id: string;
}

const inputClass =
  "mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none disabled:bg-paper disabled:text-inkmuted";
const labelClass = "block text-xs font-medium text-inkmuted";

function emptyStudentForm() {
  return { full_name: "", email: "", phone: "", usn: "", temp_password: "", yearId: "", regId: "", progId: "", semId: "", sectionId: "" };
}
function emptyTeacherForm() {
  return { full_name: "", email: "", phone: "", employee_id: "", temp_password: "", yearId: "", regId: "", progId: "", semId: "", sectionId: "", subjectId: "" };
}

export function UserManagementPage() {
  const [tab, setTab] = useState<"student" | "teacher">("student");
  const [showForm, setShowForm] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [years, setYears] = useState<Year[]>([]);
  const [regs, setRegs] = useState<Reg[]>([]);
  const [programs, setPrograms] = useState<Prog[]>([]);
  const [semesters, setSemesters] = useState<Sem[]>([]);
  const [sections, setSections] = useState<Sect[]>([]);
  const [subjects, setSubjects] = useState<Subj[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [studentAssignments, setStudentAssignments] = useState<StudentAssignmentRow[]>([]);
  const [teacherAssignments, setTeacherAssignments] = useState<TeacherAssignmentRow[]>([]);

  const [search, setSearch] = useState("");
  const [studentForm, setStudentForm] = useState(emptyStudentForm());
  const [teacherForm, setTeacherForm] = useState(emptyTeacherForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successNote, setSuccessNote] = useState<string | null>(null);
  const [rowNote, setRowNote] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase) return;
    setLoadError(null);
    setLoading(true);
    const [y, r, p, s, sec, subj, usr, sa, ta] = await Promise.all([
      supabase.from("academic_years").select("id, name").order("name"),
      supabase.from("regulations").select("id, name, academic_year_id"),
      supabase.from("programs").select("id, name, regulation_id"),
      supabase.from("semesters").select("id, number, name, program_id"),
      supabase.from("sections").select("id, name, semester_id, academic_year_id"),
      supabase.from("subjects").select("id, name, semester_id"),
      supabase.from("users").select("id, email, full_name, role, usn, employee_id, created_at").in("role", ["student", "teacher"]).order("created_at", { ascending: false }),
      supabase.from("student_assignments").select("student_id, is_current, section_id, semester_id").eq("is_current", true),
      supabase.from("teacher_assignments").select("teacher_id, section_id, subject_id"),
    ]);
    const firstErr = [y, r, p, s, sec, subj, usr, sa, ta].find((res) => res.error);
    setLoading(false);
    if (firstErr?.error) {
      setLoadError(friendlyDbError(firstErr.error, "User management data"));
      return;
    }
    setYears(y.data ?? []);
    setRegs(r.data ?? []);
    setPrograms(p.data ?? []);
    setSemesters(s.data ?? []);
    setSections(sec.data ?? []);
    setSubjects(subj.data ?? []);
    setUsers((usr.data ?? []) as UserRow[]);
    setStudentAssignments((sa.data ?? []) as StudentAssignmentRow[]);
    setTeacherAssignments((ta.data ?? []) as TeacherAssignmentRow[]);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const form = tab === "student" ? studentForm : teacherForm;
  const setYearId = (v: string) =>
    tab === "student"
      ? setStudentForm((f) => ({ ...f, yearId: v, regId: "", progId: "", semId: "", sectionId: "" }))
      : setTeacherForm((f) => ({ ...f, yearId: v, regId: "", progId: "", semId: "", sectionId: "", subjectId: "" }));
  const setRegId = (v: string) =>
    tab === "student"
      ? setStudentForm((f) => ({ ...f, regId: v, progId: "", semId: "", sectionId: "" }))
      : setTeacherForm((f) => ({ ...f, regId: v, progId: "", semId: "", sectionId: "", subjectId: "" }));
  const setProgId = (v: string) =>
    tab === "student"
      ? setStudentForm((f) => ({ ...f, progId: v, semId: "", sectionId: "" }))
      : setTeacherForm((f) => ({ ...f, progId: v, semId: "", sectionId: "", subjectId: "" }));
  const setSemId = (v: string) =>
    tab === "student"
      ? setStudentForm((f) => ({ ...f, semId: v, sectionId: "" }))
      : setTeacherForm((f) => ({ ...f, semId: v, sectionId: "", subjectId: "" }));
  const setSectionId = (v: string) =>
    tab === "student" ? setStudentForm((f) => ({ ...f, sectionId: v })) : setTeacherForm((f) => ({ ...f, sectionId: v }));

  const filteredRegs = useMemo(() => regs.filter((r) => r.academic_year_id === form.yearId), [regs, form.yearId]);
  const filteredPrograms = useMemo(() => programs.filter((p) => p.regulation_id === form.regId), [programs, form.regId]);
  const filteredSemesters = useMemo(() => semesters.filter((s) => s.program_id === form.progId), [semesters, form.progId]);
  const filteredSections = useMemo(
    () => sections.filter((s) => s.semester_id === form.semId && s.academic_year_id === form.yearId),
    [sections, form.semId, form.yearId]
  );
  const filteredSubjects = useMemo(() => subjects.filter((s) => s.semester_id === form.semId), [subjects, form.semId]);

  function breadcrumb(sectionId: string, semesterId: string): string {
    const sec = sections.find((s) => s.id === sectionId);
    const sem = semesters.find((s) => s.id === semesterId);
    const prog = sem ? programs.find((p) => p.id === sem.program_id) : undefined;
    return `${prog?.name ?? "—"} · Sem ${sem?.number ?? "—"} · Section ${sec?.name ?? "—"}`;
  }
  function subjectName(id: string) {
    return subjects.find((s) => s.id === id)?.name ?? "—";
  }

  const rows = useMemo(() => {
    const base = users.filter((u) => u.role === tab);
    const q = search.trim().toLowerCase();
    const filtered = q
      ? base.filter((u) => u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.usn ?? "").toLowerCase().includes(q) || (u.employee_id ?? "").toLowerCase().includes(q))
      : base;
    return filtered;
  }, [users, tab, search]);

  function resetForm() {
    setStudentForm(emptyStudentForm());
    setTeacherForm(emptyTeacherForm());
    setFormError(null);
  }

  async function handleCreate() {
    if (!supabase) return;
    setFormError(null);
    setSuccessNote(null);

    if (!form.full_name.trim()) return setFormError("Full name is required.");
    if (!form.email.trim()) return setFormError("Email is required.");
    if (form.temp_password.length < 8) return setFormError("Temporary password must be at least 8 characters.");
    if (!form.yearId || !form.regId || !form.progId || !form.semId || !form.sectionId) return setFormError("Select the full academic chain.");
    if (tab === "teacher" && !teacherForm.subjectId) return setFormError("Select a subject.");

    setSubmitting(true);
    const payload =
      tab === "student"
        ? {
            role: "student",
            full_name: studentForm.full_name.trim(),
            email: studentForm.email.trim(),
            phone: studentForm.phone.trim() || null,
            usn: studentForm.usn.trim() || null,
            temp_password: studentForm.temp_password,
            academic_year_id: studentForm.yearId,
            regulation_id: studentForm.regId,
            program_id: studentForm.progId,
            semester_id: studentForm.semId,
            section_id: studentForm.sectionId,
          }
        : {
            role: "teacher",
            full_name: teacherForm.full_name.trim(),
            email: teacherForm.email.trim(),
            phone: teacherForm.phone.trim() || null,
            employee_id: teacherForm.employee_id.trim() || null,
            temp_password: teacherForm.temp_password,
            academic_year_id: teacherForm.yearId,
            regulation_id: teacherForm.regId,
            program_id: teacherForm.progId,
            semester_id: teacherForm.semId,
            section_id: teacherForm.sectionId,
            subject_id: teacherForm.subjectId,
          };

    const { data, error } = await supabase.functions.invoke("admin-create-user", { body: payload });
    setSubmitting(false);

    // supabase-js surfaces a non-2xx Edge Function response as `error`
    // with the JSON body's `error` message unavailable directly on some
    // versions, so read the function's own response body when present.
    if (error) {
      const bodyMsg = (data as { error?: string } | null)?.error;
      setFormError(bodyMsg || error.message || "Could not create the account.");
      return;
    }
    if (data?.error) {
      setFormError(data.error);
      return;
    }

    setSuccessNote(
      `${tab === "student" ? "Student" : "Teacher"} created successfully. Email: ${data.user.email}. Tell them their temporary password and to change it after first login.`
    );
    resetForm();
    setShowForm(false);
    await loadAll();
  }

  async function handleResetPassword(email: string) {
    if (!supabase) return;
    setRowNote(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    setRowNote(error ? error.message : `Password reset email sent to ${email}.`);
  }

  async function handleDemote(user: UserRow) {
    if (!supabase) return;
    if (!window.confirm(`Demote ${user.full_name || user.email} to student? They will lose teacher access immediately. Their teaching assignment history is kept, not deleted.`)) return;
    setRowNote(null);
    const { error } = await supabase.from("users").update({ role: "student" }).eq("id", user.id);
    if (error) {
      setRowNote(friendlyDbError(error, "User"));
      return;
    }
    setRowNote(`${user.full_name || user.email} demoted to student.`);
    await loadAll();
  }

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle="Create real Student and Teacher accounts — a real Supabase Auth login plus the matching profile and academic assignment, in one step."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["student", "teacher"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setShowForm(false);
              setFormError(null);
              setSuccessNote(null);
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-copper text-white" : "border border-line text-ink hover:border-copper"}`}
          >
            {t === "student" ? "Students" : "Teachers"}
          </button>
        ))}
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setFormError(null);
            setSuccessNote(null);
          }}
          className="ml-auto rounded-md bg-copper px-3 py-1.5 text-sm font-medium text-white hover:bg-copper-dark"
        >
          {showForm ? "Cancel" : tab === "student" ? "+ Add Student" : "+ Add Teacher"}
        </button>
      </div>

      {successNote && (
        <div className="mb-4 rounded-lg border border-trace-dark/30 bg-trace-light px-4 py-3 text-sm text-trace-dark">{successNote}</div>
      )}

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}
      {loading && !loadError && <LoadingState label="Loading user management data…" />}

      {!loading && !loadError && showForm && (
        <div className="mb-6 rounded-lg border border-line bg-panel p-4">
          <p className="mb-3 font-display text-sm font-semibold text-ink">
            {tab === "student" ? "Add Student" : "Add Teacher"}
          </p>

          {formError && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{formError}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Full Name</label>
              <input
                className={inputClass}
                value={form.full_name}
                onChange={(e) =>
                  tab === "student"
                    ? setStudentForm((f) => ({ ...f, full_name: e.target.value }))
                    : setTeacherForm((f) => ({ ...f, full_name: e.target.value }))
                }
              />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                className={inputClass}
                value={form.email}
                onChange={(e) =>
                  tab === "student"
                    ? setStudentForm((f) => ({ ...f, email: e.target.value }))
                    : setTeacherForm((f) => ({ ...f, email: e.target.value }))
                }
              />
            </div>
            <div>
              <label className={labelClass}>Phone (optional)</label>
              <input
                className={inputClass}
                value={form.phone}
                onChange={(e) =>
                  tab === "student"
                    ? setStudentForm((f) => ({ ...f, phone: e.target.value }))
                    : setTeacherForm((f) => ({ ...f, phone: e.target.value }))
                }
              />
            </div>
            {tab === "student" ? (
              <div>
                <label className={labelClass}>USN (optional)</label>
                <input
                  className={inputClass}
                  placeholder="e.g. 1BG24EC001"
                  value={studentForm.usn}
                  onChange={(e) => setStudentForm((f) => ({ ...f, usn: e.target.value }))}
                />
              </div>
            ) : (
              <div>
                <label className={labelClass}>Employee ID (optional)</label>
                <input
                  className={inputClass}
                  value={teacherForm.employee_id}
                  onChange={(e) => setTeacherForm((f) => ({ ...f, employee_id: e.target.value }))}
                />
              </div>
            )}
            <div>
              <label className={labelClass}>Temporary Password</label>
              <input
                type="text"
                className={inputClass}
                placeholder="At least 8 characters"
                value={form.temp_password}
                onChange={(e) =>
                  tab === "student"
                    ? setStudentForm((f) => ({ ...f, temp_password: e.target.value }))
                    : setTeacherForm((f) => ({ ...f, temp_password: e.target.value }))
                }
              />
            </div>
          </div>

          <p className="mb-1 mt-4 font-display text-sm font-semibold text-ink">
            {tab === "student" ? "Academic Assignment" : "Teaching Assignment"}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Academic Year</label>
              <select className={inputClass} value={form.yearId} onChange={(e) => setYearId(e.target.value)}>
                <option value="">Select…</option>
                {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Regulation</label>
              <select className={inputClass} value={form.regId} onChange={(e) => setRegId(e.target.value)} disabled={!form.yearId}>
                <option value="">Select…</option>
                {filteredRegs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Program</label>
              <select className={inputClass} value={form.progId} onChange={(e) => setProgId(e.target.value)} disabled={!form.regId}>
                <option value="">Select…</option>
                {filteredPrograms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Semester</label>
              <select className={inputClass} value={form.semId} onChange={(e) => setSemId(e.target.value)} disabled={!form.progId}>
                <option value="">Select…</option>
                {filteredSemesters.map((s) => <option key={s.id} value={s.id}>{s.name || `Semester ${s.number}`}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Section</label>
              <select className={inputClass} value={form.sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!form.semId}>
                <option value="">Select…</option>
                {filteredSections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {tab === "teacher" && (
              <div>
                <label className={labelClass}>Subject</label>
                <select
                  className={inputClass}
                  value={teacherForm.subjectId}
                  onChange={(e) => setTeacherForm((f) => ({ ...f, subjectId: e.target.value }))}
                  disabled={!teacherForm.semId}
                >
                  <option value="">Select…</option>
                  {filteredSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <button
            onClick={handleCreate}
            disabled={submitting}
            className="mt-4 rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-60"
          >
            {submitting ? "Creating…" : tab === "student" ? "Create Student" : "Create Teacher"}
          </button>
        </div>
      )}

      {!loading && !loadError && (
        <>
          <div className="mb-3">
            <input
              className={inputClass}
              placeholder="Search by name, email, USN or employee ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {rowNote && <p className="mb-3 text-sm text-inkmuted">{rowNote}</p>}

          {rows.length === 0 ? (
            <EmptyState
              title={`No ${tab}s yet`}
              message={`Use "+ Add ${tab === "student" ? "Student" : "Teacher"}" above to create the first real account.`}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-paper text-xs uppercase text-inkmuted">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">{tab === "student" ? "USN" : "Employee ID"}</th>
                    <th className="px-3 py-2">Assignment</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => {
                    const sAssign = tab === "student" ? studentAssignments.find((a) => a.student_id === u.id) : undefined;
                    const tAssigns = tab === "teacher" ? teacherAssignments.filter((a) => a.teacher_id === u.id) : [];
                    return (
                      <tr key={u.id} className="border-t border-line">
                        <td className="px-3 py-2 font-medium text-ink">{u.full_name || "—"}</td>
                        <td className="px-3 py-2 text-inkmuted">{u.email}</td>
                        <td className="px-3 py-2 font-mono text-xs">{tab === "student" ? u.usn ?? "—" : u.employee_id ?? "—"}</td>
                        <td className="px-3 py-2 text-xs">
                          {tab === "student" ? (
                            sAssign ? <Badge tone="current">{breadcrumb(sAssign.section_id, sAssign.semester_id)}</Badge> : <span className="text-inkmuted">Unassigned</span>
                          ) : tAssigns.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {tAssigns.map((a, i) => <Badge key={i} tone="active">{subjectName(a.subject_id)}</Badge>)}
                            </div>
                          ) : (
                            <span className="text-inkmuted">Unassigned</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-inkmuted">{new Date(u.created_at).toLocaleDateString()}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <Link
                              to={tab === "student" ? `/admin/student-assignments?student=${u.id}` : "/admin/teacher-assignments"}
                              className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:border-copper"
                            >
                              Assignment
                            </Link>
                            <button
                              onClick={() => handleResetPassword(u.email)}
                              className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:border-copper"
                            >
                              Reset Password
                            </button>
                            {tab === "teacher" && (
                              <button
                                onClick={() => handleDemote(u)}
                                className="rounded-md border border-line px-2 py-1 text-xs font-medium text-danger hover:border-danger"
                              >
                                Demote to Student
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
