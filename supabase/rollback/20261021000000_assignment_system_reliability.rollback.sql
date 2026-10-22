-- ============================================================================
-- ROLLBACK SCRIPT: 20261021000000_assignment_system_reliability.sql
-- ============================================================================

BEGIN;

-- ── 1. Drop newly introduced triggers and trigger functions ──
DROP TRIGGER IF EXISTS trg_student_assignment_section_change ON public.student_assignments;
DROP FUNCTION IF EXISTS public.trg_handle_student_assignment_change();

DROP TRIGGER IF EXISTS trg_user_role_change_assignment_cleanup ON public.users;
DROP FUNCTION IF EXISTS public.trg_handle_user_role_change();

-- ── 2. Drop newly introduced RPCs ──
DROP FUNCTION IF EXISTS public.reassign_student_to_section(uuid, uuid);
DROP FUNCTION IF EXISTS public.end_class_teacher(uuid);
DROP FUNCTION IF EXISTS public.unassign_lab_batch(uuid);

-- ── 3. Drop newly introduced performance indexes ──
DROP INDEX IF EXISTS public.idx_student_assignments_student_history;
DROP INDEX IF EXISTS public.idx_class_teacher_assignments_active;
DROP INDEX IF EXISTS public.idx_student_lab_batch_assignments_student_active;

-- ── 4. Restore assign_student_to_section ──
-- Source: 20260910154057_teacher_student_assignment.sql (lines 43-126)
CREATE OR REPLACE FUNCTION public.assign_student_to_section(
  p_student_id uuid,
  p_section_id uuid
)
RETURNS public.student_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_role text := public.current_role();
  v_student_role text;
  v_existing record;
  v_semester_id uuid;
  v_program_id uuid;
  v_regulation_id uuid;
  v_academic_year_id uuid;
  v_result public.student_assignments;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF v_caller_role NOT IN ('teacher', 'super_admin') THEN
    RAISE EXCEPTION 'Only a teacher or Super Admin may assign students.';
  END IF;

  IF v_caller_role = 'teacher' AND NOT public.teacher_has_section(p_section_id) THEN
    RAISE EXCEPTION 'You are not assigned to this section.';
  END IF;

  SELECT role INTO v_student_role FROM public.users WHERE id = p_student_id;
  IF v_student_role IS NULL THEN
    RAISE EXCEPTION 'Student account not found.';
  END IF;
  IF v_student_role <> 'student' THEN
    RAISE EXCEPTION 'The selected account is not a student.';
  END IF;

  SELECT s.semester_id, sem.program_id, prog.regulation_id, reg.academic_year_id
    INTO v_semester_id, v_program_id, v_regulation_id, v_academic_year_id
  FROM public.sections s
  JOIN public.semesters sem ON sem.id = s.semester_id
  JOIN public.programs prog ON prog.id = sem.program_id
  JOIN public.regulations reg ON reg.id = prog.regulation_id
  WHERE s.id = p_section_id;

  IF v_semester_id IS NULL THEN
    RAISE EXCEPTION 'Section not found.';
  END IF;

  SELECT * INTO v_existing FROM public.student_assignments
  WHERE student_id = p_student_id AND is_current
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.section_id = p_section_id THEN
      RAISE EXCEPTION 'This student is already assigned to this section.';
    END IF;
    RAISE EXCEPTION 'This student already has a current section assignment. Ask your Super Admin to reassign them.';
  END IF;

  INSERT INTO public.student_assignments (
    student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current
  ) VALUES (
    p_student_id, v_academic_year_id, v_regulation_id, v_program_id, v_semester_id, p_section_id, true
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_student_to_section(uuid, uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.assign_student_to_section(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_student_to_section(uuid, uuid) TO authenticated;

-- ── 5. Restore teacher_has_subject ──
-- Source: 20260831004733_08_security_functions.sql (lines 26-33)
CREATE OR REPLACE FUNCTION public.teacher_has_subject(p_subject_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_assignments
    WHERE teacher_id = auth.uid() AND subject_id = p_subject_id
  );
$$;

REVOKE ALL ON FUNCTION public.teacher_has_subject(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.teacher_has_subject(uuid) TO authenticated;

-- ── 6. Restore teacher_has_section ──
-- Source: 20260910154057_teacher_student_assignment.sql (lines 34-41, 128-130)
CREATE OR REPLACE FUNCTION public.teacher_has_section(p_section_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_assignments
    WHERE teacher_id = auth.uid() AND section_id = p_section_id
  );
$$;

REVOKE ALL ON FUNCTION public.teacher_has_section(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.teacher_has_section(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_has_section(uuid) TO authenticated;

-- ── 7. Restore teacher_has_subject_in_section ──
-- Source: 20260919153622_notes_module.sql (lines 59-69)
CREATE OR REPLACE FUNCTION public.teacher_has_subject_in_section(p_subject_id uuid, p_section_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_assignments
    WHERE teacher_id = auth.uid() AND subject_id = p_subject_id AND section_id = p_section_id
  );
$$;

REVOKE ALL ON FUNCTION public.teacher_has_subject_in_section(uuid, uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.teacher_has_subject_in_section(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_has_subject_in_section(uuid, uuid) TO authenticated;

-- ── 8. Restore is_class_teacher_of_section ──
-- Source: 20260912064843_academic_operations_foundation.sql (lines 101-112)
CREATE OR REPLACE FUNCTION public.is_class_teacher_of_section(p_section_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.class_teacher_assignments
    WHERE teacher_id = auth.uid() AND section_id = p_section_id AND is_current
  );
$$;

REVOKE ALL ON FUNCTION public.is_class_teacher_of_section(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.is_class_teacher_of_section(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_class_teacher_of_section(uuid) TO authenticated;

-- ── 9. Restore validation triggers and trigger functions ──
-- Source: 20260912064843_academic_operations_foundation.sql

-- 9a. Class Teacher validation
CREATE OR REPLACE FUNCTION public.validate_class_teacher_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT role FROM public.users WHERE id = NEW.teacher_id) <> 'teacher' THEN
    RAISE EXCEPTION 'class teacher must be an account with role = teacher';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS class_teacher_assignments_validate ON public.class_teacher_assignments;
CREATE TRIGGER class_teacher_assignments_validate
  BEFORE INSERT OR UPDATE ON public.class_teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_class_teacher_assignment();

-- 9b. CR Designation validation
CREATE OR REPLACE FUNCTION public.validate_cr_designation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT role FROM public.users WHERE id = NEW.student_id) <> 'student' THEN
    RAISE EXCEPTION 'CR designation must be assigned to a student account.';
  END IF;
  IF NOT public.student_currently_in_section(NEW.student_id, NEW.section_id) THEN
    RAISE EXCEPTION 'Student is not currently assigned to this section.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cr_designations_validate ON public.cr_designations;
CREATE TRIGGER cr_designations_validate
  BEFORE INSERT OR UPDATE ON public.cr_designations
  FOR EACH ROW EXECUTE FUNCTION public.validate_cr_designation();

-- 9c. Student Lab Batch Assignment validation
CREATE OR REPLACE FUNCTION public.validate_student_lab_batch_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_section uuid;
BEGIN
  SELECT section_id INTO v_batch_section FROM public.lab_batches WHERE id = NEW.lab_batch_id;
  IF v_batch_section IS NULL THEN
    RAISE EXCEPTION 'Lab batch not found.';
  END IF;
  IF v_batch_section <> NEW.section_id THEN
    RAISE EXCEPTION 'This lab batch does not belong to the given section.';
  END IF;
  IF (SELECT role FROM public.users WHERE id = NEW.student_id) <> 'student' THEN
    RAISE EXCEPTION 'Lab batch must be assigned to a student account.';
  END IF;
  IF NOT public.student_currently_in_section(NEW.student_id, NEW.section_id) THEN
    RAISE EXCEPTION 'Student is not currently assigned to this section.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS student_lab_batch_assignments_validate ON public.student_lab_batch_assignments;
CREATE TRIGGER student_lab_batch_assignments_validate
  BEFORE INSERT OR UPDATE ON public.student_lab_batch_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_student_lab_batch_assignment();

COMMIT;
