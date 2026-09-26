-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 20: Teacher-scoped student assignment
--
-- Adds the DB-side authorization for the Teacher Portal's new
-- "Assign Student" workflow. student_assignments already has a correct
-- SELECT policy (teachers can see students in a section they're
-- assigned to) but WRITE is currently admin-only
-- (student_assignments_write_admin_only). Rather than loosening that
-- blanket write policy for teachers — which would let a teacher's
-- client write ANY row, not just their own section's — this adds one
-- narrow SECURITY DEFINER RPC that:
--   1. requires an authenticated caller whose role is teacher/super_admin
--   2. for teachers, requires teacher_assignments to actually contain
--      the requested section (the same authorization boundary already
--      enforced for content access)
--   3. requires the target account to actually be a student
--   4. derives academic_year_id/regulation_id/program_id/semester_id
--      itself from the section's own parent chain — never from
--      whatever the browser sent
--   5. refuses if the student already has a current assignment
--      (teachers do not reassign — Super Admin already can, via the
--      existing admin UI's direct table writes, unchanged by this
--      migration)
-- No new tables. No Branch. No service-role usage — this is exactly
-- the "secure RPC" alternative the existing 15_secure_test_assessment_
-- system.sql already established the pattern for.
-- ═══════════════════════════════════════════════════════════════════════

-- true if the calling teacher is assigned to ANY subject in this
-- section (teacher_assignments rows are per section+subject, and a
-- teacher managing any subject in a section is treated as authorized
-- to see/manage the section's roster — mirrors how the existing
-- Teacher Dashboard groups a teacher's assignments by section).
create or replace function public.teacher_has_section(p_section_id uuid) returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.teacher_assignments
    where teacher_id = auth.uid() and section_id = p_section_id
  );
$$;

create or replace function public.assign_student_to_section(
  p_student_id uuid,
  p_section_id uuid
)
returns public.student_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role text := public.current_role();
  v_student_role text;
  v_existing record;
  v_semester_id uuid;
  v_program_id uuid;
  v_regulation_id uuid;
  v_academic_year_id uuid;
  v_result public.student_assignments;
begin
  if v_caller is null then
    raise exception 'Not authenticated.';
  end if;

  if v_caller_role not in ('teacher', 'super_admin') then
    raise exception 'Only a teacher or Super Admin may assign students.';
  end if;

  if v_caller_role = 'teacher' and not public.teacher_has_section(p_section_id) then
    raise exception 'You are not assigned to this section.';
  end if;

  select role into v_student_role from public.users where id = p_student_id;
  if v_student_role is null then
    raise exception 'Student account not found.';
  end if;
  if v_student_role <> 'student' then
    raise exception 'The selected account is not a student.';
  end if;

  -- Derive the hierarchy from the section itself — the only thing the
  -- caller supplies is p_section_id (and that's already authorization-
  -- checked above for teachers). academic_year_id specifically comes
  -- from the section's regulation chain (semester -> program ->
  -- regulation -> academic_year), not the section's own denormalized
  -- academic_year_id column, so this can't drift from the canonical
  -- hierarchy even if that cached column were ever stale.
  select s.semester_id, sem.program_id, prog.regulation_id, reg.academic_year_id
    into v_semester_id, v_program_id, v_regulation_id, v_academic_year_id
  from public.sections s
  join public.semesters sem on sem.id = s.semester_id
  join public.programs prog on prog.id = sem.program_id
  join public.regulations reg on reg.id = prog.regulation_id
  where s.id = p_section_id;

  if v_semester_id is null then
    raise exception 'Section not found.';
  end if;

  select * into v_existing from public.student_assignments
  where student_id = p_student_id and is_current
  for update;

  if found then
    if v_existing.section_id = p_section_id then
      raise exception 'This student is already assigned to this section.';
    end if;
    raise exception 'This student already has a current section assignment. Ask your Super Admin to reassign them.';
  end if;

  insert into public.student_assignments (
    student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current
  ) values (
    p_student_id, v_academic_year_id, v_regulation_id, v_program_id, v_semester_id, p_section_id, true
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.assign_student_to_section(uuid, uuid) from public;
revoke execute on function public.assign_student_to_section(uuid, uuid) from anon;
grant execute on function public.assign_student_to_section(uuid, uuid) to authenticated;

revoke all on function public.teacher_has_section(uuid) from public;
revoke execute on function public.teacher_has_section(uuid) from anon;
grant execute on function public.teacher_has_section(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 20.
-- ═══════════════════════════════════════════════════════════════════════
