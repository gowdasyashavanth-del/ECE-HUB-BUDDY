import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Bar, BarRow, Card, Empty, MiniBars, StatCard } from "../../components/analytics/analyticsUi";
import { EventRow } from "../../components/planner/plannerUi";
import { studyUrl } from "../../lib/study";
import { fetchNotOver } from "../../lib/plannerQueries";
import {
  getStudentSubjects, getStudentSummary, getStudentTests, fmtPct, ratioPct,
  type StudentSubjectRow, type StudentSummary, type StudentTestRow,
} from "../../lib/analytics";
import {
  EVENT_TYPE_META, addDays, deriveStatus, fmtShortDate, normalizeEvent, sortByAnchor, startOfLocalDay,
  type PlannerEvent,
} from "../../lib/planner";

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

interface RecentResult { id: string; score: number; total: number; created_at: string; title: string | null }
interface Unlock { unlocked_at: string; name: string; icon: string | null; xp_reward: number }
interface Activity { at: string; text: string; kind: "content" | "test" | "achievement" }

const DEADLINE_TYPES = (Object.keys(EVENT_TYPE_META) as (keyof typeof EVENT_TYPE_META)[]).filter((t) => EVENT_TYPE_META[t].kind === "deadline");
const dt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const pctOf = (score: number, total: number) => (total > 0 ? (score / total) * 100 : 0);

export function StudentAnalyticsPage() {
  const { profile } = useAuth();
  const [summary, setSummary] = useState<StudentSummary | null>(null);
  const [subjects, setSubjects] = useState<StudentSubjectRow[]>([]);
  const [tests, setTests] = useState<StudentTestRow[]>([]);
  const [recent, setRecent] = useState<RecentResult[]>([]);
  const [unlocks, setUnlocks] = useState<Unlock[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [upcoming, setUpcoming] = useState<PlannerEvent[]>([]);
  const [overdue, setOverdue] = useState<PlannerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sideErrors, setSideErrors] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [now] = useState(() => new Date());

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!supabase || !profile) return;
    const client = supabase;
    const uid = profile.id;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const today = startOfLocalDay(new Date());
      const [sum, subs, tst, res, ach, cmp, notOver, over] = await Promise.all([
        getStudentSummary(),
        getStudentSubjects(),
        getStudentTests(50),
        client.from("results").select("id, score, total, created_at, tests(title)").eq("student_id", uid).order("created_at", { ascending: false }).limit(10),
        client.from("student_achievements").select("unlocked_at, achievements(name, icon, xp_reward)").eq("student_id", uid).order("unlocked_at", { ascending: false }).limit(6),
        client.from("content_completions").select("completed_at, content(title)").eq("student_id", uid).order("completed_at", { ascending: false }).limit(5),
        fetchNotOver(today, new Date(), 12),
        client.from("planner_events").select("id, title, description, event_type, priority, target_scope, academic_year_id, regulation_id, program_id, semester_id, section_id, subject_id, unit_id, topic_id, test_id, start_at, end_at, due_at, all_day, anchor_at, created_by, subjects(id, name, code), sections(id, name)")
          .in("event_type", DEADLINE_TYPES).lt("due_at", new Date().toISOString()).gte("due_at", addDays(new Date(), -30).toISOString())
          .order("due_at", { ascending: false }).limit(10),
      ]);
      if (cancelled) return;

      if (sum.error) { setError(sum.error); setLoading(false); return; }
      const side: string[] = [];
      if (subs.error) side.push(subs.error);
      if (tst.error) side.push(tst.error);
      if (res.error) side.push("We couldn't load your recent results.");
      if (notOver.error || over.error) side.push("We couldn't load your planner events.");
      setSideErrors(side);

      setSummary(sum.data);
      setSubjects(subs.data);
      setTests(tst.data);

      const results: RecentResult[] = (res.data ?? []).map((r: any) => ({
        id: r.id, score: r.score, total: r.total, created_at: r.created_at, title: first<{ title: string }>(r.tests)?.title ?? null,
      }));
      setRecent(results);
      const unlockRows: Unlock[] = (ach.data ?? []).map((a: any) => {
        const d = first<{ name: string; icon: string | null; xp_reward: number }>(a.achievements);
        return { unlocked_at: a.unlocked_at, name: d?.name ?? "Achievement", icon: d?.icon ?? null, xp_reward: d?.xp_reward ?? 0 };
      });
      setUnlocks(unlockRows);

      const acts: Activity[] = [
        ...(cmp.data ?? []).map((c: any) => ({ at: c.completed_at as string, kind: "content" as const, text: `Completed “${first<{ title: string }>(c.content)?.title ?? "content"}”` })),
        ...results.map((r) => ({ at: r.created_at, kind: "test" as const, text: `Attempted ${r.title ?? "a test"} — ${r.score}/${r.total}` })),
        ...unlockRows.map((u) => ({ at: u.unlocked_at, kind: "achievement" as const, text: `Unlocked “${u.name}”` })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 8);
      setActivity(acts);

      const n = new Date();
      setUpcoming(notOver.events.filter((e) => { const s = deriveStatus(e, n); return s !== "overdue" && s !== "completed"; }).sort(sortByAnchor).slice(0, 5));
      setOverdue((over.data ?? []).map(normalizeEvent));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [profile, reloadKey]);

  if (loading) return <LoadingState label="Loading your analytics…" />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!summary) return <EmptyBlock />;

  const noSubjects = summary.subjects_count === 0;
  const trend = [...recent].reverse().map((r) => ({ label: r.title ?? "Test", value: pctOf(r.score, r.total) }));

  return (
    <div>
      <PageHeader title="Academic Analytics" subtitle="Your own progress, results and upcoming work — computed from your real activity." />

      {sideErrors.length > 0 && (
        <p className="mb-4 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
          Some sections couldn't be loaded: {sideErrors.join(" ")} <button className="underline" onClick={retry}>Retry</button>
        </p>
      )}

      {noSubjects && <Empty>You aren't assigned to a semester yet, so there are no subjects to show. An admin assigns this.</Empty>}

      {!noSubjects && (
        <>
          <Card title="Overall progress" subtitle="Average of your topic progress across all subjects this semester (same calculation as your dashboard).">
            <div className="flex items-end justify-between gap-3">
              <p className="font-display text-4xl font-semibold text-ink">{summary.overall_progress_pct}%</p>
              <p className="text-sm text-inkmuted">
                {summary.content_completed} of {summary.content_total} published content item{summary.content_total === 1 ? "" : "s"} completed
              </p>
            </div>
            <div className="mt-2"><Bar pct={summary.overall_progress_pct} label="Overall progress" /></div>
            {summary.content_completed === 0 && <p className="mt-2 text-sm text-inkmuted">No completed content yet.</p>}
          </Card>

          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="XP" value={summary.xp ?? 0} />
            <StatCard label="Streak" value={`${summary.streak ?? 0} day${(summary.streak ?? 0) === 1 ? "" : "s"}`} />
            <StatCard label="Tests attempted" value={`${summary.tests_available_attempted} / ${summary.tests_available}`} hint="of tests currently available" />
            <StatCard label="Achievements" value={summary.achievements_count} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0">
              <Card title="Subject progress">
                {subjects.length === 0 ? <Empty>No subjects to show.</Empty> : subjects.map((s) => (
                  <div key={s.subject_id} className="mb-4 last:mb-0">
                    <BarRow label={s.subject_name} pct={s.progress_pct} right={`${s.progress_pct}%`} />
                    <p className="mt-1 text-xs text-inkmuted">
                      {s.content_completed}/{s.content_total} content completed · {s.tests_attempted}/{s.tests_available} tests attempted
                      {s.avg_latest_pct !== null && ` · avg ${fmtPct(s.avg_latest_pct)}`}
                      {" · "}<Link to={studyUrl({ subject: s.subject_id })} className="font-medium text-copper-dark hover:underline">Study →</Link>
                    </p>
                  </div>
                ))}
              </Card>

              <Card title="Test performance" subtitle="Each submission is an attempt. Averages use the LATEST attempt per test (first-attempt average shown separately).">
                {summary.tests_attempted === 0 ? <Empty>No test attempts yet.</Empty> : (
                  <>
                    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <StatCard label="Tests attempted" value={summary.tests_attempted} />
                      <StatCard label="Total attempts" value={summary.total_attempts} />
                      <StatCard label="Best score" value={fmtPct(summary.best_pct)} />
                      <StatCard label="Avg (latest)" value={fmtPct(summary.avg_latest_pct, 1)} />
                      <StatCard label="Avg (first)" value={fmtPct(summary.avg_first_pct, 1)} />
                      <StatCard label="Participation" value={fmtPct(ratioPct(summary.tests_available_attempted, summary.tests_available))} hint={`${summary.tests_available_attempted} of ${summary.tests_available} available`} />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="font-mono text-[11px] uppercase text-inkmuted">
                          <tr><th className="py-1 pr-3">Test</th><th className="px-2">Tries</th><th className="px-2">First</th><th className="px-2">Latest</th><th className="px-2">Best</th></tr>
                        </thead>
                        <tbody>
                          {tests.map((t) => (
                            <tr key={t.test_id} className="border-t border-line">
                              <td className="py-1.5 pr-3">
                                <span className="block text-ink">{t.test_title}</span>
                                <span className="text-xs text-inkmuted">{t.subject_name ?? "—"} · last {dt(t.latest_at)}</span>
                              </td>
                              <td className="px-2 font-mono">{t.attempts}</td>
                              <td className="px-2 font-mono">{fmtPct(t.first_pct)}</td>
                              <td className="px-2 font-mono">{fmtPct(t.latest_pct)}</td>
                              <td className="px-2 font-mono">{fmtPct(t.best_pct)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </Card>
            </div>

            <div className="min-w-0">
              <Card title="Recent results">
                {recent.length === 0 ? <Empty>No test attempts yet.</Empty> : (
                  <>
                    <div className="mb-4"><MiniBars points={trend} /></div>
                    <ul className="divide-y divide-line">
                      {recent.slice(0, 6).map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <span className="min-w-0"><span className="block truncate text-ink">{r.title ?? "Test no longer available"}</span><span className="text-xs text-inkmuted">{dt(r.created_at)}</span></span>
                          <span className="shrink-0 text-right font-mono text-xs text-ink">{r.score} / {r.total}<br /><span className="text-inkmuted">{Math.round(pctOf(r.score, r.total))}%</span></span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Card>

              <Card title="Upcoming" subtitle="From your planner.">
                {upcoming.length === 0 ? <Empty>No upcoming academic events.</Empty> : (
                  <div className="space-y-2">{upcoming.map((e) => <EventRow key={e.id} ev={e} now={now} onSelect={() => undefined} />)}</div>
                )}
                <p className="mt-3 text-right text-xs"><Link to="/student/planner" className="font-medium text-copper-dark hover:underline">Open Planner →</Link></p>
              </Card>

              <Card title="Overdue" subtitle="Deadlines from the last 30 days that have passed. The planner doesn't track submissions, so this only means the due time has gone by.">
                {overdue.length === 0 ? <Empty>No overdue deadlines.</Empty> : (
                  <ul className="divide-y divide-line">
                    {overdue.map((e) => (
                      <li key={e.id} className="py-2 text-sm"><span className="text-ink">{e.title}</span><span className="block text-xs text-inkmuted">{EVENT_TYPE_META[e.event_type].label}{e.subjects ? ` · ${e.subjects.name}` : ""} · due {fmtShortDate(new Date(e.anchor_at))}</span></li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Recent academic activity">
                {activity.length === 0 ? <Empty>No recent activity yet.</Empty> : (
                  <ul className="divide-y divide-line">
                    {activity.map((a, i) => (
                      <li key={`${a.kind}-${a.at}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0 truncate text-ink">{a.text}</span><span className="shrink-0 text-xs text-inkmuted">{dt(a.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {unlocks.length > 0 && <p className="mt-3 text-xs text-inkmuted">Achievements: {unlocks.map((u) => `${u.icon ?? "🏅"} ${u.name}`).join(" · ")}</p>}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyBlock() {
  return <div><PageHeader title="Academic Analytics" /><Empty>No analytics available for this account.</Empty></div>;
}
