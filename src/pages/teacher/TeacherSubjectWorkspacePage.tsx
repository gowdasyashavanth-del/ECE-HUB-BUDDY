import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";

interface AssignmentRow {
  id: string;
  subject_id: string;
  subjects: { id: string; name: string; code: string | null } | null;
  sections: {
    id: string;
    name: string;
    academic_years: { id: string; name: string } | null;
    semesters: {
      id: string;
      number: number;
      programs: {
        id: string;
        name: string;
        regulations: { id: string; name: string } | null;
      } | null;
    } | null;
  } | null;
}

const first = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

export function TeacherSubjectWorkspacePage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [assignment, setAssignment] = useState<AssignmentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !profile || !assignmentId) return;
    const client = supabase;
    const teacherId = profile.id;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      // The assignment id is the authorization boundary for this workspace.
      // The teacher can only load an assignment row belonging to their own profile.
      const { data, error: fetchError } = await client
        .from("teacher_assignments")
        .select(
          "id, subject_id, subjects(id, name, code), sections(id, name, academic_years(id, name), semesters(id, number, programs(id, name, regulations(id, name))))"
        )
        .eq("id", assignmentId)
        .eq("teacher_id", teacherId)
        .maybeSingle();

      if (cancelled) return;
      if (fetchError) {
        setError(friendlyDbError(fetchError, "Teacher assignment"));
        setLoading(false);
        return;
      }
      if (!data) {
        setError("This assignment does not exist or is not assigned to your teacher account.");
        setLoading(false);
        return;
      }

      setAssignment(data as unknown as AssignmentRow);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [assignmentId, profile]);

  if (!profile) return null;
  if (loading) return <LoadingState label="Opening your assigned subject…" />;
  if (error || !assignment) {
    return (
      <div>
        <ErrorState message={error ?? "Assignment not found."} onRetry={() => navigate("/teacher")} />
        <Link to="/teacher" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          ← Back to Teacher Dashboard
        </Link>
      </div>
    );
  }

  const section = first(assignment.sections);
  const semester = section ? first(section.semesters) : null;
  const program = semester ? first(semester.programs) : null;
  const regulation = program ? first(program.regulations) : null;
  const year = section ? first(section.academic_years) : null;
  const subject = first(assignment.subjects);

  const subjectQuery = subject ? `?subjectId=${encodeURIComponent(subject.id)}` : "";

  return (
    <div>
      <div className="mb-5">
        <Link to="/teacher" className="text-sm font-medium text-accent hover:underline">
          ← Back to Teacher Dashboard
        </Link>
      </div>

      <PageHeader
        title={subject?.name ?? "Assigned Subject"}
        subtitle={`${subject?.code ?? "No subject code"} · Your exact teacher assignment`}
      />

      <div className="mb-6 rounded-lg border border-line bg-panel p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Academic Year" value={year?.name ?? "—"} />
          <Info label="Regulation" value={regulation?.name ?? "—"} />
          <Info label="Program" value={program?.name ?? "—"} />
          <Info label="Semester" value={`Semester ${semester?.number ?? "—"}`} />
          <Info label="Section" value={`Section ${section?.name ?? "—"}`} />
          <Info label="Subject" value={`${subject?.name ?? "—"}${subject?.code ? ` (${subject.code})` : ""}`} />
        </div>
      </div>

      <div className="mb-3">
        <h2 className="font-body text-lg font-semibold text-ink">Manage this assignment</h2>
        <p className="mt-1 text-sm text-inkmuted">Choose what you want to manage for this assigned subject.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <WorkspaceLink to={`/teacher/content${subjectQuery}`} title="Content" description="Units, topics, notes, videos, documents and links." />
        <WorkspaceLink to={`/teacher/formulas${subjectQuery}`} title="Formulas" description="Manage formulas and formula-hub material." />
        <WorkspaceLink to={`/teacher/questions${subjectQuery}`} title="Questions" description="Create and manage subject questions." />
        <WorkspaceLink to={`/teacher/tests${subjectQuery}`} title="Tests" description="Build tests and assessments for this subject." />
        <WorkspaceLink to={`/teacher/results${subjectQuery}`} title="Results" description="Review assessment results available to you." />
        <WorkspaceLink to={`/teacher/students${subjectQuery}`} title="Students" description="View students in your assigned section." />
        <WorkspaceLink to={`/teacher/announcements${subjectQuery}`} title="Announcements" description="Manage announcements for your teaching area." />
      </div>

      <div className="mt-6 rounded-lg border border-line bg-panel px-4 py-3 text-xs text-inkmuted">
        Access is verified against this teacher assignment. Opening a different assignment ID will be denied unless that assignment belongs to your teacher account.
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-inkmuted">{label}</p>
      <p className="mt-1 text-sm font-medium text-ink">{value}</p>
    </div>
  );
}

function WorkspaceLink({ to, title, description }: { to: string; title: string; description: string }) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-line bg-panel p-4 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-body font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-sm leading-5 text-inkmuted">{description}</p>
        </div>
        <span className="text-lg text-inkmuted transition group-hover:translate-x-0.5 group-hover:text-accent">→</span>
      </div>
    </Link>
  );
}
