-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 10: RLS — Academic Hierarchy, Users, Assignments
-- DESIGN ONLY — review before running against a real Supabase project.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── STRUCTURE TABLES (years → topics): read by any authenticated
--     user, restructured only by admins. Same convention Bioverse used
--     for units/chapters.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.academic_years enable row level security;
drop policy if exists "academic_years_select_authenticated" on public.academic_years;
create policy "academic_years_select_authenticated" on public.academic_years for select
  using (auth.role() = 'authenticated');
drop policy if exists "academic_years_write_admin_only" on public.academic_years;
create policy "academic_years_write_admin_only" on public.academic_years for all
  using (public.is_admin()) with check (public.is_admin());

alter table public.regulations enable row level security;
drop policy if exists "regulations_select_authenticated" on public.regulations;
create policy "regulations_select_authenticated" on public.regulations for select
  using (auth.role() = 'authenticated');
drop policy if exists "regulations_write_admin_only" on public.regulations;
create policy "regulations_write_admin_only" on public.regulations for all
  using (public.is_admin()) with check (public.is_admin());

alter table public.programs enable row level security;
drop policy if exists "programs_select_authenticated" on public.programs;
create policy "programs_select_authenticated" on public.programs for select
  using (auth.role() = 'authenticated');
drop policy if exists "programs_write_admin_only" on public.programs;
create policy "programs_write_admin_only" on public.programs for all
  using (public.is_admin()) with check (public.is_admin());

alter table public.semesters enable row level security;
drop policy if exists "semesters_select_authenticated" on public.semesters;
create policy "semesters_select_authenticated" on public.semesters for select
  using (auth.role() = 'authenticated');
drop policy if exists "semesters_write_admin_only" on public.semesters;
create policy "semesters_write_admin_only" on public.semesters for all
  using (public.is_admin()) with check (public.is_admin());

alter table public.sections enable row level security;
drop policy if exists "sections_select_authenticated" on public.sections;
create policy "sections_select_authenticated" on public.sections for select
  using (auth.role() = 'authenticated');
drop policy if exists "sections_write_admin_only" on public.sections;
create policy "sections_write_admin_only" on public.sections for all
  using (public.is_admin()) with check (public.is_admin());

alter table public.subjects enable row level security;
drop policy if exists "subjects_select_authenticated" on public.subjects;
create policy "subjects_select_authenticated" on public.subjects for select
  using (auth.role() = 'authenticated');
drop policy if exists "subjects_write_admin_only" on public.subjects;
create policy "subjects_write_admin_only" on public.subjects for all
  using (public.is_admin()) with check (public.is_admin());

alter table public.units enable row level security;
drop policy if exists "units_select_authenticated" on public.units;
create policy "units_select_authenticated" on public.units for select
  using (auth.role() = 'authenticated');
drop policy if exists "units_write_admin_only" on public.units;
create policy "units_write_admin_only" on public.units for all
  using (public.is_admin()) with check (public.is_admin());

alter table public.topics enable row level security;
drop policy if exists "topics_select_authenticated" on public.topics;
create policy "topics_select_authenticated" on public.topics for select
  using (auth.role() = 'authenticated');
drop policy if exists "topics_write_admin_only" on public.topics;
create policy "topics_write_admin_only" on public.topics for all
  using (public.is_admin()) with check (public.is_admin());


-- ═══════════════════════════════════════════════════════════════════════
-- CONTENT — subject-scoped. Published content visible to the subject's
-- enrolled students and assigned teacher; unpublished only to the
-- assigned teacher + admin. Write requires being the assigned teacher.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.content enable row level security;

drop policy if exists "content_select" on public.content;
create policy "content_select" on public.content for select
  using (
    public.is_admin()
    or public.teacher_has_subject(public.get_subject_id_for_topic(topic_id))
    or (is_published = true and public.student_enrolled_in_subject(public.get_subject_id_for_topic(topic_id)))
  );

drop policy if exists "content_insert" on public.content;
create policy "content_insert" on public.content for insert
  with check (public.is_admin() or public.teacher_has_subject(public.get_subject_id_for_topic(topic_id)));

drop policy if exists "content_update" on public.content;
create policy "content_update" on public.content for update
  using (public.is_admin() or public.teacher_has_subject(public.get_subject_id_for_topic(topic_id)))
  with check (public.is_admin() or public.teacher_has_subject(public.get_subject_id_for_topic(topic_id)));

drop policy if exists "content_delete_admin_only" on public.content;
create policy "content_delete_admin_only" on public.content for delete
  using (public.is_admin());


-- ═══════════════════════════════════════════════════════════════════════
-- USERS — same shape as Bioverse: self, admin, or (teacher viewing a
-- student) can read; self or admin can update; admin-only delete;
-- no insert policy (handle_new_user() trigger is the only writer).
-- ═══════════════════════════════════════════════════════════════════════
alter table public.users enable row level security;

drop policy if exists "users_select_own_or_admin_or_teacher" on public.users;
create policy "users_select_own_or_admin_or_teacher"
on public.users for select
using (
  id = auth.uid()
  or public.is_admin()
  or (public.current_role() = 'teacher' and role = 'student')
);

drop policy if exists "users_update_own_or_admin" on public.users;
create policy "users_update_own_or_admin"
on public.users for update
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists "users_delete_admin_only" on public.users;
create policy "users_delete_admin_only"
on public.users for delete
using (public.is_admin());


-- ═══════════════════════════════════════════════════════════════════════
-- STUDENT_ASSIGNMENTS — a student sees their own; a teacher sees only
-- students in sections THEY are assigned to (not every student);
-- writes are admin-only (enrollment is managed centrally).
-- ═══════════════════════════════════════════════════════════════════════
alter table public.student_assignments enable row level security;

drop policy if exists "student_assignments_select" on public.student_assignments;
create policy "student_assignments_select" on public.student_assignments for select
  using (
    student_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.teacher_assignments ta
      where ta.teacher_id = auth.uid() and ta.section_id = student_assignments.section_id
    )
  );

drop policy if exists "student_assignments_write_admin_only" on public.student_assignments;
create policy "student_assignments_write_admin_only" on public.student_assignments for all
  using (public.is_admin()) with check (public.is_admin());


-- ═══════════════════════════════════════════════════════════════════════
-- TEACHER_ASSIGNMENTS — a teacher sees their own assignment rows;
-- writes are admin-only (assignment is centrally managed, a teacher
-- can't self-assign to a subject).
-- ═══════════════════════════════════════════════════════════════════════
alter table public.teacher_assignments enable row level security;

drop policy if exists "teacher_assignments_select" on public.teacher_assignments;
create policy "teacher_assignments_select" on public.teacher_assignments for select
  using (teacher_id = auth.uid() or public.is_admin());

drop policy if exists "teacher_assignments_write_admin_only" on public.teacher_assignments;
create policy "teacher_assignments_write_admin_only" on public.teacher_assignments for all
  using (public.is_admin()) with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 10.
-- ═══════════════════════════════════════════════════════════════════════
