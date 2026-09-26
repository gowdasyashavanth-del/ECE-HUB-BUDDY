import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Bar, Card, Empty, StatCard } from "../../components/analytics/analyticsUi";
import { fmtPct, getPairStats, getRoster, type PairStats, type RosterRow } from "../../lib/analytics";

type Attention = "all" | "no_attempts" | "no_content" | "inactive";
const INACTIVE_DAYS = 14;
const ROSTER_LIMIT = 300;
const selectCls = "rounded-md border border-line bg-panel px-2.5 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper";

const pairKey = (p: { section_id: string; subject_id: string }) => `${p.subject_id}|${p.section_id}`;
const isInactive = (r: RosterRow) => !r.last_activity || Date.now() - new Date(r.last_activity).getTime() > INACTIVE_DAYS * 86_400_000;
const contentPct = (r: RosterRow) => (r.content_total > 0 ? (r.content_done / r.content_total) * 100 : null);

function weighted(rows: { v: number | null; w: number }[]): number | null {
  const used = rows.filter((r) => r.v !== null && r.w > 0);
  const w = used.reduce((a, r) => a + r.w, 0);
  return w > 0 ? used.reduce((a, r) => a + (r.v as number) * r.w, 0) / w : null;
}

export function TeacherAnalyticsPage() {
  const [pairs, setPairs] = useState<PairStats[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [selected, setSelected] = useState(""); // "" = all my subject+section pairs
  const [search, setSearch] = useState("");
  const [attention, setAttention] = useState<Attention>("all");
  const [loadingPairs, setLoadingPairs] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // Subject+section pairs the database says this teacher may analyse.
  useEffect(() => {
    let cancelled = false;
    setLoadingPairs(true);
    getPairStats(null, null).then((r) => {
      if (cancelled) return;
      setLoadingPairs(false);
      setError(r.error);
      setPairs(r.data);
    });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const activePair = useMemo(() => pairs.find((p) => pairKey(p) === selected) ?? null, [pairs, selected]);

  // Roster: the picked pair is sent as a FILTER only; the database still
  // limits everything to the teacher's own assignments.
  useEffect(() => {
    let cancelled = false;
    setLoadingRoster(true);
    getRoster(activePair?.section_id ?? null, activePair?.subject_id ?? null, ROSTER_LIMIT).then((r) => {
      if (cancelled) return;
      setLoadingRoster(false);
      setRosterError(r.error);
      setRoster(r.data);
    });
    return () => { cancelled = true; };
  }, [activePair, reloadKey]);

  const shownPairs = activePair ? [activePair] : pairs;
  const totals = useMemo(() => ({
    students: shownPairs.reduce((a, p) => a + p.students, 0),
    attempts: shownPairs.reduce((a, p) => a + p.total_attempts, 0),
    avgScore: weighted(shownPairs.map((p) => ({ v: p.avg_score_pct, w: p.students_with_attempts }))),
    content: weighted(shownPairs.map((p) => ({ v: p.avg_content_pct, w: p.students }))),
    noAttempts: shownPairs.reduce((a, p) => a + (p.tests_available > 0 ? p.students_no_attempts : 0), 0),
    zeroContent: shownPairs.reduce((a, p) => a + (p.content_total > 0 ? p.students_zero_content : 0), 0),
    inactive: shownPairs.reduce((a, p) => a + p.students_inactive_14d, 0),
  }), [shownPairs]);

  const visibleRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roster.filter((r) => {
      if (q && !`${r.full_name} ${r.usn ?? ""}`.toLowerCase().includes(q)) return false;
      if (attention === "no_attempts") return r.tests_available > 0 && r.tests_attempted === 0;
      if (attention === "no_content") return r.content_total > 0 && r.content_done === 0;
      if (attention === "inactive") return isInactive(r);
      return true;
    });
  }, [roster, search, attention]);

  if (loadingPairs) return <LoadingState label="Loading analytics…" />;
  if (error) return <ErrorState message={error} onRetry={retry} />;

  if (pairs.length === 0) {
    return (
      <div>
        <PageHeader title="Teacher Analytics" subtitle="Performance for the subjects and sections you teach." />
        <Empty>No analytics yet — you haven't been assigned a subject and section. Once an admin assigns you, your students' progress appears here.</Empty>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Teacher Analytics" subtitle="Only the subject + section combinations you are assigned to. Descriptive figures from real student activity." />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <label className="text-sm text-inkmuted" htmlFor="pair-filter">Scope</label>
        <select id="pair-filter" className={selectCls} value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">All my subjects & sections</option>
          {pairs.map((p) => <option key={pairKey(p)} value={pairKey(p)}>{p.subject_name} — Section {p.section_name}</option>)}
        </select>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Students" value={totals.students} />
        <StatCard label="Avg score" value={fmtPct(totals.avgScore, 1)} hint="latest attempt per test" />
        <StatCard label="Test attempts" value={totals.attempts} />
        <StatCard label="Content progress" value={fmtPct(totals.content, 1)} hint="avg completion of published content" />
      </div>

      <Card title="Subject performance" subtitle="One row per subject + section you teach.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="font-mono text-[11px] uppercase text-inkmuted">
              <tr><th className="py-1 pr-3">Subject</th><th className="px-2">Section</th><th className="px-2">Students</th><th className="px-2">Content progress</th><th className="px-2">Test participation</th><th className="px-2">Avg score</th></tr>
            </thead>
            <tbody>
              {shownPairs.map((p) => {
                const participation = p.students > 0 && p.tests_available > 0 ? (p.students_with_attempts / p.students) * 100 : null;
                return (
                  <tr key={pairKey(p)} className="border-t border-line align-top">
                    <td className="py-2 pr-3 text-ink">{p.subject_name}<span className="block text-xs text-inkmuted">Sem {p.semester_number}{p.subject_code ? ` · ${p.subject_code}` : ""}</span></td>
                    <td className="px-2">{p.section_name}</td>
                    <td className="px-2 font-mono">{p.students}</td>
                    <td className="w-40 px-2">
                      {p.content_total === 0 ? <span className="text-xs text-inkmuted">No published content</span> : (<><span className="font-mono text-xs">{fmtPct(p.avg_content_pct, 1)}</span><Bar pct={p.avg_content_pct} label={`${p.subject_name} content progress`} /></>)}
                    </td>
                    <td className="w-40 px-2">
                      {p.tests_available === 0 ? <span className="text-xs text-inkmuted">No published tests</span> : (<><span className="font-mono text-xs">{p.students_with_attempts}/{p.students} students</span><Bar pct={participation} tone="copper" label={`${p.subject_name} test participation`} /></>)}
                    </td>
                    <td className="px-2 font-mono">{fmtPct(p.avg_score_pct, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Attention areas" subtitle={`Descriptive counts only — not risk ratings. "Inactive" means no content completed or test taken in this subject in the last ${INACTIVE_DAYS} days.`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="No test attempts" value={totals.noAttempts} hint="students, where tests are published" />
          <StatCard label="No content completed" value={totals.zeroContent} hint="students, where content is published" />
          <StatCard label={`Inactive ${INACTIVE_DAYS} days`} value={totals.inactive} hint="students" />
        </div>
      </Card>

      <Card title="Student performance">
        <div className="mb-3 flex flex-wrap gap-2">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or USN…" aria-label="Search students" className={`${selectCls} w-full sm:w-56`} />
          <select aria-label="Attention filter" className={selectCls} value={attention} onChange={(e) => setAttention(e.target.value as Attention)}>
            <option value="all">All students</option>
            <option value="no_attempts">No test attempts</option>
            <option value="no_content">No content completed</option>
            <option value="inactive">{`Inactive ${INACTIVE_DAYS} days`}</option>
          </select>
        </div>
        {loadingRoster ? <LoadingState label="Loading students…" /> : rosterError ? <ErrorState message={rosterError} onRetry={retry} /> : visibleRoster.length === 0 ? (
          <Empty>{roster.length === 0 ? "No students are assigned to your sections yet." : "No students match these filters."}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="font-mono text-[11px] uppercase text-inkmuted">
                <tr><th className="py-1 pr-3">Student</th><th className="px-2">USN</th><th className="px-2">Subject</th><th className="px-2">Sec</th><th className="px-2">Content</th><th className="px-2">Tests</th><th className="px-2">Avg score</th><th className="px-2">Last activity</th></tr>
              </thead>
              <tbody>
                {visibleRoster.map((r) => (
                  <tr key={`${r.student_id}-${r.subject_id}`} className="border-t border-line">
                    <td className="py-1.5 pr-3 text-ink">{r.full_name}</td>
                    <td className="px-2 font-mono text-xs">{r.usn ?? "—"}</td>
                    <td className="px-2">{r.subject_name}</td>
                    <td className="px-2">{r.section_name}</td>
                    <td className="px-2 font-mono">{r.content_total === 0 ? "—" : `${fmtPct(contentPct(r))} (${r.content_done}/${r.content_total})`}</td>
                    <td className="px-2 font-mono">{r.tests_available === 0 ? "—" : `${r.tests_attempted}/${r.tests_available}`}</td>
                    <td className="px-2 font-mono">{fmtPct(r.avg_latest_pct, 1)}</td>
                    <td className="px-2 text-xs text-inkmuted">{r.last_activity ? new Date(r.last_activity).toLocaleDateString() : "No activity"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {roster.length >= ROSTER_LIMIT && <p className="mt-2 text-xs text-inkmuted">Showing the first {ROSTER_LIMIT} rows — pick a subject + section to narrow.</p>}
      </Card>
    </div>
  );
}
