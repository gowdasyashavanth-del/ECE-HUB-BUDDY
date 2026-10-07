-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 04: Assignments & Enrollments
-- DESIGN ONLY — review before running against a real Supabase project.
--
-- NOTE: unlike Bioverse (which had no way to create a teacher account
-- at all beyond manual SQL), teacher provisioning here is still assumed
-- to be an admin-facing flow you'll build in the app: an admin promotes
-- a signed-up user's `users.role` to 'teacher', then creates rows here.
-- This migration only adds the tables; the admin UI is a separate,
-- later build step.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.student_assignments (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references public.users(id) on delete cascade,
  academic_year_id   uuid not null references public.academic_years(id) on delete restrict,
  regulation_id      uuid not null references public.regulations(id) on delete restrict,
  program_id         uuid not null references public.programs(id) on delete restrict,
  semester_id        uuid not null references public.semesters(id) on delete restrict,
  section_id         uuid not null references public.sections(id) on delete restrict,
  is_current         boolean not null default true,
  created_at         timestamptz not null default now()
);
-- A student has at most one CURRENT assignment, but past assignments
-- are kept (not deleted) as the student progresses semesters — this is
-- what keeps an older regulation's record intact for existing students.
create unique index if not exists one_current_assignment_per_student
  on public.student_assignments(student_id) where is_current;
create index if not exists idx_student_assignments_student on public.student_assignments(student_id);
create index if not exists idx_student_assignments_section on public.student_assignments(section_id);

create table if not exists public.teacher_assignments (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid not null references public.users(id) on delete cascade,
  section_id   uuid not null references public.sections(id) on delete cascade,
  subject_id   uuid not null references public.subjects(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (teacher_id, section_id, subject_id)
);
create index if not exists idx_teacher_assignments_teacher on public.teacher_assignments(teacher_id);
create index if not exists idx_teacher_assignments_subject on public.teacher_assignments(subject_id);

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 04.
-- ═══════════════════════════════════════════════════════════════════════
