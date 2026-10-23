-- ============================================================================
-- ECE HUB BUDDY — ASSIGNMENT RELIABILITY VERIFICATION TEST SUITE (psql CLI)
-- Target: Isolated disposable test database (NEVER execute against production)
--
-- EXECUTION INSTRUCTIONS:
-- 1. psql CLI (Recommended):
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/assignment_reliability_test.sql
--
-- 2. Web / GUI SQL Editors (Supabase Dashboard, pgAdmin, DBeaver):
--    Use 'supabase/tests/assignment_reliability_test_editor.sql' which omits
--    psql-specific '\set' meta-commands.
--
-- NOTE:
-- This script runs inside a single transaction ending with ROLLBACK.
-- No fixtures or mutations persist in the target database.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_suffix text := substr(md5(random()::text), 1, 8);
  v_year_a_id uuid := gen_random_uuid();
  v_year_b_id uuid := gen_random_uuid();
  v_reg_id uuid := gen_random_uuid();
  v_prog_id uuid := gen_random_uuid();
  v_sem_id uuid := gen_random_uuid();
  v_sec_a_id uuid := gen_random_uuid();
  v_sec_b_id uuid := gen_random_uuid();
  v_sub_id uuid := gen_random_uuid();
  v_batch_a_id uuid := gen_random_uuid();
  v_admin_id uuid := gen_random_uuid();
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

  v_auth_works boolean := false;
  v_threw_expected_error boolean := false;
  v_reassigned public.student_assignments;
BEGIN
  RAISE NOTICE '=== TEST 1: SETUP TEST FIXTURES (SUFFIX: %) ===', v_suffix;

  -- 1a. Academic Hierarchy
  INSERT INTO public.academic_years (id, name, is_current)
  VALUES (v_year_a_id, 'TEST-YEAR-A-' || v_suffix, false);

  INSERT INTO public.academic_years (id, name, is_current)
  VALUES (v_year_b_id, 'TEST-YEAR-B-' || v_suffix, false);

  INSERT INTO public.regulations (id, academic_year_id, name, is_active)
  VALUES (v_reg_id, v_year_a_id, 'TEST-REG-' || v_suffix, true);

  INSERT INTO public.programs (id, regulation_id, name, code, is_active)
  VALUES (v_prog_id, v_reg_id, 'TEST-PROG-' || v_suffix, 'T' || substr(v_suffix, 1, 3), true);

  INSERT INTO public.semesters (id, program_id, number, name)
  VALUES (v_sem_id, v_prog_id, 3, 'Semester 3');

  INSERT INTO public.sections (id, semester_id, academic_year_id, name)
  VALUES (v_sec_a_id, v_sem_id, v_year_a_id, 'A-' || v_suffix);

  INSERT INTO public.sections (id, semester_id, academic_year_id, name)
  VALUES (v_sec_b_id, v_sem_id, v_year_b_id, 'B-' || v_suffix);

  INSERT INTO public.subjects (id, semester_id, name, code)
  VALUES (v_sub_id, v_sem_id, 'Test Subject ' || v_suffix, 'TS' || substr(v_suffix, 1, 4));

  INSERT INTO public.lab_batches (id, section_id, name)
  VALUES (v_batch_a_id, v_sec_a_id, 'Batch A1-' || v_suffix);

  -- 1b. Test Users
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO auth.users (id, email)
    VALUES
      (v_admin_id, 'test_admin_' || v_suffix || '@example.com'),
      (v_teacher_id, 'test_teacher_' || v_suffix || '@example.com'),
      (v_student_id, 'test_student_' || v_suffix || '@example.com');
  END IF;

  INSERT INTO public.users (id, email, full_name, role)
  VALUES
    (v_admin_id, 'test_admin_' || v_suffix || '@example.com', 'Test Admin ' || v_suffix, 'super_admin'),
    (v_teacher_id, 'test_teacher_' || v_suffix || '@example.com', 'Test Teacher ' || v_suffix, 'teacher'),
    (v_student_id, 'test_student_' || v_suffix || '@example.com', 'Test Student ' || v_suffix, 'student')
  ON CONFLICT (id) DO UPDATE
  SET full_name = excluded.full_name, role = excluded.role;

  -- 1c. Initial Assignments
  INSERT INTO public.teacher_assignments (teacher_id, section_id, subject_id)
  VALUES (v_teacher_id, v_sec_a_id, v_sub_id);

  INSERT INTO public.class_teacher_assignments (teacher_id, section_id, is_current)
  VALUES (v_teacher_id, v_sec_a_id, true);

  INSERT INTO public.student_assignments (student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current)
  VALUES (v_student_id, v_year_a_id, v_reg_id, v_prog_id, v_sem_id, v_sec_a_id, true);

  INSERT INTO public.cr_designations (student_id, section_id, designation, is_current)
  VALUES (v_student_id, v_sec_a_id, 'CR1', true);

  INSERT INTO public.student_lab_batch_assignments (student_id, lab_batch_id, section_id, is_current)
  VALUES (v_student_id, v_batch_a_id, v_sec_a_id, true);

  -- 1d. Timetable Entry for Teacher
  INSERT INTO public.timetable_entries (
    id, academic_year_id, semester_id, section_id, day_of_week, period_order,
    start_time, end_time, subject_id, teacher_id, block_type, is_current
  ) VALUES (
    v_timetable_id, v_year_a_id, v_sem_id, v_sec_a_id, 1, 1,
    '09:00:00'::time, '10:00:00'::time, v_sub_id, v_teacher_id, 'lecture', true
  );

  RAISE NOTICE '=== TEST 2: REASSIGNMENT RPC & SECTION TRANSFER CASCADING ===';

  -- Evaluate if authenticated role claims can be established in this test harness
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);
    IF auth.uid() = v_admin_id AND public.is_admin() IS TRUE THEN
      v_auth_works := true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_auth_works := false;
  END;

  IF v_auth_works THEN
    RAISE NOTICE 'Authenticated claims established: testing public.reassign_student_to_section RPC...';

    -- 2a. Unauthorized Caller Test (Teacher calling Super Admin RPC)
    PERFORM set_config('request.jwt.claim.sub', v_teacher_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher_id::text, 'role', 'authenticated')::text, true);

    v_threw_expected_error := false;
    BEGIN
      PERFORM public.reassign_student_to_section(v_student_id, v_sec_b_id);
    EXCEPTION WHEN OTHERS THEN
      IF sqlerrm LIKE '%Forbidden%' OR sqlerrm LIKE '%Only Super Admin%' THEN
        v_threw_expected_error := true;
      ELSE
        RAISE EXCEPTION 'Unexpected error on unauthorized reassignment: %', sqlerrm;
      END IF;
    END;
    IF NOT v_threw_expected_error THEN
      RAISE EXCEPTION 'RPC Security Breach: reassign_student_to_section allowed unauthorized teacher call.';
    END IF;

    -- 2b. Unauthenticated Caller Test
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '{}', true);

    v_threw_expected_error := false;
    BEGIN
      PERFORM public.reassign_student_to_section(v_student_id, v_sec_b_id);
    EXCEPTION WHEN OTHERS THEN
      IF sqlerrm LIKE '%Not authenticated%' THEN
        v_threw_expected_error := true;
      ELSE
        RAISE EXCEPTION 'Unexpected error on unauthenticated reassignment: %', sqlerrm;
      END IF;
    END;
    IF NOT v_threw_expected_error THEN
      RAISE EXCEPTION 'RPC Security Breach: reassign_student_to_section allowed unauthenticated call.';
    END IF;

    -- 2c. Authorized Super Admin Reassignment
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

    v_reassigned := public.reassign_student_to_section(v_student_id, v_sec_b_id);

    IF v_reassigned.section_id <> v_sec_b_id THEN
      RAISE EXCEPTION 'reassign_student_to_section returned incorrect section_id: %', v_reassigned.section_id;
    END IF;
    IF v_reassigned.academic_year_id <> v_year_b_id THEN
      RAISE EXCEPTION 'reassign_student_to_section returned incorrect academic_year_id: % (expected destination %)',
        v_reassigned.academic_year_id, v_year_b_id;
    END IF;
    IF v_reassigned.is_current <> true THEN
      RAISE EXCEPTION 'reassign_student_to_section did not mark new assignment as current.';
    END IF;

    -- 2d. Same-Section Reassignment Guard
    v_threw_expected_error := false;
    BEGIN
      PERFORM public.reassign_student_to_section(v_student_id, v_sec_b_id);
    EXCEPTION WHEN OTHERS THEN
      IF sqlerrm LIKE '%already assigned to this section%' THEN
        v_threw_expected_error := true;
      ELSE
        RAISE EXCEPTION 'Unexpected error on redundant reassignment: %', sqlerrm;
      END IF;
    END;
    IF NOT v_threw_expected_error THEN
      RAISE EXCEPTION 'reassign_student_to_section allowed redundant reassignment to same section.';
    END IF;

  ELSE
    RAISE NOTICE 'SKIPPED: reassign_student_to_section RPC tests NOT TESTED because authenticated claims could not be established in this test harness.';

    -- Fallback for test environments without Supabase auth claims: verify database trigger behavior directly
    UPDATE public.student_assignments
    SET is_current = false
    WHERE student_id = v_student_id AND is_current = true;

    INSERT INTO public.student_assignments (student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current)
    VALUES (v_student_id, v_year_b_id, v_reg_id, v_prog_id, v_sem_id, v_sec_b_id, true);
  END IF;

  -- Verify history preservation and cascading deactivations
  SELECT count(*) INTO v_active_sa_count FROM public.student_assignments WHERE student_id = v_student_id AND is_current = true;
  SELECT count(*) INTO v_total_sa_count FROM public.student_assignments WHERE student_id = v_student_id;
  IF v_active_sa_count <> 1 OR v_total_sa_count <> 2 THEN
    RAISE EXCEPTION 'Student assignment history corrupted: active=% total=%', v_active_sa_count, v_total_sa_count;
  END IF;

  SELECT count(*) INTO v_active_cr_count FROM public.cr_designations WHERE student_id = v_student_id AND section_id = v_sec_a_id AND is_current = true;
  IF v_active_cr_count <> 0 THEN
    RAISE EXCEPTION 'CR designation was not deactivated on section transfer';
  END IF;

  SELECT count(*) INTO v_active_lb_count FROM public.student_lab_batch_assignments WHERE student_id = v_student_id AND section_id = v_sec_a_id AND is_current = true;
  IF v_active_lb_count <> 0 THEN
    RAISE EXCEPTION 'Lab batch assignment was not deactivated on section transfer';
  END IF;

  RAISE NOTICE '=== TEST 3: TEACHER DEMOTION, ASSIGNMENT CLEANUP & TIMETABLE PRESERVATION ===';
  -- If auth simulation is active, ensure admin session context so protect_sensitive_user_columns allows role change
  IF v_auth_works THEN
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);
  END IF;

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
