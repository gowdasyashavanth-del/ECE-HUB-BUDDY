-- ============================================================================
-- ECE HUB BUDDY — ASSIGNMENT RELIABILITY VERIFICATION TEST SUITE
-- Target: Disposable local/staging test database (NEVER execute in production)
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

RAISE NOTICE '=== TEST 1: SETUP TEST FIXTURES ===';
-- Create temporary test users, academic hierarchy, and entities
DO $$
DECLARE
  v_year_id uuid;
  v_reg_id uuid;
  v_prog_id uuid;
  v_sem_id uuid;
  v_sec_a_id uuid;
  v_sec_b_id uuid;
  v_sub_id uuid;
  v_batch_a_id uuid;
  v_teacher_id uuid;
  v_student_id uuid;
  v_assignment public.student_assignments;
  v_active_ct_count integer;
  v_active_ta_count integer;
  v_active_cr_count integer;
  v_active_lb_count integer;
BEGIN
  -- Insert Academic Structure
  INSERT INTO public.academic_years (id, name, is_current)
  VALUES ('11111111-1111-1111-1111-111111111111', 'TEST-YEAR-2026', false)
  ON CONFLICT (name) DO UPDATE SET is_current = false
  RETURNING id INTO v_year_id;

  INSERT INTO public.regulations (id, academic_year_id, name, is_active)
  VALUES ('22222222-2222-2222-2222-222222222222', v_year_id, 'TEST-REG', true)
  RETURNING id INTO v_reg_id;

  INSERT INTO public.programs (id, regulation_id, name, code, is_active)
  VALUES ('33333333-3333-3333-3333-333333333333', v_reg_id, 'TEST-PROG', 'TST', true)
  RETURNING id INTO v_prog_id;

  INSERT INTO public.semesters (id, program_id, number, name)
  VALUES ('44444444-4444-4444-4444-444444444444', v_prog_id, 3, 'Semester 3')
  RETURNING id INTO v_sem_id;

  INSERT INTO public.sections (id, semester_id, academic_year_id, name)
  VALUES ('55555555-5555-5555-5555-555555555551', v_sem_id, v_year_id, 'A')
  RETURNING id INTO v_sec_a_id;

  INSERT INTO public.sections (id, semester_id, academic_year_id, name)
  VALUES ('55555555-5555-5555-5555-555555555552', v_sem_id, v_year_id, 'B')
  RETURNING id INTO v_sec_b_id;

  INSERT INTO public.subjects (id, semester_id, name, code)
  VALUES ('66666666-6666-6666-6666-666666666666', v_sem_id, 'Test Subject', 'TST301')
  RETURNING id INTO v_sub_id;

  INSERT INTO public.lab_batches (id, section_id, name)
  VALUES ('77777777-7777-7777-7777-777777777777', v_sec_a_id, 'Batch A1')
  RETURNING id INTO v_batch_a_id;

  -- Create Test Users
  INSERT INTO public.users (id, email, role)
  VALUES ('88888888-8888-8888-8888-888888888888', 'test_teacher@bgsit.ac.in', 'teacher')
  RETURNING id INTO v_teacher_id;

  INSERT INTO public.users (id, email, role)
  VALUES ('99999999-9999-9999-9999-999999999999', 'test_student@bgsit.ac.in', 'student')
  RETURNING id INTO v_student_id;

  -- Assign Teacher to Subject/Section and Class Teacher
  INSERT INTO public.teacher_assignments (teacher_id, section_id, subject_id)
  VALUES (v_teacher_id, v_sec_a_id, v_sub_id);

  INSERT INTO public.class_teacher_assignments (teacher_id, section_id, is_current)
  VALUES (v_teacher_id, v_sec_a_id, true);

  -- Assign Student to Section A
  INSERT INTO public.student_assignments (student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current)
  VALUES (v_student_id, v_year_id, v_reg_id, v_prog_id, v_sem_id, v_sec_a_id, true);

  -- Assign Student as CR and to Lab Batch
  INSERT INTO public.cr_designations (student_id, section_id, slot, is_current)
  VALUES (v_student_id, v_sec_a_id, 1, true);

  INSERT INTO public.student_lab_batch_assignments (student_id, lab_batch_id, section_id, is_current)
  VALUES (v_student_id, v_batch_a_id, v_sec_a_id, true);

  RAISE NOTICE '=== TEST 2: VERIFY SECTION TRANSFER CASCADING CLEANUP ===';
  -- Transfer student from Section A to Section B
  UPDATE public.student_assignments
  SET is_current = false
  WHERE student_id = v_student_id AND is_current = true;

  INSERT INTO public.student_assignments (student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current)
  VALUES (v_student_id, v_year_id, v_reg_id, v_prog_id, v_sem_id, v_sec_b_id, true);

  -- Verify trigger ended CR and Lab Batch for Section A
  SELECT count(*) INTO v_active_cr_count
  FROM public.cr_designations
  WHERE student_id = v_student_id AND section_id = v_sec_a_id AND is_current = true;

  IF v_active_cr_count <> 0 THEN
    RAISE EXCEPTION 'CR designation was not deactivated on section transfer';
  END IF;

  SELECT count(*) INTO v_active_lb_count
  FROM public.student_lab_batch_assignments
  WHERE student_id = v_student_id AND section_id = v_sec_a_id AND is_current = true;

  IF v_active_lb_count <> 0 THEN
    RAISE EXCEPTION 'Lab batch assignment was not deactivated on section transfer';
  END IF;

  RAISE NOTICE '=== TEST 3: VERIFY TEACHER DEMOTION & RE-PROMOTION CLEANUP ===';
  -- Verify teacher starts with 1 class teacher assignment and 1 teaching assignment
  SELECT count(*) INTO v_active_ct_count
  FROM public.class_teacher_assignments
  WHERE teacher_id = v_teacher_id AND is_current = true;

  SELECT count(*) INTO v_active_ta_count
  FROM public.teacher_assignments
  WHERE teacher_id = v_teacher_id;

  IF v_active_ct_count <> 1 OR v_active_ta_count <> 1 THEN
    RAISE EXCEPTION 'Teacher setup invalid: ct=% ta=%', v_active_ct_count, v_active_ta_count;
  END IF;

  -- Demote teacher to student
  UPDATE public.users SET role = 'student' WHERE id = v_teacher_id;

  -- Verify class teacher assignment ended and teacher_assignments deleted
  SELECT count(*) INTO v_active_ct_count
  FROM public.class_teacher_assignments
  WHERE teacher_id = v_teacher_id AND is_current = true;

  IF v_active_ct_count <> 0 THEN
    RAISE EXCEPTION 'Class teacher assignment was not ended on demotion';
  END IF;

  SELECT count(*) INTO v_active_ta_count
  FROM public.teacher_assignments
  WHERE teacher_id = v_teacher_id;

  IF v_active_ta_count <> 0 THEN
    RAISE EXCEPTION 'Teacher assignments were not deleted on demotion';
  END IF;

  -- Re-promote to teacher
  UPDATE public.users SET role = 'teacher' WHERE id = v_teacher_id;

  -- Verify re-promoted teacher has NO stale assignments
  SELECT count(*) INTO v_active_ta_count
  FROM public.teacher_assignments
  WHERE teacher_id = v_teacher_id;

  IF v_active_ta_count <> 0 THEN
    RAISE EXCEPTION 'Teacher unexpectedly regained stale assignments on re-promotion';
  END IF;

  RAISE NOTICE '=== ALL ASSIGNMENT RELIABILITY REGRESSION TESTS PASSED ===';
END;
$$;

-- Rollback the test transaction so no temporary data persists
ROLLBACK;
