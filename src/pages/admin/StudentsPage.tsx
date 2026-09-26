import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface StudentRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  xp: number;
  usn: string | null;
  assignment: {
    section: string;
    semester: number;
    program: string;
  } | null;
}

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// Real Supabase data only — no mock/fake students. As admin (is_admin()
// true), this read is unrestricted by design; nothing here bypasses
// RLS, it's simply the role the policies already grant full access to.
export function StudentsPage() {
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingUsnId, setEditingUsnId] = useState<string | null>(null);
  const [usnDraft, setUsnDraft] = useState("");
  const [usnError, setUsnError] = useState<string | null>(null);

  async function load() {
    if (!supabase) return;
    setError(null);
    setStudents(null);

    const { data: users, error: usersErr } = await supabase
      .from("users")
      .select("id, email, full_name, phone, xp, usn")
      .eq("role", "student")
      .order("full_name");

    if (usersErr) {
      setError(friendlyDbError(usersErr, "Students"));
      return;
    }

    const { data: assignments, error: asgErr } = await supabase
      .from("student_assignments")
      .select("student_id, sections(name), semesters(number, programs(name))")
      .eq("is_current", true);

    if (asgErr) {
      setError(friendlyDbError(asgErr, "Student assignments"));
      return;
    }

    const byStudent = new Map<string, StudentRow["assignment"]>();
    (assignments ?? []).forEach((a: any) => {
      const sec = first<{ name: string }>(a.sections);
      const sem = first<{ number: number; programs: any }>(a.semesters);
      const prog = sem ? first<{ name: string }>(sem.programs) : null;
      byStudent.set(a.student_id, {
        section: sec?.name ?? "—",
        semester: sem?.number ?? 0,
        program: prog?.name ?? "—",
      });
    });

    setStudents(
      (users ?? []).map((u) => ({ ...u, assignment: byStudent.get(u.id) ?? null }))
    );
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = students?.filter(
    (s) =>
      !search.trim() ||
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase()) ||
      (s.usn ?? "").toLowerCase().includes(search.toLowerCase())
  );

  async function saveUsn(studentId: string) {
    if (!supabase) return;
    setUsnError(null);
    const value = usnDraft.trim().toUpperCase();
    const { error: updErr } = await supabase.from("users").update({ usn: value === "" ? null : value }).eq("id", studentId);
    if (updErr) {
      setUsnError(friendlyDbError(updErr, "USN"));
      return;
    }
    setEditingUsnId(null);
    await load();
  }

  return (
    <div>
      <PageHeader title="Students" subtitle="View and search students. Manage academic assignment on the Student Assignments page." />

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or USN…"
          className="w-full max-w-sm rounded-md border border-line bg-panel px-3 py-2 text-sm focus:border-copper focus:outline-none"
        />
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {usnError && <p className="mb-4 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{usnError}</p>}
      {!error && students === null && <LoadingState label="Loading students…" />}
      {!error && students !== null && students.length === 0 && (
        <EmptyState title="No students yet" message="Students appear here automatically once they sign up." />
      )}

      {!error && filtered && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-paper">
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Name</th>
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">USN</th>
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Email</th>
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Current Assignment</th>
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">XP</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5 font-medium text-ink">{s.full_name || "(no name)"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-inkmuted">
                    {editingUsnId === s.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={usnDraft}
                          onChange={(e) => setUsnDraft(e.target.value)}
                          className="w-28 rounded border border-line px-1.5 py-1 text-xs text-ink"
                          placeholder="e.g. 1BG23EC001"
                          autoFocus
                        />
                        <button onClick={() => saveUsn(s.id)} className="rounded bg-copper px-1.5 py-1 text-[10px] font-medium text-white">Save</button>
                        <button onClick={() => setEditingUsnId(null)} className="rounded border border-line px-1.5 py-1 text-[10px] text-ink">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingUsnId(s.id); setUsnDraft(s.usn ?? ""); setUsnError(null); }} className="hover:text-copper-dark">
                        {s.usn ?? "Not set"}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-inkmuted">{s.email}</td>
                  <td className="px-4 py-2.5 text-xs text-inkmuted">
                    {s.assignment ? `${s.assignment.program} · Sem ${s.assignment.semester} · Sec ${s.assignment.section}` : "Not assigned"}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-inkmuted">{s.xp}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/admin/student-assignments?student=${s.id}`}
                      className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper hover:text-copper-dark"
                    >
                      Manage assignment
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!error && filtered && filtered.length === 0 && students && students.length > 0 && (
        <p className="text-sm text-inkmuted">No students match "{search}".</p>
      )}
    </div>
  );
}
