// Academic Analytics — typed wrappers over the read-only database
// functions (see migration academic_analytics). All authorization is in
// the database: the functions are SECURITY INVOKER (RLS applies), take no
// student/teacher id, and self-gate by role. The optional section /
// subject / hierarchy arguments are FILTERS that can only narrow scope.
import { supabase } from "./supabaseClient";
import { friendlyDbError } from "./supabaseErrors";

export interface Result<T> { data: T; error: string | null }

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

async function rpc<T>(fn: string, args: Record<string, unknown>, what: string): Promise<Result<T[]>> {
  if (!supabase) return { data: [], error: "Not connected." };
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { data: [], error: friendlyDbError(error, what) };
  return { data: (data ?? []) as T[], error: null };
}

// ─── Student ──────────────────────────────────────────────────────────
export interface StudentSummary {
  overall_progress_pct: number; topics_total: number;
  content_total: number; content_completed: number; subjects_count: number;
  tests_available: number; tests_available_attempted: number;
  tests_attempted: number; total_attempts: number;
  avg_latest_pct: number | null; avg_first_pct: number | null; best_pct: number | null;
  xp: number | null; streak: number | null; achievements_count: number;
}
export interface StudentSubjectRow {
  subject_id: string; subject_name: string; subject_code: string | null;
  topics_total: number; progress_pct: number; content_total: number; content_completed: number;
  tests_available: number; tests_attempted: number; avg_latest_pct: number | null;
}
export interface StudentTestRow {
  test_id: string; test_title: string; subject_id: string | null; subject_name: string | null;
  attempts: number; first_pct: number | null; latest_pct: number | null; best_pct: number | null;
  latest_score: number; latest_total: number; first_at: string; latest_at: string;
}

// PostgREST returns `numeric` columns as strings/numbers — normalise once.
const toNum = <T,>(row: T, keys: (keyof T)[]): T => {
  const out = { ...row } as Record<string, unknown>;
  for (const k of keys) out[k as string] = num(row[k]);
  return out as T;
};

export async function getStudentSummary(): Promise<Result<StudentSummary | null>> {
  const r = await rpc<StudentSummary>("analytics_student_summary", {}, "your analytics");
  return { data: r.data[0] ? toNum(r.data[0], ["avg_latest_pct", "avg_first_pct", "best_pct"]) : null, error: r.error };
}
export async function getStudentSubjects(): Promise<Result<StudentSubjectRow[]>> {
  const r = await rpc<StudentSubjectRow>("analytics_student_subjects", {}, "your subject progress");
  return { data: r.data.map((x) => toNum(x, ["avg_latest_pct"])), error: r.error };
}
export async function getStudentTests(limit = 50): Promise<Result<StudentTestRow[]>> {
  const r = await rpc<StudentTestRow>("analytics_student_tests", { p_limit: limit }, "your test results");
  return { data: r.data.map((x) => toNum(x, ["first_pct", "latest_pct", "best_pct"])), error: r.error };
}

// ─── Teacher / Admin (exact-scope roster + per-section-subject stats) ─
export interface PairStats {
  section_id: string; section_name: string;
  subject_id: string; subject_name: string; subject_code: string | null; semester_number: number;
  students: number; content_total: number; avg_content_pct: number | null;
  tests_available: number; students_with_attempts: number; total_attempts: number; avg_score_pct: number | null;
  students_no_attempts: number; students_zero_content: number; students_inactive_14d: number;
}
export interface RosterRow {
  student_id: string; full_name: string; usn: string | null;
  section_id: string; section_name: string;
  subject_id: string; subject_name: string; subject_code: string | null; semester_number: number;
  content_total: number; content_done: number;
  tests_available: number; tests_attempted: number; total_attempts: number;
  avg_latest_pct: number | null; last_activity: string | null;
}

export async function getPairStats(sectionId: string | null, subjectId: string | null): Promise<Result<PairStats[]>> {
  const r = await rpc<PairStats>("analytics_pair_stats", { p_section: sectionId, p_subject: subjectId }, "subject performance");
  return { data: r.data.map((x) => toNum(x, ["avg_content_pct", "avg_score_pct"])), error: r.error };
}
export async function getRoster(sectionId: string | null, subjectId: string | null, limit = 300): Promise<Result<RosterRow[]>> {
  const r = await rpc<RosterRow>("analytics_student_rows", { p_section: sectionId, p_subject: subjectId, p_limit: limit }, "student performance");
  return { data: r.data.map((x) => toNum(x, ["avg_latest_pct"])), error: r.error };
}

// ─── Admin overview ───────────────────────────────────────────────────
export interface AdminOverview {
  people: { students: number; teachers: number };
  structure: {
    academic_years: number; regulations: number; regulations_active: number; programs: number; programs_active: number;
    semesters: number; sections: number; subjects: number; units: number; topics: number;
  };
  content: {
    total: number; published: number; subjects_with_published: number; topics_with_published: number;
    completion_records: number; completions_possible: number;
  };
  notes: { total: number; section_subject_pairs: number; pairs_with_notes: number };
  formulas: { total: number; subjects_with_formulas: number };
  tests: { total: number; published: number; tests_with_attempts: number; attempts: number; students_attempted: number; avg_latest_pct: number | null };
  planner: { total: number; upcoming: number; next_30_days: number; by_type: Record<string, number> };
  announcements: { total: number; last_30_days: number; by_scope: Record<string, number> };
}
export interface AdminFilters {
  year: string | null; regulation: string | null; program: string | null;
  semester: string | null; section: string | null; subject: string | null;
}
export const NO_FILTERS: AdminFilters = { year: null, regulation: null, program: null, semester: null, section: null, subject: null };

export async function getAdminOverview(f: AdminFilters): Promise<Result<AdminOverview | null>> {
  if (!supabase) return { data: null, error: "Not connected." };
  const { data, error } = await supabase.rpc("analytics_admin_overview", {
    p_year: f.year, p_regulation: f.regulation, p_program: f.program,
    p_semester: f.semester, p_section: f.section, p_subject: f.subject,
  });
  if (error) return { data: null, error: friendlyDbError(error, "the overview") };
  return { data: (data as AdminOverview | null) ?? null, error: null };
}

// ─── Formatting helpers ───────────────────────────────────────────────
export const fmtPct = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined ? "—" : `${digits ? v.toFixed(digits) : Math.round(v)}%`;
export const ratioPct = (n: number, d: number): number | null => (d > 0 ? (n / d) * 100 : null);
