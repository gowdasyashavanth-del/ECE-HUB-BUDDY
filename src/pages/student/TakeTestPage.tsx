import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface RpcQuestion { id: string; question_text: string; options: Record<string, string>; difficulty: string; }

// This page never reads or sends a score/xp value anywhere. Questions
// come from get_test_questions() (no correct_answer in the response —
// structurally, not just because this UI doesn't render it), and
// submission goes through submit_test_attempt(), which takes only
// (test_id, answers) and returns the SERVER-computed result. There is
// no code path here that could show a fabricated score even if this
// component were buggy or tampered with in the browser.
export function TakeTestPage() {
  const { testId } = useParams<{ testId: string }>();
  const [questions, setQuestions] = useState<RpcQuestion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ score: number; total: number } | null>(null);

  useEffect(() => {
    if (!supabase || !testId) return;
    let cancelled = false;

    async function load() {
      setLoadError(null);
      const { data, error } = await supabase!.rpc("get_test_questions", { p_test_id: testId });
      if (cancelled) return;
      if (error) {
        setLoadError(friendlyDbError(error, "Test"));
        return;
      }
      setQuestions((data ?? []) as RpcQuestion[]);
    }

    load();
    return () => { cancelled = true; };
  }, [testId]);

  async function handleSubmit() {
    if (!supabase || !testId) return;
    setSubmitError(null);
    setSubmitting(true);
    const { data, error } = await supabase.rpc("submit_test_attempt", { p_test_id: testId, p_answers: answers });
    setSubmitting(false);
    if (error) {
      setSubmitError(friendlyDbError(error, "Test submission"));
      return;
    }
    setResult({ score: data.score, total: data.total });
  }

  if (loadError) {
    return (
      <div>
        <PageHeader title="Test" />
        <ErrorState message={loadError} />
      </div>
    );
  }

  if (questions === null) {
    return (
      <div>
        <PageHeader title="Test" />
        <LoadingState label="Loading test…" />
      </div>
    );
  }

  if (result) {
    const pct = Math.round((result.score / result.total) * 100);
    return (
      <div>
        <PageHeader title="Result" />
        <div className="max-w-sm rounded-lg border border-line bg-panel p-6 text-center">
          <p className="font-display text-3xl font-semibold text-ink">{result.score} / {result.total}</p>
          <p className="mt-1 font-mono text-sm text-inkmuted">{pct}%</p>
          <Link to="/student/tests" className="mt-4 inline-block rounded-md border border-line px-4 py-2 text-sm font-medium text-ink hover:border-copper hover:text-copper-dark">
            Back to Tests
          </Link>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div>
        <PageHeader title="Test" />
        <EmptyState
          title="This test isn't ready yet"
          message="Your teacher hasn't added any questions to this test yet. Check back later."
        />
        <Link to="/student/tests" className="mt-4 inline-block rounded-md border border-line px-4 py-2 text-sm font-medium text-ink hover:border-copper hover:text-copper-dark">
          Back to Tests
        </Link>
      </div>
    );
  }

  const allAnswered = questions.every((q) => answers[q.id]);

  return (
    <div>
      <PageHeader title="Test" subtitle={`${questions.length} question${questions.length === 1 ? "" : "s"}.`} />

      <div className="space-y-4">
        {questions.map((q, i) => (
          <div key={q.id} className="rounded-lg border border-line bg-panel p-4">
            <p className="text-sm font-medium text-ink">{i + 1}. {q.question_text}</p>
            <div className="mt-2 space-y-1.5">
              {Object.entries(q.options).map(([key, text]) => (
                <label key={key} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-paper">
                  <input
                    type="radio"
                    name={`q-${q.id}`}
                    checked={answers[q.id] === key}
                    onChange={() => setAnswers((a) => ({ ...a, [q.id]: key }))}
                  />
                  {text}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {submitError && <p className="mt-4 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{submitError}</p>}

      <button
        onClick={handleSubmit}
        disabled={!allAnswered || submitting}
        className="mt-5 rounded-md bg-copper px-5 py-2.5 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit Test"}
      </button>
      {!allAnswered && (
        <p className="mt-2 text-xs text-inkmuted">Answer all questions to submit.</p>
      )}
    </div>
  );
}
