import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface SectionGroup {
  section_id: string;
  section_name: string;
  semester_number: number | null;
  program_name: string | null;
  subject_names: string[];
}

interface RosterStudent {
  student_id: string;
  full_name: string;
  email: string;
  usn: string | null;
  xp: number;
  streak: number;
}

interface StudentOption {
  id: string;
  full_name: string;
  email: string;
}

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// SECURITY NOTE (same guarantee as StudentPerformancePage): this page
// only ever reads what RLS already lets a teacher see —
// teacher_assignments filtered to teacher_id = auth.uid(), and student
// rosters via student_assignments_select's own teacher_assignments
// join. The one write path, assign_student_to_section(), is a
// SECURITY DEFINER RPC (migration 20) that independently re-checks
// teacher_has_section() server-side — a section_id chosen here is only
// ever one this teacher's own assignments produced, but even a
// hand-crafted request with a different section_id would just be
// rejected by the function itself, not by anything in this file.
export function MyStudentsPage() {
  const { profile } = useAuth();
  const [sections, setSections] = useState<SectionGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rosters, setRosters] = useState<Record<string, RosterStudent[]>>({});
  const [rosterErrors, setRosterErrors] = useState<Record<string, string>>({});
  const [assignFor, setAssignFor] = useState<SectionGroup | null>(null);

  const loadRoster = useCallback(async (sectionId: string) => {
    if (!supabase) return;
    const { data, error: rosterErr } = await supabase
      .from("student_assignments")
      .select("student_id, users(full_name, email, usn, xp, streak)")
      .eq("section_id", sectionId)
      .eq("is_current", true);

    if (rosterErr) {
      setRosterErrors((prev) => ({ ...prev, [sectionId]: rosterErr.message }));
      return;
    }
    const roster: RosterStudent[] = (data ?? []).map((r: any) => {
      const u = first<{ full_name: string; email: string; usn: string | null; xp: number; streak: number }>(r.users);
      return {
        student_id: r.student_id,
        full_name: u?.full_name ?? "Unknown",
        email: u?.email ?? "—",
        usn: u?.usn ?? null,
        xp: u?.xp ?? 0,
        streak: u?.streak ?? 0,
      };
    });
    setRosterErrors((prev) => {
      const next = { ...prev };
      delete next[sectionId];
      return next;
    });
    setRosters((prev) => ({ ...prev, [sectionId]: roster }));
  }, []);

  useEffect(() => {
    if (!supabase || !profile) return;
    let cancelled = false;

    async function load() {
      setError(null);
      const { data, error: fetchErr } = await supabase!
        .from("teacher_assignments")
        .select("section_id, sections(name, semesters(number, programs(name))), subjects(name)")
        .eq("teacher_id", profile!.id);

      if (cancelled) return;
      if (fetchErr) {
        setError(fetchErr.message);
        return;
      }

      const bySection = new Map<string, SectionGroup>();
      for (const row of (data ?? []) as any[]) {
        const section = first<{ name: string; semesters: any }>(row.sections);
        const semester = section ? first<{ number: number; programs: any }>(section.semesters) : null;
        const program = semester ? first<{ name: string }>(semester.programs) : null;
        const subject = first<{ name: string }>(row.subjects);

        const existing = bySection.get(row.section_id);
        if (existing) {
          if (subject?.name && !existing.subject_names.includes(subject.name)) {
            existing.subject_names.push(subject.name);
          }
        } else {
          bySection.set(row.section_id, {
            section_id: row.section_id,
            section_name: section?.name ?? "—",
            semester_number: semester?.number ?? null,
            program_name: program?.name ?? null,
            subject_names: subject?.name ? [subject.name] : [],
          });
        }
      }

      const groups = Array.from(bySection.values());
      setSections(groups);
      groups.forEach((g) => loadRoster(g.section_id));
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [profile, loadRoster]);

  if (error) return <ErrorState message={error} />;
  if (!sections) return <LoadingState label="Loading your sections…" />;

  return (
    <div>
      <PageHeader title="My Students" subtitle="Manage the rosters for the sections you're assigned to teach." />

      {sections.length === 0 ? (
        <EmptyState
          title="No sections assigned yet"
          message="Your Super Admin hasn't assigned you to any section yet."
        />
      ) : (
        <div className="space-y-5">
          {sections.map((group) => (
            <SectionCard
              key={group.section_id}
              group={group}
              roster={rosters[group.section_id]}
              rosterError={rosterErrors[group.section_id]}
              onAssignClick={() => setAssignFor(group)}
            />
          ))}
        </div>
      )}

      {assignFor && (
        <AssignStudentDialog
          group={assignFor}
          onClose={() => setAssignFor(null)}
          onAssigned={() => {
            loadRoster(assignFor.section_id);
            setAssignFor(null);
          }}
        />
      )}
    </div>
  );
}

function SectionCard({
  group,
  roster,
  rosterError,
  onAssignClick,
}: {
  group: SectionGroup;
  roster: RosterStudent[] | undefined;
  rosterError: string | undefined;
  onAssignClick: () => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Section {group.section_name}</h2>
          <p className="mt-0.5 text-sm text-inkmuted">
            {group.semester_number ? `Semester ${group.semester_number}` : "—"}
            {group.program_name ? ` • ${group.program_name}` : ""}
          </p>
          {group.subject_names.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {group.subject_names.map((name) => (
                <span
                  key={name}
                  className="rounded-full bg-copper-light px-2.5 py-0.5 text-xs font-medium text-copper-dark"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onAssignClick}
          className="shrink-0 rounded-md bg-copper px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-copper-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
        >
          + Assign Student
        </button>
      </div>

      <div className="mt-4 border-t border-line pt-4">
        {rosterError ? (
          <ErrorState message={rosterError} />
        ) : roster === undefined ? (
          <LoadingState label="Loading students…" />
        ) : roster.length === 0 ? (
          <EmptyState
            title="No students assigned yet"
            message="Assign students to this section to start managing your class."
          />
        ) : (
          <>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-inkmuted">
              Students: {roster.length}
            </p>
            <ul className="divide-y divide-line">
              {roster.map((s) => (
                <li key={s.student_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-ink">{s.full_name}</p>
                    <p className="text-xs text-inkmuted">{s.usn ?? s.email}</p>
                  </div>
                  <div className="flex gap-3 text-xs text-inkmuted">
                    <span>{s.xp} XP</span>
                    <span>{s.streak}🔥 streak</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function AssignStudentDialog({
  group,
  onClose,
  onAssigned,
}: {
  group: SectionGroup;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<StudentOption[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StudentOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setSearchError(null);
      const { data, error } = await supabase!.rpc("search_assignable_students", { p_query: query });
      if (cancelled) return;
      if (error) {
        setSearchError(error.message);
        return;
      }
      setOptions((data ?? []) as StudentOption[]);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query]);

  async function handleAssign() {
    if (!supabase || !selected) return;
    setSubmitting(true);
    setSubmitError(null);
    const { error } = await supabase.rpc("assign_student_to_section", {
      p_student_id: selected.id,
      p_section_id: group.section_id,
    });
    setSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    onAssigned();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-student-title"
        className="relative w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-xl"
      >
        <h2 id="assign-student-title" className="font-display text-lg font-semibold text-ink">
          Assign Student
        </h2>

        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-inkmuted">Section</p>
        <p className="text-sm text-ink">
          {group.semester_number ? `Semester ${group.semester_number} • ` : ""}
          {group.program_name ? `${group.program_name} • ` : ""}
          Section {group.section_name}
        </p>

        <label htmlFor="student-search" className="mt-4 block text-xs font-medium uppercase tracking-wide text-inkmuted">
          Student
        </label>
        <input
          id="student-search"
          type="text"
          placeholder="Search by name or email…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
        />

        {searchError && <p className="mt-2 text-sm text-danger">{searchError}</p>}

        <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-line">
          {options === null ? (
            <p className="px-3 py-2 text-sm text-inkmuted">Searching…</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-inkmuted">
              No eligible students found. A student already assigned elsewhere won't appear here.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {options.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(s)}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-paper ${
                      selected?.id === s.id ? "bg-copper-light" : ""
                    }`}
                  >
                    <span className="text-sm font-medium text-ink">{s.full_name}</span>
                    <span className="text-xs text-inkmuted">{s.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {submitError && (
          <p className="mt-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
            {submitError}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3.5 py-2 text-sm font-medium text-ink hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selected || submitting}
            onClick={handleAssign}
            className="rounded-md bg-copper px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-copper-dark disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
          >
            {submitting ? "Assigning…" : "Assign Student"}
          </button>
        </div>
      </div>
    </div>
  );
}
