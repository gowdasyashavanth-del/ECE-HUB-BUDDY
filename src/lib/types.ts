// Shared types mirroring the approved database design
// (supabase/migrations/02_users_and_profiles.sql and friends).
// Kept in one place so the UI's internal model can evolve independently
// of the exact storage format later, per the "clean internal model"
// principle already agreed for the Virtual Lab circuit data.

export type UserRole = "student" | "teacher" | "super_admin";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  xp: number;
  streak: number;
  avatar_url: string | null;
  usn: string | null;
  created_at: string;
}

export interface AcademicYear {
  id: string;
  name: string;
  is_current: boolean;
}

export interface Regulation {
  id: string;
  academic_year_id: string;
  name: string;
  is_active: boolean;
}

export interface Program {
  id: string;
  regulation_id: string;
  name: string;
  code: string | null;
  is_active: boolean;
}

export interface Semester {
  id: string;
  program_id: string;
  number: number;
  name: string | null;
}

export interface Section {
  id: string;
  semester_id: string;
  academic_year_id: string;
  name: string;
}

export interface Subject {
  id: string;
  semester_id: string;
  name: string;
  code: string | null;
  credits: number | null;
  order_number: number;
}

export interface StudentAssignment {
  id: string;
  student_id: string;
  academic_year_id: string;
  regulation_id: string;
  program_id: string;
  semester_id: string;
  section_id: string;
  is_current: boolean;
}

export interface TeacherAssignment {
  id: string;
  teacher_id: string;
  section_id: string;
  subject_id: string;
}
