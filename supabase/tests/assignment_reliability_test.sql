-- ============================================================================
-- ECE HUB BUDDY — ASSIGNMENT RELIABILITY VERIFICATION TEST SUITE
-- Target: Isolated disposable test database (NEVER execute in production)
-- Execution: psql "$DATABASE_URL" -f supabase/tests/assignment_reliability_test.sql
--            OR paste into a disposable database query editor.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_suffix text := substr(md5(random()::text), 1, 8);
  v_year_id uuid := gen_random_uuid();
  v_reg_id uuid := gen_random_uuid();
  v_prog_id uuid := gen_random_uuid();
  v_sem_id uuid := gen_random_uuid();
  v_sec_a_id uuid := gen_random_uuid();
  v_sec_b_id uuid := gen_random_uuid();
  v_sub_id uuid := gen_random_uuid();
  v_batch_a_id uuid := gen_random_uuid();
  v_teacher_id uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_timetable_id uuid := gen_random_uuid();

  v_active_ct_count integer;
  v_active_ta_count integer;
  v_active_cr_count integer;
  v_active_lb_count integer;
  v_active_sa_count integer;
  v_total_sa_count integer;
  v_timetable_count integer;
BEGIN
  RAISE NOTICE '=== TEST 1: SETUP TEST FIXTURES (SUFFIX: %) ===', v_suffix;

  -- 1a. Academic Hierarchy
  INSERT INTO public.academic_years (id, name, is_current)
  VALUES (v_year_id, 'TEST-YEAR-' || v_suffix, false);

  INSERT INTO public.regulations (id, academic_year_id, name, is_active)
  VALUES (v_reg_id, v_year_id, 'TEST-REG-' || v_suffix, true);

  INSERT INTO public.programs (id, regulation_id, name, code, is_active)
  VALUES (v_prog_id, v_reg_id, 'TEST-PROG-' || v_suffix, 'T' || substr(v_suffix, 1, 3), true);

  INSERT INTO public.semesters (id, program_id, number, name)
  VALUES (v_sem_id, v_prog_id, 3, 'Semester 3');

  INSERT INTO public.sections (id, semester_id, academic_year_id, name)
  VALUES (v_sec_a_id, v_sem_id, v_year_id, 'A');

  INSERT INTO public.sections (id, semester_id, academic_year_id, name)
  VALUES (v_sec_b_id, v_sem_id, v_year_id, 'B');

  INSERT INTO public.subjects (id, semester_id, name, code)
  VALUES (v_sub_id, v_sem_id, 'Test Subject ' || v_suffix, 'TS' || substr(v_suffix, 1, 4));

  INSERT INTO public.lab_batches (id, section_id, name)
  VALUES (v_batch_a_id, v_sec_a_id, 'Batch A1-' || v_suffix);

  -- 1b. Test Users
  INSERT INTO public.users (id, email, role)
  VALUES (v_teacher_id, 'test_teacher_' || v_suffix || '@example.com', 'teacher');

  INSERT INTO public.users (id, email, role)
  VALUES (v_student_id, 'test_student_' || v_suffix || '@example.com', 'student');

  -- 1c. Initial Assignments
  INSERT INTO public.teacher_assignments (teacher_id, section_id, subject_id)
  VALUES (v_teacher_id, v_sec_a_id, v_sub_id);

  INSERT INTO public.class_teacher_assignments (teacher_id, section_id, is_current)
  VALUES (v_teacher_id, v_sec_a_id, true);

  INSERT INTO public.student_assignments (student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current)
  VALUES (v_student_id, v_year_id, v_reg_id, v_prog_id, v_sem_id, v_sec_a_id, true);

  INSERT INTO public.cr_designations (student_id, section_id, slot, is_current)
  VALUES (v_student_id, v_sec_a_id, 1, true);

  INSERT INTO public.student_lab_batch_assignments (student_id, lab_batch_id, section_id, is_current)
  VALUES (v_student_id, v_batch_a_id, v_sec_a_id, true);

  -- 1d. Timetable Entry for Teacher
  INSERT INTO public.timetable_entries (
    id, academic_year_id, semester_id, section_id, day_of_week, period_order,
    start_time, end_time, subject_id, teacher_id, block_type, is_current
  ) VALUES (
    v_timetable_id, v_year_id, v_sem_id, v_sec_a_id, 1, 1,
    '09:00:00'::time, '10:00:00'::time, v_sub_id, v_teacher_id, 'lecture', true
  );

  RAISE NOTICE '=== TEST 2: SECTION TRANSFER CASCADING & HISTORY PRESERVATION ===';
  -- Transfer student to Section B: deactivate Section A assignment, insert Section B assignment
  UPDATE public.student_assignments
  SET is_current = false
  WHERE student_id = v_student_id AND is_current = true;

  INSERT INTO public.student_assignments (student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current)
  VALUES (v_student_id, v_year_id, v_reg_id, v_prog_id, v_sem_id, v_sec_b_id, true);

  -- Assert student has exactly 1 current assignment and 2 total history records
  SELECT count(*) INTO v_active_sa_count FROM public.student_assignments WHERE student_id = v_student_id AND is_current = true;
  SELECT count(*) INTO v_total_sa_count FROM public.student_assignments WHERE student_id = v_student_id;
  IF v_active_sa_count <> 1 OR v_total_sa_count <> 2 THEN
    RAISE EXCEPTION 'Student assignment history corrupted: active=% total=%', v_active_sa_count, v_total_sa_count;
  END IF;

  -- Assert trigger automatically ended Section A CR designation and Lab Batch
  SELECT count(*) INTO v_active_cr_count FROM public.cr_designations WHERE student_id = v_student_id AND section_id = v_sec_a_id AND is_current = true;
  IF v_active_cr_count <> 0 THEN
    RAISE EXCEPTION 'CR designation was not deactivated on section transfer';
  END IF;

  SELECT count(*) INTO v_active_lb_count FROM public.student_lab_batch_assignments WHERE student_id = v_student_id AND section_id = v_sec_a_id AND is_current = true;
  IF v_active_lb_count <> 0 THEN
    RAISE EXCEPTION 'Lab batch assignment was not deactivated on section transfer';
  END IF;

  RAISE NOTICE '=== TEST 3: TEACHER DEMOTION, ASSIGNMENT CLEANUP & TIMETABLE PRESERVATION ===';
  -- Demote teacher to student
  UPDATE public.users SET role = 'student' WHERE id = v_teacher_id;

  -- Assert class teacher assignment ended
  SELECT count(*) INTO v_active_ct_count FROM public.class_teacher_assignments WHERE teacher_id = v_teacher_id AND is_current = true;
  IF v_active_ct_count <> 0 THEN
    RAISE EXCEPTION 'Class teacher assignment was not ended on demotion';
  END IF;

  -- Assert teacher_assignments rows deleted
  SELECT count(*) INTO v_active_ta_count FROM public.teacher_assignments WHERE teacher_id = v_teacher_id;
  IF v_active_ta_count <> 0 THEN
    RAISE EXCEPTION 'Teacher assignments were not deleted on demotion';
  END IF;

  -- Assert timetable entry is PRESERVED (not deleted)
  SELECT count(*) INTO v_timetable_count FROM public.timetable_entries WHERE id = v_timetable_id;
  IF v_timetable_count <> 1 THEN
    RAISE EXCEPTION 'Timetable entry was unexpectedly deleted on teacher demotion';
  END IF;

  RAISE NOTICE '=== TEST 4: TEACHER RE-PROMOTION STARTS CLEAN ===';
  -- Re-promote user back to teacher
  UPDATE public.users SET role = 'teacher' WHERE id = v_teacher_id;

  -- Assert teacher has NO stale assignments reactivated
  SELECT count(*) INTO v_active_ta_count FROM public.teacher_assignments WHERE teacher_id = v_teacher_id;
  IF v_active_ta_count <> 0 THEN
    RAISE EXCEPTION 'Teacher unexpectedly regained stale assignments on re-promotion: count=%', v_active_ta_count;
  END IF;

  RAISE NOTICE '=== ALL REGRESSION TESTS COMPLETED SUCCESSFULLY ===';
END;
$$;

-- Rollback the test transaction so no temporary fixtures persist in the database
ROLLBACK;
