import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { getTopicContext, studyUrl, type TopicContext } from "../../lib/study";

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// The ONLY "where you left off" signal in the database is the student's
// most recent content completion. If there is none, nothing is invented —
// the caller's fallback text is shown instead.
export function ContinueStudying({ fallback }: { fallback: string }) {
  const { profile } = useAuth();
  const [state, setState] = useState<"loading" | "none" | { ctx: TopicContext; title: string }>("loading");

  useEffect(() => {
    if (!supabase || !profile) return;
    let cancelled = false;
    (async () => {
      // The newest completions, newest first. A completion only "qualifies"
      // if its content is still readable (RLS hides unpublished content) AND
      // the database still confirms the topic as this student's — so the most
      // recent unusable one is skipped rather than blanking the whole card.
      const { data } = await supabase!
        .from("content_completions")
        .select("completed_at, content(title, topic_id)")
        .eq("student_id", profile.id)
        .order("completed_at", { ascending: false })
        .limit(10);
      for (const row of (data ?? []) as any[]) {
        const c = first<{ title: string; topic_id: string }>(row.content);
        if (!c) continue;
        const { data: ctx } = await getTopicContext(c.topic_id);
        if (cancelled) return;
        if (ctx) { setState({ ctx, title: c.title }); return; }
      }
      if (!cancelled) setState("none");
    })();
    return () => { cancelled = true; };
  }, [profile]);

  if (state === "loading") return <p className="text-sm text-inkmuted">Loading…</p>;
  if (state === "none") return <p className="text-sm text-inkmuted">{fallback}</p>;
  const { ctx, title } = state;
  return (
    <Link
      to={studyUrl({ subject: ctx.subject_id, unit: ctx.unit_id, topic: ctx.topic_id })}
      className="block rounded-md border border-line bg-panel px-3 py-2.5 hover:border-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper"
    >
      <span className="block font-mono text-[11px] uppercase tracking-wide text-inkmuted">Continue</span>
      <span className="block text-sm font-medium text-ink">{ctx.subject_name} → {ctx.topic_name}</span>
      <span className="block truncate text-xs text-inkmuted">From your last completed content: “{title}”</span>
    </Link>
  );
}
