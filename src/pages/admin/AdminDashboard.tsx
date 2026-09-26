import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatCard } from "../../components/ui/StatCard";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";

interface Counts {
  students: number;
  teachers: number;
  academicYears: number;
  programs: number;
  sections: number;
  subjects: number;
  teacherAssignments: number;
  classTeacherSections: number;
  sectionsTotal: number;
  crDesignations: number;
  labBatches: number;
  attendanceRecords: number;
  iaAssessments: number;
  iaMarks: number;
  timetableEntries: number;
}

// Every number here is a live count from the database (head:true count
// queries — no rows fetched, no client-side aggregation of large
// tables). If a query fails we show the error rather than a partial or
// fabricated number.
export function AdminDashboard() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [currentYearName, setCurrentYearName] = useState<string | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!supabase) return;
    setError(null);
    const [
      students, teachers, academicYears, programs, sections, subjects,
      teacherAssignments, classTeacherSections, crDesignations, labBatches,
      attendanceRecords, iaAssessments, iaMarks, timetableEntries, currentYear,
    ] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "student"),
      supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "teacher"),
      supabase.from("academic_years").select("id", { count: "exact", head: true }),
      supabase.from("programs").select("id", { count: "exact", head: true }),
      supabase.from("sections").select("id", { count: "exact", head: true }),
      supabase.from("subjects").select("id", { count: "exact", head: true }),
      supabase.from("teacher_assignments").select("id", { count: "exact", head: true }),
      supabase.from("class_teacher_assignments").select("id", { count: "exact", head: true }).eq("is_current", true),
      supabase.from("cr_designations").select("id", { count: "exact", head: true }).eq("is_current", true),
      supabase.from("lab_batches").select("id", { count: "exact", head: true }),
      supabase.from("attendance_records").select("id", { count: "exact", head: true }),
      supabase.from("ia_assessments").select("id", { count: "exact", head: true }),
      supabase.from("ia_marks").select("id", { count: "exact", head: true }),
      supabase.from("timetable_entries").select("id", { count: "exact", head: true }).eq("is_current", true),
      supabase.from("academic_years").select("name").eq("is_current", true).maybeSingle(),
    ]);

    const all = [students, teachers, academicYears, programs, sections, subjects, teacherAssignments, classTeacherSections, crDesignations, labBatches, attendanceRecords, iaAssessments, iaMarks, timetableEntries];
    const firstError = all.find((r) => r.error);
    if (firstError?.error || currentYear.error) {
      setError("We couldn't load platform statistics. Please try again.");
      return;
    }

    setCounts({
      students: students.count ?? 0,
      teachers: teachers.count ?? 0,
      academicYears: academicYears.count ?? 0,
      programs: programs.count ?? 0,
      sections: sections.count ?? 0,
      sectionsTotal: sections.count ?? 0,
      subjects: subjects.count ?? 0,
      teacherAssignments: teacherAssignments.count ?? 0,
      classTeacherSections: classTeacherSections.count ?? 0,
      crDesignations: crDesignations.count ?? 0,
      labBatches: labBatches.count ?? 0,
      attendanceRecords: attendanceRecords.count ?? 0,
      iaAssessments: iaAssessments.count ?? 0,
      iaMarks: iaMarks.count ?? 0,
      timetableEntries: timetableEntries.count ?? 0,
    });
    setCurrentYearName(currentYear.data?.name ?? null);
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (counts === null || currentYearName === undefined) return <LoadingState label="Loading platform statistics…" />;

  const sectionsWithoutClassTeacher = Math.max(0, counts.sectionsTotal - counts.classTeacherSections);

  return (
    <div>
      <PageHeader title="Platform overview" subtitle="Live counts from the database." />

      <div className="mb-4 rounded-lg border border-line bg-panel px-4 py-3">
        <p className="font-mono text-[11px] uppercase tracking-widest text-inkmuted">Current Academic Year</p>
        <p className="mt-1 font-body text-sm text-ink">
          {currentYearName ?? "No current academic year configured."}
        </p>
      </div>

      <p className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">Academic Structure</p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Academic Years" value={counts.academicYears} />
        <StatCard label="Programs" value={counts.programs} />
        <StatCard label="Sections" value={counts.sections} />
        <StatCard label="Subjects" value={counts.subjects} />
      </div>

      <p className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">People</p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Students" value={counts.students} />
        <StatCard label="Teachers" value={counts.teachers} />
        <StatCard label="Teacher Assignments" value={counts.teacherAssignments} />
        <StatCard label="Lab Batches" value={counts.labBatches} />
      </div>

      <p className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">Class &amp; Section Operations</p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Sections with Class Teacher" value={counts.classTeacherSections} />
        <StatCard label="Sections without Class Teacher" value={sectionsWithoutClassTeacher} />
        <StatCard label="CR Designations" value={counts.crDesignations} />
        <StatCard label="Timetable Entries" value={counts.timetableEntries} />
      </div>

      <p className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">Attendance &amp; IA</p>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Attendance Records" value={counts.attendanceRecords > 0 ? counts.attendanceRecords : "No data yet"} />
        <StatCard label="IA Assessments Configured" value={counts.iaAssessments} />
        <StatCard label="IA Marks Entered" value={counts.iaMarks} />
      </div>

      <p className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-inkmuted">Quick Actions</p>
      <div className="flex flex-wrap gap-2">
        <Link to="/admin/academic-structure" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Academic Structure</Link>
        <Link to="/admin/teachers" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Teachers</Link>
        <Link to="/admin/teacher-assignments" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Teacher Assignments</Link>
        <Link to="/admin/class-teachers" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Class Teachers</Link>
        <Link to="/admin/cr-designations" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">CR Designations</Link>
        <Link to="/admin/lab-batches" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Lab Batches</Link>
        <Link to="/admin/timetable" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Timetable</Link>
        <Link to="/admin/attendance" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Attendance</Link>
        <Link to="/admin/ia" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">IA Marks</Link>
        <Link to="/admin/students" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper">Students</Link>
      </div>
    </div>
  );
}
