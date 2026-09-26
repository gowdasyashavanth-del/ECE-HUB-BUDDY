import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface Subject { id: string; name: string; code: string | null; }
interface Assessment { id: string; subject_id: string; ia_number: number; max_marks: number; }
interface MarkRow { id: string; ia_assessment_id: string; marks_obtained: number; }

// Read-only by design: ia_marks RLS grants students SELECT of their own
// rows only, with no INSERT/UPDATE/DELETE policy at all, so this page
// never renders any editing control. There is no defined final-IA
// formula anywhere in the schema, so this page shows raw marks and
// simple counts only — it never invents a total, weighting, or
// best-of-N rule.
export function StudentIaPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [marks, setMarks] = useState<MarkRow[]>([]);

  useEffect(() => {
    async function load() {
      if (!supabase || !profile) return;
      setError(null);

      const saRes = await supabase
        .from("student_assignments")
        .select("semester_id")
        .eq("student_id", profile.id)
        .eq("is_current", true)
        .maybeSingle();
      if (saRes.error) {
        setLoading(false);
        setError("We couldn't load your current enrollment.");
        return;
      }
      const semesterId = saRes.data?.semester_id;
      if (!semesterId) {
        setLoading(false);
        setSubjects([]);
        return;
      }

      const [subjRes, marksRes] = await Promise.all([
        supabase.from("subjects").select("id, name, code").eq("semester_id", semesterId),
        supabase.from("ia_marks").select("id, ia_assessment_id, marks_obtained").eq("student_id", profile.id),
      ]);
      setLoading(false);
      if (subjRes.error || marksRes.error) {
        setError("We couldn't load your IA marks. Please try again.");
        return;
      }
      const subjectList = (subjRes.data ?? []) as Subject[];
      setSubjects(subjectList);
      setMarks((marksRes.data ?? []) as MarkRow[]);

      if (subjectList.length > 0) {
        const assessRes = await supabase
          .from("ia_assessments")
          .select("id, subject_id, ia_number, max_marks")
          .in("subject_id", subjectList.map((s) => s.id));
        if (!assessRes.error) setAssessments((assessRes.data ?? []) as Assessment[]);
      }
    }
    load();
  }, [profile]);

  const markByAssessment = useMemo(() => {
    const map = new Map<string, MarkRow>();
    marks.forEach((m) => map.set(m.ia_assessment_id, m));
    return map;
  }, [marks]);

  const assessmentsBySubject = useMemo(() => {
    const map = new Map<string, Assessment[]>();
    assessments.forEach((a) => {
      const list = map.get(a.subject_id) ?? [];
      list.push(a);
      map.set(a.subject_id, list);
    });
    map.forEach((list) => list.sort((a, b) => a.ia_number - b.ia_number));
    return map;
  }, [assessments]);

  const summary = useMemo(() => {
    const configuredSubjects = new Set(assessments.map((a) => a.subject_id)).size;
    const totalAssessments = assessments.length;
    const completed = assessments.filter((a) => markByAssessment.has(a.id)).length;
    return { configuredSubjects, totalAssessments, completed };
  }, [assessments, markByAssessment]);

  if (error) return <ErrorState message={error} />;
  if (loading) return <LoadingState label="Loading your IA marks…" />;

  return (
    <div>
      <PageHeader title="Internal Assessment (IA)" subtitle="Your IA marks, as entered by your subject teachers." />

      {subjects.length === 0 ? (
        <EmptyState title="No subjects found" message="You don't appear to be enrolled in any subjects this semester yet." />
      ) : assessments.length === 0 ? (
        <EmptyState title="No IA assessments configured yet." message="Your Super Admin hasn't configured any IA for your subjects yet." />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-2">
            <Stat label="Subjects" value={summary.configuredSubjects} />
            <Stat label="Assessments" value={summary.totalAssessments} />
            <Stat label="Completed" value={summary.completed} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {subjects.map((subject) => {
              const subjAssessments = assessmentsBySubject.get(subject.id) ?? [];
              if (subjAssessments.length === 0) return null;
              return (
                <div key={subject.id} className="rounded-lg border border-line bg-panel p-4">
                  <p className="text-sm font-semibold text-ink">{subject.name}</p>
                  {subject.code && <p className="font-mono text-xs text-inkmuted">{subject.code}</p>}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    {[1, 2, 3].map((n) => {
                      const a = subjAssessments.find((x) => x.ia_number === n);
                      const m = a ? markByAssessment.get(a.id) : undefined;
                      return (
                        <div key={n} className="rounded-md bg-paper p-2">
                          <p className="text-[10px] uppercase tracking-wide text-inkmuted">IA {n}</p>
                          {!a ? (
                            <p className="mt-1 text-xs text-inkmuted">Not configured</p>
                          ) : m ? (
                            <p className="mt-1 text-sm font-medium text-ink">{m.marks_obtained} / {a.max_marks}</p>
                          ) : (
                            <p className="mt-1 text-xs text-inkmuted">Not entered yet</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-2.5 text-center">
      <p className="font-display text-lg font-semibold text-ink">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-inkmuted">{label}</p>
    </div>
  );
}
