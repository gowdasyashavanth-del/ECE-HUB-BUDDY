import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { LoadingState } from "../ui/LoadingState";
import { ErrorState } from "../ui/ErrorState";
import { getTopicContext, safeExternalUrl, studyUrl, type StudyFocus, type TopicContext } from "../../lib/study";
import { NotFound, ProgressBar, SectionCard } from "./StudyParts";

const BUCKET = "content-files"; // the existing private bucket — signed URLs only

interface ContentRow { id: string; title: string; type: string; file_url: string | null; external_url: string | null }
interface NoteRow { id: string; title: string; file_path: string; file_size_bytes: number | null }
interface FormulaRow { id: string; name: string; expression: string; description: string | null; example: string | null }
interface TestRow { id: string; title: string; duration_min: number }
interface Attempts { attempts: number; bestPct: number }

type ItemState = "done" | "todo" | "info" | "none";
const ICON: Record<ItemState, string> = { done: "✓", todo: "○", info: "•", none: "–" };
const STATE_WORD: Record<ItemState, string> = { done: "Done", todo: "To do", info: "Available (not tracked)", none: "Nothing yet" };

const kb = (n: number | null) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : null);

export function StudyWorkspace({ topicId, focus }: { topicId: string; focus: StudyFocus | null }) {
  const { profile } = useAuth();
  const [ctx, setCtx] = useState<TopicContext | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<ContentRow[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [formulas, setFormulas] = useState<FormulaRow[]>([]);
  const [generalFormulas, setGeneralFormulas] = useState<FormulaRow[]>([]);
  const [topicTests, setTopicTests] = useState<TestRow[]>([]);
  const [subjectTests, setSubjectTests] = useState<TestRow[]>([]);
  const [attempts, setAttempts] = useState<Map<string, Attempts>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  // Errors are shown inside the section where the action happened, so a
  // failed tap far down the page is never reported off-screen at the top.
  const [actionError, setActionErrorRaw] = useState<{ section: StudyFocus; message: string } | null>(null);
  const setActionError = useCallback((section: StudyFocus | null, message?: string) => setActionErrorRaw(section && message ? { section, message } : null), []);
  // The topic currently on screen — async work that finishes after the
  // student has moved on must never write into the new topic's view.
  const topicRef = useRef(topicId);
  topicRef.current = topicId;
  const [key, setKey] = useState(0);
  const retry = useCallback(() => setKey((k) => k + 1), []);

  useEffect(() => {
    if (!supabase || !profile) return;
    const client = supabase;
    const uid = profile.id;
    let cancelled = false;
    setStatus("loading"); setError(null); setActionError(null);

    (async () => {
      // 1. The database decides whether this topic exists FOR THIS STUDENT.
      const c = await getTopicContext(topicId);
      if (cancelled) return;
      if (c.error) { setError(c.error); setStatus("error"); return; }
      if (!c.data) { setStatus("notfound"); return; }
      const context = c.data;

      // 2. Resources — every query runs under the existing RLS.
      const [con, nts, fTopic, fGen, tTopic, tSubj] = await Promise.all([
        client.from("content").select("id, title, type, file_url, external_url").eq("topic_id", topicId).order("created_at"),
        client.from("notes").select("id, title, file_path, file_size_bytes").eq("topic_id", topicId).order("created_at"),
        client.from("formulas").select("id, name, expression, description, example").eq("topic_id", topicId).order("name"),
        client.from("formulas").select("id, name, expression, description, example").eq("subject_id", context.subject_id).is("topic_id", null).order("name"),
        client.from("tests").select("id, title, duration_min").eq("topic_id", topicId).order("created_at"),
        client.from("tests").select("id, title, duration_min").eq("subject_id", context.subject_id).order("created_at"),
      ]);
      if (cancelled) return;
      const firstErr = [con, nts, fTopic, fGen, tTopic, tSubj].find((r) => r.error)?.error;
      if (firstErr) { setError(friendlyDbError(firstErr, "this topic's resources")); setStatus("error"); return; }

      const contentRows = (con.data ?? []) as ContentRow[];
      const testRows = [...((tTopic.data ?? []) as TestRow[]), ...((tSubj.data ?? []) as TestRow[])];
      const [comp, res] = await Promise.all([
        contentRows.length
          ? client.from("content_completions").select("content_id").in("content_id", contentRows.map((r) => r.id))
          : Promise.resolve({ data: [], error: null }),
        testRows.length
          ? client.from("results").select("test_id, score, total").eq("student_id", uid).in("test_id", testRows.map((t) => t.id))
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (cancelled) return;

      const agg = new Map<string, Attempts>();
      for (const r of (res.data ?? []) as { test_id: string; score: number; total: number }[]) {
        const pct = r.total > 0 ? (r.score / r.total) * 100 : 0;
        const cur = agg.get(r.test_id);
        agg.set(r.test_id, { attempts: (cur?.attempts ?? 0) + 1, bestPct: Math.max(cur?.bestPct ?? 0, pct) });
      }

      setCtx(context);
      setContent(contentRows);
      setCompleted(new Set(((comp.data ?? []) as { content_id: string }[]).map((r) => r.content_id)));
      setNotes((nts.data ?? []) as NoteRow[]);
      setFormulas((fTopic.data ?? []) as FormulaRow[]);
      setGeneralFormulas((fGen.data ?? []) as FormulaRow[]);
      setTopicTests((tTopic.data ?? []) as TestRow[]);
      setSubjectTests((tSubj.data ?? []) as TestRow[]);
      setAttempts(agg);
      setStatus("ready");
    })();
    return () => { cancelled = true; };
  }, [topicId, profile, key]);

  // Focus a section when arriving from Global Search.
  useEffect(() => {
    if (status !== "ready" || !focus) return;
    document.getElementById(`study-${focus}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [status, focus, topicId]);

  // The tab is opened synchronously inside the tap handler and pointed at
  // the signed URL afterwards. Mobile browsers (iOS Safari in particular)
  // block window.open() calls made after an `await`, which silently
  // swallowed the PDF on phones.
  async function openFile(path: string, id: string, section: StudyFocus) {
    if (!supabase) return;
    setActionError(null); setBusyId(id);
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    setBusyId(null);
    if (e || !data?.signedUrl) {
      tab?.close();
      setActionError(section, "Couldn't open this file. It may have been removed, or the link expired — please try again.");
      return;
    }
    if (tab) tab.location.href = data.signedUrl;
    else window.location.assign(data.signedUrl); // popup blocked: open in this tab instead of failing silently
  }

  function openContent(c: ContentRow) {
    if (c.file_url) { void openFile(c.file_url, c.id, "content"); return; }
    const url = safeExternalUrl(c.external_url);
    if (!url) { setActionError("content", "This item has no valid link."); return; }
    window.open(url, "_blank", "noreferrer");
  }

  // Completion goes through the EXISTING trusted function; progress is
  // then re-read from the server (never computed here).
  async function markComplete(contentId: string) {
    if (!supabase) return;
    setActionError(null); setBusyId(contentId);
    const { error: e } = await supabase.rpc("mark_content_complete", { p_content_id: contentId });
    if (e) { setBusyId(null); setActionError("content", friendlyDbError(e, "Marking content complete")); return; }
    const forTopic = topicId;
    if (topicRef.current === forTopic) setCompleted((prev) => new Set(prev).add(contentId));
    const fresh = await getTopicContext(forTopic);
    setBusyId(null);
    // Ignore the answer if the student has already navigated to another topic.
    if (fresh.data && topicRef.current === forTopic) setCtx(fresh.data);
  }

  // ── Checklist: only items with a real completion/attempt state are ever
  //    checked. Notes and formulas have no tracking mechanism, so they are
  //    shown as resources and never as "done". ──
  const doneCount = content.filter((c) => completed.has(c.id)).length;
  const contentState: ItemState = content.length === 0 ? "none" : doneCount === content.length ? "done" : "todo";
  const attemptedTopicTests = topicTests.filter((t) => attempts.has(t.id)).length;
  const testState: ItemState = topicTests.length === 0 ? "none" : attemptedTopicTests > 0 ? "done" : "todo";

  const checklist = useMemo(() => [
    { key: "content", label: "Read content", state: contentState, detail: content.length === 0 ? "No content for this topic yet" : `${doneCount} of ${content.length} completed` },
    { key: "notes", label: "Review notes", state: (notes.length ? "info" : "none") as ItemState, detail: notes.length ? `${notes.length} note${notes.length === 1 ? "" : "s"} available` : "No notes available yet" },
    { key: "formulas", label: "Review formulas", state: (formulas.length + generalFormulas.length ? "info" : "none") as ItemState, detail: formulas.length + generalFormulas.length ? `${formulas.length + generalFormulas.length} available` : "No formulas available yet" },
    { key: "tests", label: "Take the topic test", state: testState, detail: topicTests.length === 0 ? "No test for this topic yet" : `${attemptedTopicTests} of ${topicTests.length} attempted` },
  ], [contentState, content.length, doneCount, notes.length, formulas.length, generalFormulas.length, testState, topicTests.length, attemptedTopicTests]);

  const scrollTo = (k: string) => document.getElementById(`study-${k}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  const nextStep: { label: string; run?: () => void; to?: string } | null =
    contentState === "todo" ? { label: "Continue: read content", run: () => scrollTo("content") }
    : testState === "todo" ? { label: "Continue: take the test", run: () => scrollTo("tests") }
    : ctx?.next_topic_id ? { label: "Next topic →", to: studyUrl({ subject: ctx.subject_id, unit: ctx.next_unit_id, topic: ctx.next_topic_id }) }
    : null;

  if (status === "loading") return <LoadingState label="Loading topic…" />;
  if (status === "error") return <ErrorState message={error ?? "Something went wrong."} onRetry={retry} />;
  if (status === "notfound" || !ctx) return <NotFound what="topic" />;

  const btn = "inline-flex min-h-[44px] items-center justify-center rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper";
  const linkBtn = "inline-flex min-h-[44px] items-center rounded-md border border-line px-3 py-2 text-sm text-ink hover:border-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper";

  return (
    <div>
      <header className="mb-5">
        <p className="font-mono text-[11px] uppercase tracking-widest text-inkmuted"><span aria-hidden="true">📚</span> Study Mode</p>
        <h1 className="break-words font-display text-2xl font-semibold text-ink">{ctx.topic_name}</h1>
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-inkmuted">
          <Link to={studyUrl({ subject: ctx.subject_id })} className="inline-flex min-h-[44px] min-w-0 items-center break-words hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper">{ctx.subject_name}</Link>
          <span aria-hidden="true">•</span>
          <span className="min-w-0 break-words">{ctx.unit_name}</span>
        </div>
        <div className="mt-3 max-w-md">
          <div className="mb-1 flex items-baseline justify-between text-xs text-inkmuted">
            <span>Academic progress (content completed in this topic)</span>
            <span className="font-mono text-ink">{ctx.progress_pct}%</span>
          </div>
          <ProgressBar pct={ctx.progress_pct} label="Academic progress for this topic" />
        </div>
      </header>

      <TopicNav ctx={ctx} label="Topic navigation (top)" linkBtn={linkBtn} className="mb-4" />

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        {/* Checklist first on phones, right-hand rail on desktop */}
        <aside className="order-first lg:order-last">
          <section className="rounded-lg border border-line bg-panel p-4 lg:sticky lg:top-4" aria-labelledby="study-checklist-title">
            <h2 id="study-checklist-title" className="font-display text-base font-semibold text-ink">Study checklist</h2>
            <p className="mb-3 text-xs text-inkmuted">A guide for this session — separate from your academic progress. Only content and tests are tracked.</p>
            <ul className="space-y-2.5">
              {checklist.map((i) => (
                <li key={i.key}>
                  <button type="button" onClick={() => scrollTo(i.key)} className="flex w-full min-h-[44px] items-start gap-2.5 rounded-md px-1 text-left hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper">
                    <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${i.state === "done" ? "border-trace bg-trace-light text-trace-dark" : "border-line text-inkmuted"}`} aria-hidden="true">{ICON[i.state]}</span>
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">{i.label}</span>
                      <span className="block text-xs text-inkmuted"><span className="sr-only">{STATE_WORD[i.state]}. </span>{i.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {nextStep && (
              <div className="mt-4">
                {nextStep.to ? <Link to={nextStep.to} className={`${btn} w-full`}>{nextStep.label}</Link>
                  : <button type="button" onClick={nextStep.run} className={`${btn} w-full`}>{nextStep.label}</button>}
              </div>
            )}
          </section>
        </aside>

        <div className="min-w-0">
          <SectionCard id="study-content" icon="📚" title="Content">
            {content.length === 0 ? <p className="text-sm text-inkmuted">No content published for this topic yet.</p> : (
              <ul className="space-y-2">
                {content.map((c) => {
                  const done = completed.has(c.id);
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                      <button type="button" onClick={() => openContent(c)} disabled={busyId === c.id} className="min-h-[44px] min-w-0 flex-1 text-left text-sm text-copper-dark hover:underline disabled:opacity-60">
                        <span className="mr-1.5 font-mono text-[10px] uppercase text-inkmuted">{c.type}</span>{c.title}
                      </button>
                      {done ? (
                        <span className="text-xs font-medium text-trace-dark">✓ Completed</span>
                      ) : (
                        <button type="button" onClick={() => markComplete(c.id)} disabled={busyId === c.id} className="min-h-[44px] rounded-md border border-line px-3 text-xs text-ink hover:border-copper disabled:opacity-60">
                          {busyId === c.id ? "Saving…" : "Mark complete"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <SectionError err={actionError} section="content" />
          </SectionCard>

          <SectionCard id="study-notes" icon="📄" title="Notes">
            {notes.length === 0 ? <p className="text-sm text-inkmuted">No notes available for this topic yet.</p> : (
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => openFile(n.file_path, n.id, "notes")} disabled={busyId === n.id} className={`${linkBtn} w-full justify-between gap-2 text-left disabled:opacity-60`}>
                      <span className="min-w-0 truncate">📄 {n.title}</span>
                      <span className="shrink-0 text-xs text-inkmuted">{busyId === n.id ? "Opening…" : kb(n.file_size_bytes) ?? "PDF"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <SectionError err={actionError} section="notes" />
          </SectionCard>

          <SectionCard id="study-formulas" icon="🧮" title="Formulas">
            {formulas.length + generalFormulas.length === 0 ? <p className="text-sm text-inkmuted">No formulas available for this topic yet.</p> : (
              <>
                {formulas.length === 0 && <p className="mb-3 text-sm text-inkmuted">No formulas specific to this topic yet.</p>}
                <FormulaList rows={formulas} />
                {generalFormulas.length > 0 && (
                  <div className={formulas.length ? "mt-4" : ""}>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-inkmuted">General formulas for {ctx.subject_name}</p>
                    <FormulaList rows={generalFormulas} />
                  </div>
                )}
              </>
            )}
          </SectionCard>

          <SectionCard id="study-tests" icon="✏️" title="Practice & tests">
            <p className="mb-3 text-xs text-inkmuted">Tests use the secure test flow — your answers are marked on the server and correct answers are never sent to your browser.</p>
            {topicTests.length + subjectTests.length === 0 ? <p className="text-sm text-inkmuted">No tests available for this topic yet.</p> : (
              <>
                {topicTests.length > 0 && <TestList title="Tests for this topic" rows={topicTests} attempts={attempts} />}
                {subjectTests.length > 0 && <TestList title={`Tests for ${ctx.subject_name}`} rows={subjectTests} attempts={attempts} spaced={topicTests.length > 0} />}
              </>
            )}
          </SectionCard>

          <TopicNav ctx={ctx} label="Topic navigation" linkBtn={linkBtn} className="mt-2" />
        </div>
      </div>
    </div>
  );
}

// Previous / next topic, from the database's own ordering. Rendered once
// under the topic title and once after the content, as plain in-flow
// bars: nothing floats over the resources, and both stay reachable.
function TopicNav({ ctx, label, linkBtn, className }: { ctx: TopicContext; label: string; linkBtn: string; className?: string }) {
  if (!ctx.prev_topic_id && !ctx.next_topic_id) return null;
  return (
    <nav aria-label={label} className={`flex items-stretch justify-between gap-2 ${className ?? ""}`}>
      {ctx.prev_topic_id ? (
        <Link to={studyUrl({ subject: ctx.subject_id, unit: ctx.prev_unit_id, topic: ctx.prev_topic_id })} className={`${linkBtn} min-w-0 max-w-[48%]`}>← <span className="ml-1 min-w-0 truncate">{ctx.prev_topic_name}</span></Link>
      ) : <span />}
      {ctx.next_topic_id ? (
        <Link to={studyUrl({ subject: ctx.subject_id, unit: ctx.next_unit_id, topic: ctx.next_topic_id })} className={`${linkBtn} min-w-0 max-w-[48%] justify-end`}><span className="mr-1 min-w-0 truncate">{ctx.next_topic_name}</span> →</Link>
      ) : <span />}
    </nav>
  );
}

function SectionError({ err, section }: { err: { section: StudyFocus; message: string } | null; section: StudyFocus }) {
  if (!err || err.section !== section) return null;
  return <p className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{err.message}</p>;
}

function FormulaList({ rows }: { rows: FormulaRow[] }) {
  return (
    <ul className="space-y-2">
      {rows.map((f) => (
        <li key={f.id} className="rounded-md border border-line px-3 py-2">
          <p className="text-sm font-medium text-ink">{f.name}</p>
          <p className="mt-0.5 break-words font-mono text-sm text-ink">{f.expression}</p>
          {f.description && <p className="mt-1 text-xs text-inkmuted">{f.description}</p>}
          {f.example && <p className="mt-1 break-words text-xs text-inkmuted">Example: {f.example}</p>}
        </li>
      ))}
    </ul>
  );
}

function TestList({ title, rows, attempts, spaced }: { title: string; rows: TestRow[]; attempts: Map<string, Attempts>; spaced?: boolean }) {
  return (
    <div className={spaced ? "mt-4" : ""}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-inkmuted">{title}</p>
      <ul className="space-y-2">
        {rows.map((t) => {
          const a = attempts.get(t.id);
          return (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm text-ink">🧪 {t.title}</span>
                <span className="block text-xs text-inkmuted">{t.duration_min} min{a ? ` · attempted ${a.attempts}× · best ${Math.round(a.bestPct)}%` : " · not attempted yet"}</span>
              </span>
              <Link to={`/student/tests/${t.id}`} className="inline-flex min-h-[44px] items-center rounded-md border border-line px-3 text-xs text-ink hover:border-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper">
                {a ? "Retake test" : "Start test"}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
