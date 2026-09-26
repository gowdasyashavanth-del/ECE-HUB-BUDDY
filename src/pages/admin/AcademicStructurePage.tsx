import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { Badge } from "../../components/ui/Badge";

interface SubjectNode {
  id: string;
  name: string;
  code: string | null;
}
interface SectionNode {
  id: string;
  name: string;
}
interface SemesterNode {
  id: string;
  number: number;
  sections: SectionNode[];
  subjects: SubjectNode[];
}
interface ProgramNode {
  id: string;
  name: string;
  semesters: SemesterNode[];
}
interface RegulationNode {
  id: string;
  name: string;
  programs: ProgramNode[];
}
interface YearNode {
  id: string;
  name: string;
  is_current: boolean;
  regulations: RegulationNode[];
}

// Interactive read + navigate tree for the whole hierarchy. Every
// create/edit action reuses the existing per-entity CRUD pages
// (/admin/academic/:entityKey) rather than duplicating that form
// logic here — this page's only job is to make the hierarchy
// understandable at a glance and link straight to the right place to
// change it. All data is the real Supabase academic_years/regulations/
// programs/semesters/sections/subjects tables — nothing here is mock
// or local state pretending to be data.
export function AcademicStructurePage() {
  const [years, setYears] = useState<YearNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  async function load() {
    if (!supabase) return;
    setError(null);
    const [yearRes, regRes, progRes, semRes, secRes, subRes] = await Promise.all([
      supabase.from("academic_years").select("id, name, is_current").order("name"),
      supabase.from("regulations").select("id, name, academic_year_id").order("name"),
      supabase.from("programs").select("id, name, regulation_id").order("name"),
      supabase.from("semesters").select("id, number, program_id").order("number"),
      supabase.from("sections").select("id, name, semester_id").order("name"),
      supabase.from("subjects").select("id, name, code, semester_id, order_number").order("order_number"),
    ]);

    if (yearRes.error) {
      setError("We couldn't load the academic structure. Please try again.");
      return;
    }

    const regRows = regRes.data ?? [];
    const progRows = progRes.data ?? [];
    const semRows = semRes.data ?? [];
    const secRows = secRes.data ?? [];
    const subRows = subRes.data ?? [];

    const tree: YearNode[] = (yearRes.data ?? []).map((y) => ({
      id: y.id,
      name: y.name,
      is_current: y.is_current,
      regulations: regRows
        .filter((r) => r.academic_year_id === y.id)
        .map((r) => ({
          id: r.id,
          name: r.name,
          programs: progRows
            .filter((p) => p.regulation_id === r.id)
            .map((p) => ({
              id: p.id,
              name: p.name,
              semesters: semRows
                .filter((s) => s.program_id === p.id)
                .map((s) => ({
                  id: s.id,
                  number: s.number,
                  sections: secRows.filter((sec) => sec.semester_id === s.id),
                  subjects: subRows.filter((sub) => sub.semester_id === s.id),
                })),
            })),
        })),
    }));

    setYears(tree);
  }

  useEffect(() => {
    load();
  }, []);

  function toggle(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const addLinkClass =
    "inline-block rounded-md border border-line px-2.5 py-1 text-xs font-medium text-copper-dark hover:border-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper";

  return (
    <div>
      <PageHeader
        title="Academic Structure"
        subtitle="Academic Year → Regulation → Program → Semester → Section / Subject → Unit → Topic → Content"
        action={
          <Link to="/admin/academic/academic-years" className={addLinkClass}>
            Manage all entities →
          </Link>
        }
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && years === null && <LoadingState label="Loading academic structure…" />}

      {!error && years !== null && years.length === 0 && (
        <EmptyState
          title="No academic years set up yet"
          message="Create the first academic year to start building out the hierarchy."
          action={{ label: "+ Add Academic Year", onClick: () => navigate("/admin/academic/academic-years") }}
        />
      )}

      {!error && years !== null && years.length > 0 && (
        <div className="space-y-4">
          {years.map((year) => (
            <div key={year.id} className="rounded-lg border border-line bg-panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-display text-sm font-semibold text-ink">{year.name}</p>
                {year.is_current && <Badge tone="current">Current</Badge>}
                <Link to="/admin/academic/regulations" className={`${addLinkClass} ml-auto`}>
                  + Add Regulation
                </Link>
              </div>

              {year.regulations.length === 0 && (
                <p className="mt-2 text-sm text-inkmuted">{year.name} has no regulations yet.</p>
              )}

              <div className="ml-2 mt-3 space-y-3 border-l border-line pl-4 sm:ml-4">
                {year.regulations.map((reg) => (
                  <div key={reg.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-body text-sm font-medium text-ink">{reg.name}</p>
                      <Link to="/admin/academic/programs" className={`${addLinkClass} ml-auto`}>
                        + Add Program
                      </Link>
                    </div>
                    {reg.programs.length === 0 && (
                      <p className="mt-1 text-sm text-inkmuted">No programs yet.</p>
                    )}
                    <div className="ml-2 mt-2 space-y-2 border-l border-line pl-4 sm:ml-4">
                      {reg.programs.map((prog) => (
                        <div key={prog.id}>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-body text-sm text-ink">{prog.name}</p>
                            <Link to="/admin/academic/semesters" className={`${addLinkClass} ml-auto`}>
                              + Add Semester
                            </Link>
                          </div>
                          {prog.semesters.length === 0 && (
                            <p className="mt-1 text-sm text-inkmuted">No semesters yet.</p>
                          )}
                          <div className="ml-2 mt-2 space-y-2 border-l border-line pl-4 sm:ml-4">
                            {prog.semesters.map((sem) => {
                              const key = `sem-${sem.id}`;
                              const isOpen = !!expanded[key];
                              return (
                                <div key={sem.id}>
                                  <button
                                    onClick={() => toggle(key)}
                                    className="flex w-full items-center gap-2 text-left text-sm font-medium text-ink hover:text-copper-dark"
                                  >
                                    <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                                    Semester {sem.number}
                                    <span className="font-mono text-xs font-normal text-inkmuted">
                                      ({sem.sections.length} section{sem.sections.length === 1 ? "" : "s"},{" "}
                                      {sem.subjects.length} subject{sem.subjects.length === 1 ? "" : "s"})
                                    </span>
                                  </button>

                                  {isOpen && (
                                    <div className="ml-2 mt-2 grid gap-4 border-l border-line pl-4 sm:ml-4 sm:grid-cols-2">
                                      <div>
                                        <div className="flex items-center gap-2">
                                          <p className="font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">
                                            Sections
                                          </p>
                                          <Link to="/admin/academic/sections" className={`${addLinkClass} ml-auto`}>
                                            + Add
                                          </Link>
                                        </div>
                                        {sem.sections.length === 0 ? (
                                          <p className="mt-1 text-sm text-inkmuted">No sections yet.</p>
                                        ) : (
                                          <div className="mt-1 flex flex-wrap gap-1.5">
                                            {sem.sections.map((sec) => (
                                              <span
                                                key={sec.id}
                                                className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-medium text-ink"
                                              >
                                                {sec.name}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>

                                      <div>
                                        <div className="flex items-center gap-2">
                                          <p className="font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">
                                            Subjects
                                          </p>
                                          <Link to="/admin/academic/subjects" className={`${addLinkClass} ml-auto`}>
                                            + Add
                                          </Link>
                                        </div>
                                        {sem.subjects.length === 0 ? (
                                          <p className="mt-1 text-sm text-inkmuted">No subjects yet.</p>
                                        ) : (
                                          <ul className="mt-1 space-y-1">
                                            {sem.subjects.map((sub) => (
                                              <li key={sub.id} className="text-sm text-ink">
                                                {sub.name}
                                                {sub.code && (
                                                  <span className="ml-1.5 font-mono text-xs text-inkmuted">
                                                    {sub.code}
                                                  </span>
                                                )}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                        {sem.subjects.length > 0 && (
                                          <Link
                                            to="/admin/academic/units"
                                            className="mt-2 inline-block text-xs font-medium text-copper-dark hover:underline"
                                          >
                                            Manage Units / Topics →
                                          </Link>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
