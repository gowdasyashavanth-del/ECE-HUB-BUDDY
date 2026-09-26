-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 14: Fix Teacher Student-Visibility Scope
--
-- PROBLEM: users_select_own_or_admin_or_teacher (from 10_rls_core.sql)
-- let any teacher read EVERY student row platform-wide. Its teacher
-- clause only checked the CALLER's role and the TARGET row's role —
-- never whether the target student is actually one the teacher
-- teaches. That satisfied "a teacher can see students" but not "only
-- their own."
--
-- FIX: replace the teacher clause with a real relationship check,
-- using ONLY existing tables: a teacher may read a student's users
-- row if that student has a CURRENT student_assignments row whose
-- section_id matches one of the teacher's own teacher_assignments
-- rows. No new tables, no new columns, no schema change — this is
-- the exact chain teacher_assignments/student_assignments were
-- already designed to support via their shared section_id.
-- ═══════════════════════════════════════════════════════════════════════

drop policy if exists "users_select_own_or_admin_or_teacher" on public.users;
create policy "users_select_own_or_admin_or_teacher"
on public.users for select
using (
  id = auth.uid()
  or public.is_admin()
  or (
    public.current_role() = 'teacher'
    and role = 'student'
    and exists (
      select 1
      from public.student_assignments sa
      join public.teacher_assignments ta on ta.section_id = sa.section_id
      where sa.student_id = users.id
        and sa.is_current
        and ta.teacher_id = auth.uid()
    )
  )
);

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 14.
-- ═══════════════════════════════════════════════════════════════════════
