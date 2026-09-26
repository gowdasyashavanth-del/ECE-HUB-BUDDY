-- Phase 16G follow-up (2nd blocker): migration 33 let students read
-- teacher_assignments for their own current section, but the join to
-- public.users still returned nothing because users_select_own_or_admin_or_teacher
-- has no branch for "student reading a teacher's row". A broad new RLS
-- policy on users would expose the FULL row (phone, xp, streak,
-- avatar_url, last_active_at, etc.) to any student who shares a section
-- with any teacher — more than needed. Instead of touching users RLS at
-- all, this adds a narrowly-scoped SECURITY DEFINER function that
-- returns ONLY id/full_name/email, and ONLY for teachers who are
-- genuinely assigned (via teacher_assignments) to the CALLING student's
-- OWN CURRENT section (via student_assignments.is_current). The caller
-- cannot pass another student's id — it is always auth.uid() internally.
-- users RLS itself is completely unchanged by this migration.

create or replace function public.get_my_section_teachers()
returns table (teacher_id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct u.id, u.full_name, u.email
  from public.teacher_assignments ta
  join public.student_assignments sa
    on sa.section_id = ta.section_id and sa.is_current
  join public.users u on u.id = ta.teacher_id
  where sa.student_id = auth.uid();
$$;

revoke all on function public.get_my_section_teachers() from public;
revoke all on function public.get_my_section_teachers() from anon;
grant execute on function public.get_my_section_teachers() to authenticated;
