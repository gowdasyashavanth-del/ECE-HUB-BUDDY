import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../ui/PageHeader";
import { LoadingState } from "../ui/LoadingState";
import { ErrorState } from "../ui/ErrorState";
import { EmptyState } from "../ui/EmptyState";
import { getStudentSubjects, type StudentSubjectRow } from "../../lib/analytics";
import { getOutline, studyUrl, type OutlineRow } from "../../lib/study";
import { NotFound, ProgressBar } from "./StudyParts";

export function StudyOutline({ subjectId }: { subjectId: string }) {
  const [rows, setRows] = useState<OutlineRow[] | null>(null);
  const [subject, setSubject] = useState<StudentSubjectRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const retry = useCallback(() => setKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setRows(null); setSubject(null); setError(null);
    Promise.all([getOutline(subjectId), getStudentSubjects()]).then(([o, s]) => {
      if (cancelled) return;
      const err = o.error ?? s.error;
      if (err) { setError(err); return; }
      setSubject(s.data.find((x) => x.subject_id === subjectId) ?? null);
      setRows(o.data);
    });
    return () => { cancelled = true; };
  }, [subjectId, key]);

  const units = useMemo(() => {
    const map = new Map<string, { id: string; name: string; topics: OutlineRow[] }>();
    for (const r of rows ?? []) {
      const u = map.get(r.unit_id) ?? { id: r.unit_id, name: r.unit_name, topics: [] };
      u.topics.push(r);
      map.set(r.unit_id, u);
    }
    return Array.from(map.values());
  }, [rows]);

  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (rows === null) return <LoadingState label="Loading subject…" />;
  // Not enrolled / nonexistent are deliberately indistinguishable.
  if (!subject) return <NotFound what="subject" />;

  return (
    <div>
      <PageHeader title={subject.subject_name} subtitle="Choose a topic to open its study workspace." />
      <p className="mb-2"><Link to={studyUrl()} className="inline-flex min-h-[44px] items-center text-sm font-medium text-copper-dark hover:underline">← All subjects</Link></p>

      {units.length === 0 ? (
        <EmptyState title="No topics yet" message="Your teacher hasn't added units and topics for this subject yet." />
      ) : (
        <div className="space-y-4">
          {units.map((u) => (
            <section key={u.id} className="rounded-lg border border-line bg-panel p-4" aria-label={u.name}>
              <h2 className="mb-2 font-display text-sm font-semibold text-ink">{u.name}</h2>
              <ul className="space-y-2">
                {u.topics.map((t) => (
                  <li key={t.topic_id}>
                    <Link
                      to={studyUrl({ subject: subjectId, unit: u.id, topic: t.topic_id })}
                      className="block rounded-md border border-line px-3 py-2.5 hover:border-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 break-words text-sm text-ink">{t.topic_name}</span>
                        <span className="shrink-0 font-mono text-xs text-ink">{t.progress_pct}%</span>
                      </div>
                      <div className="mt-1.5"><ProgressBar pct={t.progress_pct} label={`${t.topic_name} progress`} /></div>
                      <p className="mt-1 text-xs text-inkmuted">
                        {t.content_total === 0 ? "No content published yet" : `${t.content_done}/${t.content_total} content completed`}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
