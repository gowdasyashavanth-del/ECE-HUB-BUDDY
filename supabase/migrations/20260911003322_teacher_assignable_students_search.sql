-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 20b: Assignable-student search for teachers
--
-- users_select_own_or_admin_or_teacher (10_rls_core.sql) intentionally
-- only lets a teacher see a student row once that student is ALREADY
-- currently assigned to one of the teacher's sections — a teacher can't
-- browse the wider student directory. That's correct and stays
-- unchanged. But it means the new "Assign Student" search box has
-- nothing to query against for a student who isn't assigned anywhere
-- yet. This adds one minimal-field SECURITY DEFINER RPC for exactly
-- that: teachers/admins search by name/email and get back only
-- id/full_name/email, only for students with no current section
-- assignment. It does not expose which (if any) other section a
-- student is in, or any other profile field.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.search_assignable_students(p_query text default '')
returns table (id uuid, full_name text, email text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if public.current_role() not in ('teacher', 'super_admin') then
    raise exception 'Only a teacher or Super Admin may search for students to assign.';
  end if;

  return query
  select u.id, u.full_name, u.email
  from public.users u
  where u.role = 'student'
    and not exists (
      select 1 from public.student_assignments sa
      where sa.student_id = u.id and sa.is_current
    )
    and (
      p_query = '' or
      u.full_name ilike '%' || p_query || '%' or
      u.email ilike '%' || p_query || '%'
    )
  order by u.full_name
  limit 20;
end;
$$;

revoke all on function public.search_assignable_students(text) from public;
revoke execute on function public.search_assignable_students(text) from anon;
grant execute on function public.search_assignable_students(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 20b.
-- ═══════════════════════════════════════════════════════════════════════
