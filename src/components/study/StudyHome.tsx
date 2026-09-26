import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../ui/PageHeader";
import { LoadingState } from "../ui/LoadingState";
import { ErrorState } from "../ui/ErrorState";
import { EmptyState } from "../ui/EmptyState";
import { getStudentSubjects, type StudentSubjectRow } from "../../lib/analytics";
import { studyUrl } from "../../lib/study";
import { ContinueStudying } from "./ContinueStudying";
import { ProgressBar } from "./StudyParts";

export function StudyHome() {
  const [subjects, setSubjects] = useState<StudentSubjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const retry = useCallback(() => setKey((k) => k + 1), []);

  // Reuses the existing analytics function: the student's own semester
  // subjects with the app's standard progress numbers.
  useEffect(() => {
    let cancelled = false;
    setSubjects(null);
    getStudentSubjects().then((r) => {
      if (cancelled) return;
      setError(r.error);
      setSubjects(r.data);
    });
    return () => { cancelled = true; };
  }, [key]);

  return (
    <div>
      <PageHeader title="Study Mode" subtitle="Pick a subject, unit and topic, then work through its content, notes, formulas and tests." />
      <div className="mb-6"><ContinueStudying fallback="Choose a subject to start studying." /></div>

      {subjects === null && !error && <LoadingState label="Loading your subjects…" />}
      {error && <ErrorState message={error} onRetry={retry} />}
      {subjects !== null && !error && subjects.length === 0 && (
        <EmptyState title="No subjects yet" message="You aren't assigned to a semester with subjects yet. Check back once an admin sets that up." />
      )}
      {subjects !== null && subjects.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {subjects.map((s) => (
            <Link
              key={s.subject_id}
              to={studyUrl({ subject: s.subject_id })}
              className="rounded-lg border border-line bg-panel px-4 py-3 hover:border-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-ink">{s.subject_name}</p>
                <span className="shrink-0 font-mono text-xs text-ink">{s.progress_pct}%</span>
              </div>
              <p className="mb-2 font-mono text-xs text-inkmuted">{s.subject_code ?? "No code"}</p>
              <ProgressBar pct={s.progress_pct} label={`${s.subject_name} progress`} />
              <p className="mt-1.5 text-xs text-inkmuted">
                {s.content_total === 0 ? "No content published yet" : `${s.content_completed}/${s.content_total} content completed`}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
