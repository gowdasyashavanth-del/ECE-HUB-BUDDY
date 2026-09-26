import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: string;
}

// "Create/invite teacher" in this build means promoting an EXISTING
// account (one that already signed up, defaulting to role='student'
// via the DB trigger) to role='teacher'. A true "invite a brand-new
// email" flow needs Supabase's admin.inviteUserByEmail, which requires
// the service_role key — that can only live in a server-side Edge
// Function, never this client. That Edge Function doesn't exist yet,
// same gap already flagged for the AI Tutor and Payments back in the
// Phase 1 analysis. Not faked here with a mock invite button.
export function TeachersPage() {
  const [teachers, setTeachers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [searchEmail, setSearchEmail] = useState("");
  const [searchResults, setSearchResults] = useState<UserRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  async function loadTeachers() {
    if (!supabase) return;
    setError(null);
    const { data, error: err } = await supabase
      .from("users")
      .select("id, email, full_name, phone, role")
      .eq("role", "teacher")
      .order("full_name");
    if (err) {
      setError(friendlyDbError(err, "Teachers"));
      return;
    }
    setTeachers(data ?? []);
  }

  useEffect(() => {
    loadTeachers();
  }, []);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !searchEmail.trim()) return;
    setSearching(true);
    setSearchError(null);
    setActionError(null);
    const { data, error: err } = await supabase
      .from("users")
      .select("id, email, full_name, phone, role")
      .ilike("email", `%${searchEmail.trim()}%`)
      .neq("role", "teacher")
      .limit(10);
    setSearching(false);
    if (err) {
      setSearchError(friendlyDbError(err, "Users"));
      return;
    }
    setSearchResults(data ?? []);
  }

  async function handlePromote(user: UserRow) {
    if (!supabase) return;
    setActionError(null);
    const { error: err } = await supabase.from("users").update({ role: "teacher" }).eq("id", user.id);
    if (err) {
      setActionError(friendlyDbError(err, "User"));
      return;
    }
    setSearchResults((r) => r?.filter((u) => u.id !== user.id) ?? null);
    await loadTeachers();
  }

  async function handleDemote(teacher: UserRow) {
    if (!supabase) return;
    if (!window.confirm(`Remove teacher access for ${teacher.full_name || teacher.email}? Their existing assignments will remain but they'll no longer be able to use them (their role becomes 'student').`)) return;
    setActionError(null);
    const { error: err } = await supabase.from("users").update({ role: "student" }).eq("id", teacher.id);
    if (err) {
      setActionError(friendlyDbError(err, "User"));
      return;
    }
    await loadTeachers();
  }

  function startEdit(t: UserRow) {
    setEditingId(t.id);
    setEditName(t.full_name);
    setEditPhone(t.phone ?? "");
  }

  async function saveEdit(id: string) {
    if (!supabase) return;
    setSavingEdit(true);
    setActionError(null);
    const { error: err } = await supabase
      .from("users")
      .update({ full_name: editName, phone: editPhone || null })
      .eq("id", id);
    setSavingEdit(false);
    if (err) {
      setActionError(friendlyDbError(err, "Teacher"));
      return;
    }
    setEditingId(null);
    await loadTeachers();
  }

  return (
    <div>
      <PageHeader title="Teachers" subtitle="Manage teacher accounts. Assignments are managed separately." />

      <div className="mb-6 rounded-lg border border-line bg-panel p-4">
        <p className="mb-2 font-display text-sm font-semibold text-ink">Promote an existing user to Teacher</p>
        <p className="mb-3 text-xs text-inkmuted">
          Search by email for a user who has already signed in to the platform, then promote them.
          To invite someone who has never signed in, they need to create an account first — a direct
          email-invite flow isn't available yet (it requires a server-side function, not built in this phase).
        </p>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            value={searchEmail}
            onChange={(e) => setSearchEmail(e.target.value)}
            placeholder="Search by email…"
            className="flex-1 rounded-md border border-line px-3 py-2 text-sm focus:border-copper focus:outline-none"
          />
          <button
            type="submit"
            disabled={searching}
            className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-60"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {searchError && <p className="mt-2 text-sm text-danger">{searchError}</p>}

        {searchResults !== null && (
          <div className="mt-3 space-y-2">
            {searchResults.length === 0 && <p className="text-sm text-inkmuted">No matching users found.</p>}
            {searchResults.map((u) => (
              <div key={u.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2">
                <div>
                  <p className="text-sm text-ink">{u.full_name || "(no name)"} — {u.email}</p>
                  <p className="font-mono text-xs capitalize text-inkmuted">current role: {u.role}</p>
                </div>
                <button
                  onClick={() => handlePromote(u)}
                  className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-copper hover:text-copper-dark"
                >
                  Promote to Teacher
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} onRetry={() => setActionError(null)} />
        </div>
      )}

      {error && <ErrorState message={error} onRetry={loadTeachers} />}
      {!error && teachers === null && <LoadingState label="Loading teachers…" />}
      {!error && teachers !== null && teachers.length === 0 && (
        <EmptyState title="No teachers yet" message="Promote an existing user above to create your first teacher account." />
      )}

      {!error && teachers !== null && teachers.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-paper">
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Name</th>
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Email</th>
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Phone</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-b-0">
                  {editingId === t.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded-md border border-line px-2 py-1 text-sm" />
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-inkmuted">{t.email}</td>
                      <td className="px-4 py-2">
                        <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="w-full rounded-md border border-line px-2 py-1 text-sm" />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1.5">
                          <button onClick={() => saveEdit(t.id)} disabled={savingEdit} className="rounded-md bg-copper px-2.5 py-1 text-xs font-medium text-white hover:bg-copper-dark disabled:opacity-60">
                            {savingEdit ? "Saving…" : "Save"}
                          </button>
                          <button onClick={() => setEditingId(null)} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink">
                            Cancel
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-medium text-ink">{t.full_name || "(no name)"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-inkmuted">{t.email}</td>
                      <td className="px-4 py-2.5 text-inkmuted">{t.phone || "—"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1.5">
                          <button onClick={() => startEdit(t)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper hover:text-copper-dark">
                            Edit
                          </button>
                          <button onClick={() => handleDemote(t)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger">
                            Remove access
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
