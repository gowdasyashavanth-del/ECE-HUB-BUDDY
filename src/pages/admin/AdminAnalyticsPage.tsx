import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Bar, BarRow, Card, Empty, StatCard } from "../../components/analytics/analyticsUi";
import type { Hierarchy } from "../../components/planner/EventForm";
import {
  NO_FILTERS, fmtPct, getAdminOverview, getPairStats, ratioPct,
  type AdminFilters, type AdminOverview, type PairStats,
} from "../../lib/analytics";
import { EVENT_TYPE_META, type PlannerEventType } from "../../lib/planner";

const selectCls = "rounded-md border border-line bg-panel px-2.5 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper";
const PAIR_ROW_LIMIT = 100;

const typeLabel = (t: string) => EVENT_TYPE_META[t as PlannerEventType]?.label ?? t;

export function AdminAnalyticsPage() {
  const [h, setH] = useState<Hierarchy | null>(null);
  const [filters, setFilters] = useState<AdminFilters>(NO_FILTERS);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [pairs, setPairs] = useState<PairStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // The existing academic hierarchy, only to populate the filter lists.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    Promise.all([
      supabase.from("academic_years").select("id, name").order("name"),
      supabase.from("regulations").select("id, academic_year_id, name").order("name"),
      supabase.from("programs").select("id, regulation_id, name").order("name"),
      supabase.from("semesters").select("id, program_id, number").order("number"),
      supabase.from("sections").select("id, name, semester_id, academic_year_id").order("name"),
      supabase.from("subjects").select("id, name, code, semester_id").order("order_number"),
    ]).then(([y, r, p, sem, sec, sub]) => {
      if (cancelled || [y, r, p, sem, sec, sub].some((x) => x.error)) return;
      setH({
        years: (y.data ?? []) as Hierarchy["years"], regs: (r.data ?? []) as Hierarchy["regs"],
        programs: (p.data ?? []) as Hierarchy["programs"], semesters: (sem.data ?? []) as Hierarchy["semesters"],
        sections: (sec.data ?? []) as Hierarchy["sections"], subjects: (sub.data ?? []) as Hierarchy["subjects"],
      });
    });
    return () => { cancelled = true; };
  }, []);

  // Filters are sent to the database as NARROWING arguments; the function
  // itself refuses anyone who isn't a super admin.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAdminOverview(filters).then((r) => {
      if (cancelled) return;
      setLoading(false);
      setError(r.error ?? (r.data ? null : "Analytics are only available to super admins."));
      setOverview(r.data);
    });
    return () => { cancelled = true; };
  }, [filters, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    getPairStats(filters.section, filters.subject).then((r) => {
      if (cancelled) return;
      setPairError(r.error);
      setPairs(r.data);
    });
    return () => { cancelled = true; };
  }, [filters.section, filters.subject, reloadKey]);

  const set = (patch: Partial<AdminFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const regOptions = h ? h.regs.filter((r) => !filters.year || r.academic_year_id === filters.year) : [];
  const progOptions = h ? h.programs.filter((p) => !filters.regulation || p.regulation_id === filters.regulation) : [];
  const semOptions = h ? h.semesters.filter((s) => !filters.program || s.program_id === filters.program) : [];
  const secOptions = h ? h.sections.filter((s) => !filters.semester || s.semester_id === filters.semester) : [];
  const subjOptions = h ? h.subjects.filter((s) => !filters.semester || s.semester_id === filters.semester) : [];

  // Section×subject rows narrowed by the higher hierarchy filters.
  const visiblePairs = useMemo(() => {
    if (!h) return pairs;
    const semIds = new Set(semOptions.map((s) => s.id));
    return pairs.filter((p) => {
      const sec = h.sections.find((s) => s.id === p.section_id);
      if (!sec) return false;
      if (filters.semester && sec.semester_id !== filters.semester) return false;
      if (!filters.semester && (filters.program || filters.regulation || filters.year) && !semIds.has(sec.semester_id)) return false;
      if (filters.year && sec.academic_year_id !== filters.year) return false;
      return true;
    });
  }, [pairs, h, filters, semOptions]);

  const o = overview;
  return (
    <div>
      <PageHeader title="Academic Command Center" subtitle="Aggregates across the whole ECE academic dataset. Filters only narrow the view." />

      <div className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <select aria-label="Academic year" className={selectCls} value={filters.year ?? ""} onChange={(e) => set({ year: e.target.value || null, regulation: null, program: null, semester: null, section: null, subject: null })}>
          <option value="">All years</option>{h?.years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
        <select aria-label="Regulation" className={selectCls} value={filters.regulation ?? ""} onChange={(e) => set({ regulation: e.target.value || null, program: null, semester: null, section: null, subject: null })}>
          <option value="">All regulations</option>{regOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select aria-label="Program" className={selectCls} value={filters.program ?? ""} onChange={(e) => set({ program: e.target.value || null, semester: null, section: null, subject: null })}>
          <option value="">All programs</option>{progOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select aria-label="Semester" className={selectCls} value={filters.semester ?? ""} onChange={(e) => set({ semester: e.target.value || null, section: null, subject: null })}>
          <option value="">All semesters</option>{semOptions.map((s) => <option key={s.id} value={s.id}>Semester {s.number}</option>)}
        </select>
        <select aria-label="Section" className={selectCls} value={filters.section ?? ""} onChange={(e) => set({ section: e.target.value || null })}>
          <option value="">All sections</option>{secOptions.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
        </select>
        <select aria-label="Subject" className={selectCls} value={filters.subject ?? ""} onChange={(e) => set({ subject: e.target.value || null })}>
          <option value="">All subjects</option>{subjOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {Object.values(filters).some(Boolean) && (
          <button onClick={() => setFilters(NO_FILTERS)} className="text-sm font-medium text-copper-dark underline-offset-2 hover:underline">Clear filters</button>
        )}
      </div>

      {loading && !o && <LoadingState label="Loading analytics…" />}
      {error && <ErrorState message={error} onRetry={retry} />}

      {o && (
        <div className={loading ? "opacity-60 transition-opacity" : ""}>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Students" value={o.people.students} hint="currently assigned" />
            <StatCard label="Teachers" value={o.people.teachers} />
            <StatCard label="Subjects" value={o.structure.subjects} />
            <StatCard label="Tests" value={o.tests.total} hint={`${o.tests.published} published`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <Card title="Learning coverage" subtitle="Share of the academic structure that has real published material.">
                <BarRow label="Subjects with published content" pct={ratioPct(o.content.subjects_with_published, o.structure.subjects)} right={`${o.content.subjects_with_published} / ${o.structure.subjects}`} />
                <BarRow label="Topics with published content" pct={ratioPct(o.content.topics_with_published, o.structure.topics)} right={`${o.content.topics_with_published} / ${o.structure.topics}`} />
                <BarRow label="Section+subject pairs with notes" pct={ratioPct(o.notes.pairs_with_notes, o.notes.section_subject_pairs)} right={`${o.notes.pairs_with_notes} / ${o.notes.section_subject_pairs}`} />
                <BarRow label="Subjects with formulas" pct={ratioPct(o.formulas.subjects_with_formulas, o.structure.subjects)} right={`${o.formulas.subjects_with_formulas} / ${o.structure.subjects}`} />
                <BarRow label="Content completed by students" pct={ratioPct(o.content.completion_records, o.content.completions_possible)} right={`${o.content.completion_records} / ${o.content.completions_possible}`} tone="copper" />
                <p className="mt-3 text-xs text-inkmuted">
                  Content: {o.content.published} published of {o.content.total} · Notes: {o.notes.total} · Formulas: {o.formulas.total} · Tests: {o.tests.published} published of {o.tests.total}
                </p>
              </Card>

              <Card title="Assessment performance" subtitle="An attempt is one scored submission. Average uses each student's latest attempt per test.">
                {o.tests.attempts === 0 ? <Empty>No test attempts yet.</Empty> : (
                  <div className="grid grid-cols-2 gap-3">
                    <StatCard label="Attempts" value={o.tests.attempts} />
                    <StatCard label="Tests attempted" value={`${o.tests.tests_with_attempts} / ${o.tests.total}`} />
                    <StatCard label="Participation" value={fmtPct(ratioPct(o.tests.students_attempted, o.people.students))} hint={`${o.tests.students_attempted} of ${o.people.students} students`} />
                    <StatCard label="Avg score" value={fmtPct(o.tests.avg_latest_pct, 1)} />
                  </div>
                )}
              </Card>
            </div>

            <div>
              <Card title="Academic structure">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                  {([
                    ["Academic years", o.structure.academic_years], ["Regulations", `${o.structure.regulations} (${o.structure.regulations_active} active)`],
                    ["Programs", `${o.structure.programs} (${o.structure.programs_active} active)`], ["Semesters", o.structure.semesters],
                    ["Sections", o.structure.sections], ["Subjects", o.structure.subjects], ["Units", o.structure.units], ["Topics", o.structure.topics],
                  ] as [string, string | number][]).map(([k, v]) => (
                    <div key={k}><dt className="text-xs text-inkmuted">{k}</dt><dd className="font-mono text-ink">{v}</dd></div>
                  ))}
                </dl>
              </Card>

              <Card title="Activity" subtitle="Planner events follow the filters; announcements are counted across the whole platform.">
                <div className="mb-3 grid grid-cols-3 gap-3">
                  <StatCard label="Planner events" value={o.planner.total} />
                  <StatCard label="Upcoming" value={o.planner.upcoming} />
                  <StatCard label="Next 30 days" value={o.planner.next_30_days} />
                </div>
                {Object.keys(o.planner.by_type).length === 0 ? <Empty>No planner events{Object.values(filters).some(Boolean) ? " in this scope" : ""}.</Empty> : (
                  <p className="mb-4 text-xs text-inkmuted">{Object.entries(o.planner.by_type).map(([t, n]) => `${typeLabel(t)}: ${n}`).join(" · ")}</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Announcements" value={o.announcements.total} />
                  <StatCard label="Last 30 days" value={o.announcements.last_30_days} />
                </div>
                {Object.keys(o.announcements.by_scope).length > 0 && (
                  <p className="mt-2 text-xs text-inkmuted">{Object.entries(o.announcements.by_scope).map(([t, n]) => `${t}: ${n}`).join(" · ")}</p>
                )}
              </Card>
            </div>
          </div>

          <Card title="Section × subject performance" subtitle="Per section and subject: students, content progress, test participation and average score.">
            {pairError ? <ErrorState message={pairError} onRetry={retry} /> : visiblePairs.length === 0 ? <Empty>No section and subject combinations in this scope.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="font-mono text-[11px] uppercase text-inkmuted">
                    <tr><th className="py-1 pr-3">Subject</th><th className="px-2">Sem</th><th className="px-2">Sec</th><th className="px-2">Students</th><th className="px-2">Content</th><th className="px-2">Participation</th><th className="px-2">Avg score</th></tr>
                  </thead>
                  <tbody>
                    {visiblePairs.slice(0, PAIR_ROW_LIMIT).map((p) => (
                      <tr key={`${p.section_id}-${p.subject_id}`} className="border-t border-line">
                        <td className="py-1.5 pr-3 text-ink">{p.subject_name}</td>
                        <td className="px-2">{p.semester_number}</td>
                        <td className="px-2">{p.section_name}</td>
                        <td className="px-2 font-mono">{p.students}</td>
                        <td className="w-32 px-2">{p.content_total === 0 ? <span className="text-xs text-inkmuted">No content</span> : <><span className="font-mono text-xs">{fmtPct(p.avg_content_pct, 1)}</span><Bar pct={p.avg_content_pct} label="Content progress" /></>}</td>
                        <td className="px-2 font-mono">{p.tests_available === 0 ? <span className="text-xs text-inkmuted">No tests</span> : `${p.students_with_attempts}/${p.students}`}</td>
                        <td className="px-2 font-mono">{fmtPct(p.avg_score_pct, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visiblePairs.length > PAIR_ROW_LIMIT && <p className="mt-2 text-xs text-inkmuted">Showing the first {PAIR_ROW_LIMIT} of {visiblePairs.length} — filter by semester or section to narrow.</p>}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
