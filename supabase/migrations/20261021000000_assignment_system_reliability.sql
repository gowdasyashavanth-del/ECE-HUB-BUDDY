-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration: Assignment System Reliability
-- Fixes:
-- 1. Corrects assign_student_to_section to derive academic_year_id from
--    the destination section (sections.academic_year_id), not regulation.
-- 2. Adds reassign_student_to_section for atomic student transfers with
--    user row locking and duplicate section assignment checks.
-- 3. Adds end_class_teacher to safely remove a class teacher from a section.
-- 4. Adds unassign_lab_batch to safely remove a student from a lab batch,
--    strictly authorizing against the assignment's own section.
-- 5. Tightens teacher authorization helpers (teacher_has_subject,
--    teacher_has_section, teacher_has_subject_in_section, is_class_teacher_of_section)
--    to ensure demoted/deactivated accounts cannot retain teacher privileges.
-- 6. Adds triggers to automatically end section-dependent CR and lab batch
--    assignments when a student leaves a section or changes role.
-- 7. Adds supporting indexes for student history and active lookups.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Fix assign_student_to_section: use destination section's academic_year_id ──

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

  -- Derive the hierarchy from the section itself: academic_year_id comes
  -- from the destination section (sections.academic_year_id), guaranteeing
  -- the student is placed into the section's active cohort year.
  select s.semester_id, sem.program_id, prog.regulation_id, s.academic_year_id
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


-- ── 2. Create reassign_student_to_section for atomic student transfers ──

create or replace function public.reassign_student_to_section(
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
  v_student_role text;
  v_semester_id uuid;
  v_program_id uuid;
  v_regulation_id uuid;
  v_academic_year_id uuid;
  v_result public.student_assignments;
begin
  if v_caller is null then
    raise exception 'Not authenticated.';
  end if;

  if not public.is_admin() then
    raise exception 'Forbidden: Only Super Admin may reassign students.';
  end if;

  -- Lock student row in public.users to serialize concurrent reassignment requests
  select role into v_student_role from public.users where id = p_student_id for update;
  if v_student_role is null then
    raise exception 'Student account not found.';
  end if;
  if v_student_role <> 'student' then
    raise exception 'The selected account is not a student.';
  end if;

  -- Derive the authoritative hierarchy directly from the destination section
  select s.semester_id, sem.program_id, prog.regulation_id, s.academic_year_id
    into v_semester_id, v_program_id, v_regulation_id, v_academic_year_id
  from public.sections s
  join public.semesters sem on sem.id = s.semester_id
  join public.programs prog on prog.id = sem.program_id
  join public.regulations reg on reg.id = prog.regulation_id
  where s.id = p_section_id;

  if v_semester_id is null then
    raise exception 'Target section not found.';
  end if;

  -- Prevent redundant reassignment to the exact same current section
  if exists (
    select 1 from public.student_assignments
    where student_id = p_student_id and section_id = p_section_id and is_current = true
  ) then
    raise exception 'Student is already assigned to this section.';
  end if;

  -- Lock existing current assignments for this student
  perform 1 from public.student_assignments
  where student_id = p_student_id and is_current
  for update;

  -- End existing current assignments
  update public.student_assignments
  set is_current = false
  where student_id = p_student_id and is_current = true;

  -- Insert new assignment
  insert into public.student_assignments (
    student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current
  ) values (
    p_student_id, v_academic_year_id, v_regulation_id, v_program_id, v_semester_id, p_section_id, true
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.reassign_student_to_section(uuid, uuid) from public;
revoke execute on function public.reassign_student_to_section(uuid, uuid) from anon;
grant execute on function public.reassign_student_to_section(uuid, uuid) to authenticated;


-- ── 3. Create end_class_teacher to safely remove a class teacher from a section ──

create or replace function public.end_class_teacher(p_section_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated.';
  end if;

  if not public.is_admin() then
    raise exception 'Forbidden: Only Super Admin may remove a class teacher.';
  end if;

  perform 1 from public.class_teacher_assignments
  where section_id = p_section_id and is_current = true
  for update;

  update public.class_teacher_assignments
  set is_current = false, ended_at = now()
  where section_id = p_section_id and is_current = true;
end;
$$;

revoke all on function public.end_class_teacher(uuid) from public;
revoke execute on function public.end_class_teacher(uuid) from anon;
grant execute on function public.end_class_teacher(uuid) to authenticated;


-- ── 4. Create unassign_lab_batch to safely unassign a student from a batch ──

create or replace function public.unassign_lab_batch(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_batch_section_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated.';
  end if;

  -- Lock and find the active assignment's section
  select section_id into v_batch_section_id
  from public.student_lab_batch_assignments
  where student_id = p_student_id and is_current = true
  limit 1
  for update;

  -- If no active assignment exists, idempotent no-op
  if v_batch_section_id is null then
    return;
  end if;

  -- Strictly authorize against the assignment's own section:
  -- Only Super Admin or the Class Teacher of that specific section may unassign.
  if not (
    public.is_admin()
    or public.is_class_teacher_of_section(v_batch_section_id)
  ) then
    raise exception 'Forbidden: Only Super Admin or the class teacher of this section may unassign lab batches.';
  end if;

  update public.student_lab_batch_assignments
  set is_current = false, ended_at = now()
  where student_id = p_student_id and is_current = true;
end;
$$;

revoke all on function public.unassign_lab_batch(uuid) from public;
revoke execute on function public.unassign_lab_batch(uuid) from anon;
grant execute on function public.unassign_lab_batch(uuid) to authenticated;


-- ── 5. Tighten authorization helpers with role validation ──

create or replace function public.teacher_has_subject(p_subject_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.teacher_assignments ta
    join public.users u on u.id = ta.teacher_id
    where ta.teacher_id = auth.uid()
      and ta.subject_id = p_subject_id
      and u.role in ('teacher', 'super_admin')
  );
$$;

create or replace function public.teacher_has_section(p_section_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.teacher_assignments ta
    join public.users u on u.id = ta.teacher_id
    where ta.teacher_id = auth.uid()
      and ta.section_id = p_section_id
      and u.role in ('teacher', 'super_admin')
  );
$$;

create or replace function public.teacher_has_subject_in_section(p_subject_id uuid, p_section_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.teacher_assignments ta
    join public.users u on u.id = ta.teacher_id
    where ta.teacher_id = auth.uid()
      and ta.subject_id = p_subject_id
      and ta.section_id = p_section_id
      and u.role in ('teacher', 'super_admin')
  );
$$;

create or replace function public.is_class_teacher_of_section(p_section_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.class_teacher_assignments cta
    join public.users u on u.id = cta.teacher_id
    where cta.teacher_id = auth.uid()
      and cta.section_id = p_section_id
      and cta.is_current = true
      and u.role in ('teacher', 'super_admin')
  );
$$;

revoke all on function public.teacher_has_subject(uuid) from public;
grant execute on function public.teacher_has_subject(uuid) to authenticated;

revoke all on function public.teacher_has_section(uuid) from public;
grant execute on function public.teacher_has_section(uuid) to authenticated;

revoke all on function public.teacher_has_subject_in_section(uuid, uuid) from public;
grant execute on function public.teacher_has_subject_in_section(uuid, uuid) to authenticated;

revoke all on function public.is_class_teacher_of_section(uuid) from public;
grant execute on function public.is_class_teacher_of_section(uuid) to authenticated;


-- ── 5b. Update validation triggers to allow assignment termination (is_current = false) ──
-- Legacy BEFORE INSERT OR UPDATE validation triggers on class_teacher_assignments,
-- cr_designations, and student_lab_batch_assignments checked student_currently_in_section
-- or users.role unconditionally. When a student is transferred or a teacher role changes,
-- cascading updates set is_current = false. These triggers must only enforce active
-- enrollment / role constraints when NEW.is_current is TRUE.

create or replace function public.validate_class_teacher_assignment() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.is_current then
    if (select role from public.users where id = new.teacher_id) <> 'teacher' then
      raise exception 'class teacher must be an account with role = teacher';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_cr_designation() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.is_current then
    if (select role from public.users where id = new.student_id) <> 'student' then
      raise exception 'CR designation must be assigned to a student account.';
    end if;
    if not public.student_currently_in_section(new.student_id, new.section_id) then
      raise exception 'Student is not currently assigned to this section.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_student_lab_batch_assignment() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_batch_section uuid;
begin
  select section_id into v_batch_section from public.lab_batches where id = new.lab_batch_id;
  if v_batch_section is null then
    raise exception 'Lab batch not found.';
  end if;
  if v_batch_section <> new.section_id then
    raise exception 'This lab batch does not belong to the given section.';
  end if;
  if new.is_current then
    if (select role from public.users where id = new.student_id) <> 'student' then
      raise exception 'Lab batch must be assigned to a student account.';
    end if;
    if not public.student_currently_in_section(new.student_id, new.section_id) then
      raise exception 'Student is not currently assigned to this section.';
    end if;
  end if;
  return new;
end;
$$;


-- ── 6. Triggers for cascading invalidation of dependent assignments ──

-- When a student is transferred or unassigned, end their dependent CR and Lab Batch
-- assignments belonging strictly to the OLD section.
create or replace function public.trg_handle_student_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (TG_OP = 'UPDATE') then
    if (OLD.is_current = true and (NEW.is_current = false or OLD.section_id is distinct from NEW.section_id)) then
      -- End CR designations strictly for OLD.section_id
      update public.cr_designations
      set is_current = false, ended_at = coalesce(ended_at, now())
      where student_id = OLD.student_id
        and section_id = OLD.section_id
        and is_current = true;

      -- End Lab Batch assignments strictly for OLD.section_id
      update public.student_lab_batch_assignments
      set is_current = false, ended_at = coalesce(ended_at, now())
      where student_id = OLD.student_id
        and section_id = OLD.section_id
        and is_current = true;
    end if;
  elsif (TG_OP = 'DELETE') then
    if (OLD.is_current = true) then
      update public.cr_designations
      set is_current = false, ended_at = coalesce(ended_at, now())
      where student_id = OLD.student_id
        and section_id = OLD.section_id
        and is_current = true;

      update public.student_lab_batch_assignments
      set is_current = false, ended_at = coalesce(ended_at, now())
      where student_id = OLD.student_id
        and section_id = OLD.section_id
        and is_current = true;
    end if;
    return OLD;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_student_assignment_section_change on public.student_assignments;
create trigger trg_student_assignment_section_change
after update of is_current, section_id or delete on public.student_assignments
for each row execute function public.trg_handle_student_assignment_change();

-- When a user role changes, end assignments incompatible with the new role.
create or replace function public.trg_handle_user_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (TG_OP = 'UPDATE' and OLD.role is distinct from NEW.role) then
    -- Demoted teacher/admin to student: end active class teacher assignments
    if (OLD.role in ('teacher', 'super_admin') and NEW.role = 'student') then
      update public.class_teacher_assignments
      set is_current = false, ended_at = coalesce(ended_at, now())
      where teacher_id = NEW.id and is_current = true;
    end if;

    -- Student promoted to teacher/admin: end active CR and lab batch assignments
    -- Note: academic enrollment history in student_assignments is PRESERVED.
    if (OLD.role = 'student' and NEW.role in ('teacher', 'super_admin')) then
      update public.cr_designations
      set is_current = false, ended_at = coalesce(ended_at, now())
      where student_id = NEW.id and is_current = true;

      update public.student_lab_batch_assignments
      set is_current = false, ended_at = coalesce(ended_at, now())
      where student_id = NEW.id and is_current = true;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_user_role_change_assignment_cleanup on public.users;
create trigger trg_user_role_change_assignment_cleanup
after update of role on public.users
for each row execute function public.trg_handle_user_role_change();


-- ── 7. Supporting indexes for history and active lookups ──

create index if not exists idx_student_assignments_student_history
  on public.student_assignments (student_id, created_at desc);

create index if not exists idx_class_teacher_assignments_active
  on public.class_teacher_assignments (section_id)
  where is_current = true;

create index if not exists idx_student_lab_batch_assignments_student_active
  on public.student_lab_batch_assignments (student_id)
  where is_current = true;
