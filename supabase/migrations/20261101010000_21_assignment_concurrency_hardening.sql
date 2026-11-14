-- ============================================================================
-- ECE Hub Buddy — Migration 21: Assignment Concurrency Hardening
--
-- Scope: Narrowly scoped follow-up to Migration 19 (assignment_system_reliability).
-- No new tables, columns, indexes, or RLS policies are added.
--
-- Changes:
--   A. assign_student_to_section     — lock student users row BEFORE checking
--      student_assignments, matching the strategy already in
--      reassign_student_to_section (Migration 19).
--   B. assign_class_teacher          — lock teacher users row, then the
--      destination sections row (via PERFORM 1 ... FOR UPDATE), before ending
--      the old assignment and inserting the new one.
--   C. end_class_teacher             — lock the sections row (via PERFORM 1
--      ... FOR UPDATE) before ending the current class_teacher_assignments row.
--   D. trg_handle_user_role_change   — when demoting a teacher, acquire
--      section locks (in deterministic id ASC order) before updating
--      class_teacher_assignments, keeping lock order consistent with the
--      assignment functions above. The existing trigger attachment on
--      public.users is left untouched.
--   E. Close direct-write bypass      — drop class_teacher_assignments_write_admin_only
--      so authenticated clients cannot bypass assign_class_teacher() and
--      end_class_teacher() with raw table writes. SECURITY DEFINER RPCs
--      retain write ability while class_teacher_assignments_select is preserved.
--
-- Audited lock order for student and class-teacher assignment paths:
--   public.users row  →  public.sections row(s) (id ASC)
--   →  public.class_teacher_assignments / student_assignments rows
--
-- Note on lock hierarchy scope:
--   This lock hierarchy is verified for the student assignment, class-teacher
--   assignment, and role-change paths audited in Migrations 19 and 21. Other
--   unrelated write paths across the database were not part of this audit
--   and are not claimed to follow this hierarchy.
--
-- Permissions note:
--   Explicit REVOKE and GRANT statements are omitted. PostgreSQL preserves
--   existing function ownership and execution privileges (ACLs) across
--   CREATE OR REPLACE FUNCTION.
--
-- Deadlock analysis: see inline comment block below.
-- ============================================================================

-- ============================================================================
-- DEADLOCK ANALYSIS (AUDITED ASSIGNMENT PATHS)
--
-- All mutating paths in this subsystem follow a strict hierarchy:
--   Level 1: public.users row    (FOR UPDATE on the actor or subject row)
--   Level 2: public.sections row (FOR UPDATE on the affected section)
--   Level 3: assignment rows     (class_teacher_assignments, student_assignments)
--
-- Path inventory and lock order:
--
--   assign_student_to_section(student, section)
--     L1: users(student_id) FOR UPDATE
--     L2: — (no section lock needed; sections is read-only here via JOIN)
--     L3: student_assignments FOR UPDATE (via existing PERFORM...FOR UPDATE)
--
--   reassign_student_to_section(student, section)   [from Migration 19, unchanged]
--     L1: users(student_id) FOR UPDATE
--     L2: — (read-only hierarchy join)
--     L3: student_assignments FOR UPDATE
--
--   assign_class_teacher(teacher, section)
--     L1: users(teacher_id) FOR UPDATE
--     L2: sections(section_id) FOR UPDATE (via PERFORM 1 ... FOR UPDATE)
--     L3: class_teacher_assignments (UPDATE then INSERT)
--
--   end_class_teacher(section)
--     L2: sections(section_id) FOR UPDATE (via PERFORM 1 ... FOR UPDATE)
--     L3: class_teacher_assignments (PERFORM ... FOR UPDATE, then UPDATE)
--     (no user row locked — caller already authenticated, no user mutation)
--
--   trg_handle_user_role_change()   [AFTER UPDATE OF role trigger on users]
--     L1: users row held implicitly by the outer UPDATE that fired the trigger
--     L2: sections rows FOR UPDATE, acquired in section_id ASC order
--     L3: class_teacher_assignments (UPDATE)
--
-- Cross-path analysis:
--
--   assign_class_teacher vs end_class_teacher:
--     assign_class_teacher takes L1 then L2.
--     end_class_teacher takes L2 only.
--     Because end_class_teacher never acquires an L1 user lock, there is no
--     reverse locking path (sections → users). Safe.
--
--   assign_class_teacher vs trg_handle_user_role_change:
--     Both take L1 then L2. If both target the same teacher row, the trigger
--     already holds the user lock (L1) from the outer UPDATE; assign_class_teacher
--     blocks at L1. No reversal — safe.
--
--   end_class_teacher vs trg_handle_user_role_change:
--     end_class_teacher takes L2 (sections). The trigger holds L1 and then
--     requests L2 in id ASC order. If end_class_teacher holds L2 on a section
--     that the trigger needs, the trigger waits for L2. Because end_class_teacher
--     never requests L1, no cycle can form. Safe.
--
--   Two concurrent assign_class_teacher calls for the same section:
--     Both attempt L1 on their respective teacher rows, then L2 on the same
--     section row. The second caller serializes at L2. No deadlock.
--
--   assign_student_to_section vs reassign_student_to_section (same student):
--     Both lock L1 (same student row). The second caller waits at L1. Safe.
--
--   Remaining architectural requirement:
--     end_class_teacher does NOT lock a user row. To avoid deadlock, any future
--     database function or trigger must NEVER lock a public.users row after
--     locking a public.sections row.
-- ============================================================================


-- ============================================================================
-- A. assign_student_to_section
--    Change: lock the student's users row with FOR UPDATE before performing
--    the student-role validation and the student_assignments FOR UPDATE.
--    This matches reassign_student_to_section and closes the race window
--    where two concurrent first-time assignments for the same student could
--    both pass the check before either inserts.
--    All other behavior, return type, and SECURITY DEFINER preserved.
--    Existing EXECUTE ACLs preserved via CREATE OR REPLACE FUNCTION.
-- ============================================================================

create or replace function public.assign_student_to_section(
  p_student_id uuid,
  p_section_id uuid
)
returns public.student_assignments
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller      uuid := auth.uid();
  v_caller_role text := public.current_role();
  v_student_role text;
  v_existing    record;
  v_semester_id uuid;
  v_program_id  uuid;
  v_regulation_id uuid;
  v_academic_year_id uuid;
  v_result      public.student_assignments;
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

  -- Lock the student row first (Level 1) to serialise concurrent first-time
  -- assignment attempts for the same student. Role validation happens after
  -- the lock so a concurrent role-change cannot race past this check.
  select role
    into v_student_role
  from public.users
  where id = p_student_id
  for update;

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

  -- Lock the current assignment row (Level 3) to guard against a concurrent
  -- reassign_student_to_section running in parallel.
  select * into v_existing
  from public.student_assignments
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


-- ============================================================================
-- B. assign_class_teacher
--    Change: lock teacher users row (L1), validate role, then lock destination
--    sections row via PERFORM 1 ... FOR UPDATE (L2), followed by IF NOT FOUND
--    handling. Deactivate existing assignment and insert new assignment (L3).
--    Return type, authorization, and SECURITY DEFINER preserved.
--    Existing EXECUTE ACLs preserved via CREATE OR REPLACE FUNCTION.
-- ============================================================================

create or replace function public.assign_class_teacher(
  p_teacher_id uuid,
  p_section_id uuid
)
returns public.class_teacher_assignments
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_teacher_role text;
  v_result       public.class_teacher_assignments;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  if not public.is_admin() then
    raise exception 'Only Super Admin may assign a class teacher.';
  end if;

  -- Level 1: lock teacher row to serialise concurrent role changes and
  -- concurrent assign_class_teacher calls for the same teacher.
  select role
    into v_teacher_role
  from public.users
  where id = p_teacher_id
  for update;

  if v_teacher_role is null then
    raise exception 'Teacher account not found.';
  end if;
  if v_teacher_role <> 'teacher' then
    raise exception 'Selected account is not a teacher.';
  end if;

  -- Level 2: lock the destination section row to serialise concurrent
  -- class-teacher assignments to the same section.
  perform 1
  from public.sections
  where id = p_section_id
  for update;

  if not found then
    raise exception 'Section not found.';
  end if;

  -- Level 3: end existing current assignment, then insert the new one.
  update public.class_teacher_assignments
    set is_current = false, ended_at = now()
  where section_id = p_section_id and is_current;

  insert into public.class_teacher_assignments (teacher_id, section_id, assigned_by, is_current)
  values (p_teacher_id, p_section_id, auth.uid(), true)
  returning * into v_result;

  return v_result;
end;
$$;


-- ============================================================================
-- C. end_class_teacher
--    Change: lock destination sections row via PERFORM 1 ... FOR UPDATE (L2).
--    If NOT FOUND, return (no-op) preserving original behavior for nonexistent
--    sections. If found, lock and end current class_teacher_assignments (L3).
--    Preserves authorization, void return, and SECURITY DEFINER.
--    Existing EXECUTE ACLs preserved via CREATE OR REPLACE FUNCTION.
-- ============================================================================

create or replace function public.end_class_teacher(p_section_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
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

  -- Level 2: lock the destination section row before touching class_teacher_assignments.
  -- This serialises concurrent end_class_teacher and assign_class_teacher calls on the section.
  perform 1
  from public.sections
  where id = p_section_id
  for update;

  if not found then
    -- Nonexistent section: no-op to preserve existing behavior (returns void)
    return;
  end if;

  -- Level 3: lock and end the current assignment.
  perform 1
  from public.class_teacher_assignments
  where section_id = p_section_id and is_current = true
  for update;

  update public.class_teacher_assignments
    set is_current = false, ended_at = now()
  where section_id = p_section_id and is_current = true;
end;
$$;


-- ============================================================================
-- D. trg_handle_user_role_change
--    Change: when demoting a teacher/admin to student, acquire affected section
--    locks in deterministic section_id ASC order (L2) before updating
--    class_teacher_assignments. The users row is already held by the outer UPDATE
--    that fired the trigger (L1), maintaining the users -> sections lock order.
--    All other branches (student -> teacher/admin promotion) are unchanged.
--
--    Concurrency & Snapshot Visibility Analysis:
--    1. Cannot omit concurrently created assignments:
--       Any call to assign_class_teacher(NEW.id, section_id) must acquire
--       users(NEW.id) FOR UPDATE (Level 1) before inspecting or writing
--       class_teacher_assignments. Because the outer UPDATE public.users already
--       holds an exclusive row lock on users(NEW.id), any concurrent
--       assign_class_teacher call for this user is blocked at Level 1 until this
--       demotion transaction commits or rolls back. Once unblocked, that call
--       sees role = 'student' and immediately raises 'Selected account is not
--       a teacher.' without inserting any row.
--    2. Stale section IDs in v_section_ids are benign:
--       If another transaction ended or displaced this teacher's assignment on a
--       section (via end_class_teacher or assign_class_teacher with a new teacher)
--       before this trigger locks the section, the section lock (Level 2) serialises
--       cleanly. The subsequent UPDATE public.class_teacher_assignments runs under
--       Read Committed semantics and simply updates 0 rows for that already-ended
--       assignment, leaving the new holder's row untouched.
--
--    Trigger attachment note:
--    The existing trigger `trg_user_role_change_assignment_cleanup` on `public.users`
--    is left untouched. In PostgreSQL, replacing the underlying function automatically
--    binds to the existing trigger without dropping/recreating it or resetting its state.
-- ============================================================================

create or replace function public.trg_handle_user_role_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_section_ids uuid[];
begin
  if (TG_OP = 'UPDATE' and OLD.role is distinct from NEW.role) then

    -- Demoted teacher/admin -> student: end class-teacher and subject assignments.
    if (OLD.role in ('teacher', 'super_admin') and NEW.role = 'student') then

      -- Collect the section IDs where this teacher is currently a class teacher.
      select array_agg(section_id order by section_id)
        into v_section_ids
      from public.class_teacher_assignments
      where teacher_id = NEW.id and is_current = true;

      -- Level 2: lock those section rows in deterministic id ASC order to
      -- prevent deadlock with concurrent assign_class_teacher / end_class_teacher
      -- calls that also lock sections before touching class_teacher_assignments.
      if v_section_ids is not null then
        perform 1
        from public.sections
        where id = any(v_section_ids)
        order by id
        for update;
      end if;

      -- Level 3: safe to end assignments.
      update public.class_teacher_assignments
        set is_current = false, ended_at = coalesce(ended_at, now())
      where teacher_id = NEW.id and is_current = true;

      delete from public.teacher_assignments
      where teacher_id = NEW.id;
    end if;

    -- Student promoted to teacher/admin: end active CR and lab batch assignments.
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

-- ============================================================================
-- E. Close direct-write bypass on class_teacher_assignments
--    The application manages class-teacher assignments exclusively through
--    the SECURITY DEFINER RPCs assign_class_teacher() and end_class_teacher().
--    Dropping the class_teacher_assignments_write_admin_only policy ensures that
--    authenticated clients cannot bypass these RPCs with direct INSERT, UPDATE,
--    or DELETE statements on class_teacher_assignments.
--    The SELECT policy (class_teacher_assignments_select) remains active.
-- ============================================================================

drop policy if exists class_teacher_assignments_write_admin_only on public.class_teacher_assignments;

-- ============================================================================
-- End of Migration 21.
-- ============================================================================
