-- ============================================================================
-- ECE HUB BUDDY — MIGRATION 21 SEQUENTIAL REGRESSION & INVARIANT TEST SUITE
-- Target: Isolated disposable test database (NEVER execute against production)
--
-- EXECUTION INSTRUCTIONS:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/tests/assignment_concurrency_test.sql
--
-- NOTE:
--   This automated script runs sequentially inside a single transaction
--   ending with ROLLBACK. No fixtures or mutations persist in the target database.
--
-- TEST SCOPE & METHODOLOGY:
--   Single-session SQL scripts can verify:
--     (a) Function authorization boundaries and input validations.
--     (b) Error handling and guard rails on invalid or duplicate calls.
--     (c) Sequential serialization outcomes (the state seen by the loser of a race).
--     (d) Single-active invariants and history preservation.
--     (e) Trigger execution and cascade consistency.
--
--   GENUINE CONCURRENT RACES (session blocking, lock contention, race-resolution):
--     True concurrent testing requires multiple simultaneous client connections.
--     Reproducible two-session procedures for all five concurrency scenarios are
--     documented at the end of this file (see "TWO-SESSION CONCURRENCY PROCEDURES").
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_suffix         text    := substr(md5(random()::text), 1, 8);

  -- Academic hierarchy (all sections share v_year_a_id)
  v_year_a_id      uuid    := gen_random_uuid();
  v_reg_id         uuid    := gen_random_uuid();
  v_prog_id        uuid    := gen_random_uuid();
  v_sem_id         uuid    := gen_random_uuid();
  v_sec_a_id       uuid    := gen_random_uuid();
  v_sec_b_id       uuid    := gen_random_uuid();
  v_sub_id         uuid    := gen_random_uuid();
  v_batch_a_id     uuid    := gen_random_uuid();

  -- Actors
  v_existing_admin_id uuid;
  v_admin_was_bootstrapped boolean := false;
  v_admin_id       uuid;
  v_teacher_a_id   uuid    := gen_random_uuid();
  v_teacher_b_id   uuid    := gen_random_uuid();
  v_student_id     uuid    := gen_random_uuid();

  -- Collision verification variable
  v_collision      text;

  -- Security context diagnostic capture variables
  v_actual_user    text;
  v_actual_uid     uuid;
  v_actual_is_admin boolean;

  -- Verification counters & variables
  v_active_sa_count  integer;
  v_total_sa_count   integer;
  v_active_ct_count  integer;
  v_active_ta_count  integer;
  v_sec_check        uuid;
  v_ct_teacher       uuid;
  v_result_sa        public.student_assignments;
  v_result_ct        public.class_teacher_assignments;

  v_allow_partial    boolean := coalesce(
    current_setting('test.allow_partial', true) in ('true', '1', 'on'), false
  );
  v_auth_works       boolean := false;
  v_threw_expected   boolean := false;

BEGIN

  -----------------------------------------------------------------------
  -- TEST 1: FIXTURE SETUP WITH COLLISION CHECKING & PROFILE PROVISIONING
  -----------------------------------------------------------------------
  RAISE NOTICE '=== TEST 1: SETUP FIXTURES (suffix: %) ===', v_suffix;

  -- 1a. Identify or allocate Super Admin fixture
  -- Reuse existing Super Admin if one is already present; otherwise bootstrap one
  SELECT id INTO v_existing_admin_id
  FROM public.users
  WHERE role = 'super_admin'
  LIMIT 1;

  IF v_existing_admin_id IS NOT NULL THEN
    v_admin_id := v_existing_admin_id;
    v_admin_was_bootstrapped := false;
  ELSE
    v_admin_id := gen_random_uuid();
    v_admin_was_bootstrapped := true;
  END IF;

  -- Assert that none of the generated user UUIDs collide with existing data
  IF v_admin_was_bootstrapped THEN
    SELECT 'public.users (id: ' || id || ')' INTO v_collision
    FROM public.users
    WHERE id IN (v_admin_id, v_teacher_a_id, v_teacher_b_id, v_student_id)
    LIMIT 1;
  ELSE
    SELECT 'public.users (id: ' || id || ')' INTO v_collision
    FROM public.users
    WHERE id IN (v_teacher_a_id, v_teacher_b_id, v_student_id)
    LIMIT 1;
  END IF;

  IF v_collision IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 1 COLLISION FAILURE: generated user ID already exists in %', v_collision;
  END IF;

  IF to_regclass('auth.users') IS NOT NULL THEN
    IF v_admin_was_bootstrapped THEN
      EXECUTE $chk$
        SELECT 'auth.users (id: ' || id || ')'
        FROM auth.users
        WHERE id IN ($1, $2, $3, $4)
        LIMIT 1
      $chk$ INTO v_collision USING v_admin_id, v_teacher_a_id, v_teacher_b_id, v_student_id;
    ELSE
      EXECUTE $chk$
        SELECT 'auth.users (id: ' || id || ')'
        FROM auth.users
        WHERE id IN ($1, $2, $3)
        LIMIT 1
      $chk$ INTO v_collision USING v_teacher_a_id, v_teacher_b_id, v_student_id;
    END IF;

    IF v_collision IS NOT NULL THEN
      RAISE EXCEPTION 'TEST 1 COLLISION FAILURE: generated user ID already exists in %', v_collision;
    END IF;
  END IF;

  -- Assert that none of the generated hierarchy UUIDs collide with existing data
  SELECT 'academic hierarchy (table: ' || tbl || ', id: ' || id || ')' INTO v_collision
  FROM (
    SELECT 'academic_years' AS tbl, id FROM public.academic_years WHERE id = v_year_a_id
    UNION ALL
    SELECT 'regulations' AS tbl, id FROM public.regulations WHERE id = v_reg_id
    UNION ALL
    SELECT 'programs' AS tbl, id FROM public.programs WHERE id = v_prog_id
    UNION ALL
    SELECT 'semesters' AS tbl, id FROM public.semesters WHERE id = v_sem_id
    UNION ALL
    SELECT 'sections' AS tbl, id FROM public.sections WHERE id IN (v_sec_a_id, v_sec_b_id)
    UNION ALL
    SELECT 'subjects' AS tbl, id FROM public.subjects WHERE id = v_sub_id
    UNION ALL
    SELECT 'lab_batches' AS tbl, id FROM public.lab_batches WHERE id = v_batch_a_id
  ) h_coll LIMIT 1;

  IF v_collision IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 1 COLLISION FAILURE: generated hierarchy ID already exists in %', v_collision;
  END IF;

  -- 1b. Academic hierarchy fixtures
  -- Both Section A and Section B belong to Academic Year A and Semester 4.
  -- Regulation links to Academic Year A; Program links to Regulation.
  INSERT INTO public.academic_years (id, name, is_current)
    VALUES (v_year_a_id, 'CT21-YEAR-A-' || v_suffix, false);

  INSERT INTO public.regulations (id, academic_year_id, name, is_active)
    VALUES (v_reg_id, v_year_a_id, 'CT21-REG-' || v_suffix, true);

  INSERT INTO public.programs (id, regulation_id, name, code, is_active)
    VALUES (v_prog_id, v_reg_id, 'CT21-PROG-' || v_suffix, 'C' || substr(v_suffix,1,3), true);

  INSERT INTO public.semesters (id, program_id, number, name)
    VALUES (v_sem_id, v_prog_id, 4, 'Semester 4');

  INSERT INTO public.sections (id, semester_id, academic_year_id, name)
    VALUES (v_sec_a_id, v_sem_id, v_year_a_id, 'CA-' || v_suffix),
           (v_sec_b_id, v_sem_id, v_year_a_id, 'CB-' || v_suffix);

  INSERT INTO public.subjects (id, semester_id, name, code)
    VALUES (v_sub_id, v_sem_id, 'CT21 Subject ' || v_suffix, 'CX' || substr(v_suffix,1,4));

  INSERT INTO public.lab_batches (id, section_id, name)
    VALUES (v_batch_a_id, v_sec_a_id, 'CT21-Batch-' || v_suffix);

  -- 1c. User fixtures
  -- To comply with protect_sensitive_user_columns():
  -- 1. If bootstrapping a new Super Admin, create it as a standard user first, then
  --    invoke bootstrap_first_super_admin() to set role='super_admin' legitimately.
  -- 2. Create Teacher A, Teacher B, and Student with default role='student'.
  -- 3. Set authenticated JWT claims for the Super Admin and update teacher accounts to role='teacher'.
  IF v_admin_was_bootstrapped THEN
    IF to_regclass('auth.users') IS NOT NULL THEN
      INSERT INTO auth.users (id, email)
        VALUES (v_admin_id, 'ct21_admin_' || v_suffix || '@example.com');
    ELSE
      INSERT INTO public.users (id, email, full_name, role)
        VALUES (v_admin_id, 'ct21_admin_' || v_suffix || '@example.com', 'CT21 Admin ' || v_suffix, 'student');
    END IF;

    PERFORM public.bootstrap_first_super_admin(v_admin_id);
    UPDATE public.users SET full_name = 'CT21 Admin ' || v_suffix WHERE id = v_admin_id;
  END IF;

  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO auth.users (id, email)
    VALUES
      (v_teacher_a_id, 'ct21_tch_a_' || v_suffix || '@example.com'),
      (v_teacher_b_id, 'ct21_tch_b_' || v_suffix || '@example.com'),
      (v_student_id,   'ct21_std_'   || v_suffix || '@example.com');
  ELSE
    INSERT INTO public.users (id, email, full_name, role)
    VALUES
      (v_teacher_a_id, 'ct21_tch_a_' || v_suffix || '@example.com', 'CT21 Teacher A '|| v_suffix, 'student'),
      (v_teacher_b_id, 'ct21_tch_b_' || v_suffix || '@example.com', 'CT21 Teacher B '|| v_suffix, 'student'),
      (v_student_id,   'ct21_std_'   || v_suffix || '@example.com', 'CT21 Student '  || v_suffix, 'student');
  END IF;

  -- Establish authenticated Super Admin JWT claims before promoting teacher fixtures.
  -- Note on table DAC vs RLS: public.users is not granted UPDATE to the client 'authenticated' role;
  -- updates are executed under the test-runner role (postgres) with admin JWT claims to satisfy
  -- protect_sensitive_user_columns() without violating PostgreSQL table-level DAC permissions.
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

  -- Under authenticated Super Admin claims, promote teacher fixtures (passing protect_sensitive_user_columns)
  UPDATE public.users SET full_name = 'CT21 Teacher A ' || v_suffix, role = 'teacher' WHERE id = v_teacher_a_id;
  UPDATE public.users SET full_name = 'CT21 Teacher B ' || v_suffix, role = 'teacher' WHERE id = v_teacher_b_id;
  UPDATE public.users SET full_name = 'CT21 Student ' || v_suffix WHERE id = v_student_id;

  BEGIN
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- 1d. Verify that all 4 public.users profiles exist with the expected roles.
  -- This catches silent failures where auth.users trigger did not fire or UPDATE affected 0 rows.
  DECLARE
    v_verify_role text;
  BEGIN
    -- Admin (super_admin)
    SELECT role INTO v_verify_role FROM public.users WHERE id = v_admin_id;
    IF v_verify_role IS NULL THEN
      RAISE EXCEPTION 'TEST 1 FIXTURE FAILURE: public.users row for admin (%) was not created.', v_admin_id;
    END IF;
    IF v_verify_role <> 'super_admin' THEN
      RAISE EXCEPTION 'TEST 1 FIXTURE FAILURE: admin (%) role is "%" (expected "super_admin").', v_admin_id, v_verify_role;
    END IF;

    -- Teacher A (teacher)
    SELECT role INTO v_verify_role FROM public.users WHERE id = v_teacher_a_id;
    IF v_verify_role IS NULL THEN
      RAISE EXCEPTION 'TEST 1 FIXTURE FAILURE: public.users row for teacher A (%) was not created.', v_teacher_a_id;
    END IF;
    IF v_verify_role <> 'teacher' THEN
      RAISE EXCEPTION 'TEST 1 FIXTURE FAILURE: teacher A (%) role is "%" (expected "teacher"). Check protect_sensitive_user_columns() enforcement.', v_teacher_a_id, v_verify_role;
    END IF;

    -- Teacher B (teacher)
    SELECT role INTO v_verify_role FROM public.users WHERE id = v_teacher_b_id;
    IF v_verify_role IS NULL THEN
      RAISE EXCEPTION 'TEST 1 FIXTURE FAILURE: public.users row for teacher B (%) was not created.', v_teacher_b_id;
    END IF;
    IF v_verify_role <> 'teacher' THEN
      RAISE EXCEPTION 'TEST 1 FIXTURE FAILURE: teacher B (%) role is "%" (expected "teacher"). Check protect_sensitive_user_columns() enforcement.', v_teacher_b_id, v_verify_role;
    END IF;

    -- Student (student)
    SELECT role INTO v_verify_role FROM public.users WHERE id = v_student_id;
    IF v_verify_role IS NULL THEN
      RAISE EXCEPTION 'TEST 1 FIXTURE FAILURE: public.users row for student (%) was not created.', v_student_id;
    END IF;
    IF v_verify_role <> 'student' THEN
      RAISE EXCEPTION 'TEST 1 FIXTURE FAILURE: student (%) role is "%" (expected "student").', v_student_id, v_verify_role;
    END IF;
  END;

  RAISE NOTICE '  [PASS] Fixtures created cleanly and all 4 profiles verified (super_admin, teacher, teacher, student).';

  -----------------------------------------------------------------------
  -- Detect whether auth session claims can be established
  -----------------------------------------------------------------------
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);
    IF auth.uid() = v_admin_id AND public.is_admin() IS TRUE THEN
      v_auth_works := true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_auth_works := false;
  END;

  BEGIN
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  IF NOT v_auth_works AND NOT v_allow_partial THEN
    RAISE EXCEPTION
      'TEST RUN INCOMPLETE: auth claims could not be established in this harness. '
      'Run with -c "SET test.allow_partial = on;" to execute trigger/schema tests only.';
  END IF;


  -----------------------------------------------------------------------
  -- TEST 2: assign_student_to_section — VALIDATION & FIRST-TIME ASSIGNMENT
  -----------------------------------------------------------------------
  RAISE NOTICE '=== TEST 2: assign_student_to_section validation & first-time assignment ===';

  IF v_auth_works THEN
    -- 2a. Unauthorized caller (student calling teacher/admin-only RPC)
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_student_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_student_id::text, 'role', 'authenticated')::text, true);

    v_threw_expected := false;
    BEGIN
      PERFORM public.assign_student_to_section(v_student_id, v_sec_a_id);
    EXCEPTION WHEN OTHERS THEN
      IF sqlerrm LIKE '%teacher or Super Admin%' OR sqlerrm LIKE '%Only%' THEN
        v_threw_expected := true;
      ELSE
        RAISE EXCEPTION 'Unexpected error in Test 2a: %', sqlerrm;
      END IF;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT v_threw_expected THEN
      RAISE EXCEPTION 'TEST 2a FAILED: assign_student_to_section allowed unauthorized student caller.';
    END IF;
    RAISE NOTICE '  [PASS] 2a: unauthorized caller rejected.';

    -- 2b. Authenticated database role without a valid JWT identity
    -- Explicitly tests that calling the RPC under the authenticated database role with an empty JWT subject
    -- is rejected with 'Not authenticated.'. This does NOT test the anon database role.
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '{}', true);

    v_threw_expected := false;
    BEGIN
      PERFORM public.assign_student_to_section(v_student_id, v_sec_a_id);
    EXCEPTION WHEN OTHERS THEN
      IF sqlerrm LIKE '%Not authenticated%' THEN
        v_threw_expected := true;
      ELSE
        RAISE EXCEPTION 'Unexpected error in Test 2b: %', sqlerrm;
      END IF;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT v_threw_expected THEN
      RAISE EXCEPTION 'TEST 2b FAILED: assign_student_to_section allowed caller with authenticated database role but missing JWT identity (auth.uid() IS NULL).';
    END IF;
    RAISE NOTICE '  [PASS] 2b: caller with authenticated database role but missing JWT identity rejected. (NOTE: This tests authenticated role without JWT identity; it does NOT test the anon database role).';

    -- 2c. Non-student target rejected
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

    v_threw_expected := false;
    BEGIN
      PERFORM public.assign_student_to_section(v_admin_id, v_sec_a_id);
    EXCEPTION WHEN OTHERS THEN
      IF sqlerrm LIKE '%not a student%' THEN
        v_threw_expected := true;
      ELSE
        RAISE EXCEPTION 'Unexpected error in Test 2c: %', sqlerrm;
      END IF;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT v_threw_expected THEN
      RAISE EXCEPTION 'TEST 2c FAILED: assign_student_to_section allowed non-student target.';
    END IF;
    RAISE NOTICE '  [PASS] 2c: non-student target rejected.';

    -- 2d. Valid first-time assignment
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

    v_result_sa := public.assign_student_to_section(v_student_id, v_sec_a_id);

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);

    IF v_result_sa.section_id <> v_sec_a_id OR v_result_sa.is_current <> true THEN
      RAISE EXCEPTION 'TEST 2d FAILED: assign_student_to_section returned incorrect result (section=%, current=%)',
        v_result_sa.section_id, v_result_sa.is_current;
    END IF;
    RAISE NOTICE '  [PASS] 2d: first-time assignment succeeded.';

    -- 2e. Redundant first-time assignment guard
    -- Simulates state seen by a losing concurrent session (already assigned to same section)
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

    v_threw_expected := false;
    BEGIN
      PERFORM public.assign_student_to_section(v_student_id, v_sec_a_id);
    EXCEPTION WHEN OTHERS THEN
      IF sqlerrm LIKE '%already assigned to this section%' THEN
        v_threw_expected := true;
      ELSE
        RAISE EXCEPTION 'Unexpected error in Test 2e: %', sqlerrm;
      END IF;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT v_threw_expected THEN
      RAISE EXCEPTION 'TEST 2e FAILED: assign_student_to_section allowed duplicate assignment to same section.';
    END IF;
    RAISE NOTICE '  [PASS] 2e: duplicate assignment to same section rejected.';

  ELSE
    -- Partial fallback: insert directly to satisfy downstream dependencies
    INSERT INTO public.student_assignments (
      student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current
    ) VALUES (v_student_id, v_year_a_id, v_reg_id, v_prog_id, v_sem_id, v_sec_a_id, true);
    RAISE NOTICE '  [SKIPPED - AUTH REQUIRED] 2a-e: RPC auth checks skipped (auth session claims unsupported in harness); direct SQL fallback executed.';
  END IF;

  -- Verify single-active invariant
  SELECT count(*) INTO v_active_sa_count
  FROM public.student_assignments
  WHERE student_id = v_student_id AND is_current = true;
  IF v_active_sa_count <> 1 THEN
    RAISE EXCEPTION 'TEST 2 INVARIANT FAILED: student has % current assignments (expected 1)', v_active_sa_count;
  END IF;
  RAISE NOTICE '  [PASS] 2-invariant: single active student assignment confirmed.';


  -----------------------------------------------------------------------
  -- TEST 3: ASSIGN VS SUPER ADMIN REASSIGNMENT GUARD & HISTORY
  -----------------------------------------------------------------------
  RAISE NOTICE '=== TEST 3: assign vs Super Admin reassignment guard & history ===';

  IF v_auth_works THEN
    -- 3a. assign_student_to_section must refuse when student already has a current section
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

    v_threw_expected := false;
    BEGIN
      PERFORM public.assign_student_to_section(v_student_id, v_sec_b_id);
    EXCEPTION WHEN OTHERS THEN
      IF sqlerrm LIKE '%already has a current section assignment%' THEN
        v_threw_expected := true;
      ELSE
        RAISE EXCEPTION 'Unexpected error in Test 3a: %', sqlerrm;
      END IF;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT v_threw_expected THEN
      RAISE EXCEPTION 'TEST 3a FAILED: assign_student_to_section allowed reassignment of already-assigned student.';
    END IF;
    RAISE NOTICE '  [PASS] 3a: assign rejected for student with existing assignment.';

    -- 3b. Super Admin moves student using reassign_student_to_section
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

    v_result_sa := public.reassign_student_to_section(v_student_id, v_sec_b_id);

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);

    IF v_result_sa.section_id <> v_sec_b_id OR v_result_sa.is_current <> true THEN
      RAISE EXCEPTION 'TEST 3b FAILED: reassign_student_to_section returned incorrect result.';
    END IF;
    RAISE NOTICE '  [PASS] 3b: Super Admin reassignment succeeded.';

  ELSE
    -- Section B also belongs to v_year_a_id (consistent hierarchy)
    UPDATE public.student_assignments SET is_current = false WHERE student_id = v_student_id AND is_current = true;
    INSERT INTO public.student_assignments (
      student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current
    ) VALUES (v_student_id, v_year_a_id, v_reg_id, v_prog_id, v_sem_id, v_sec_b_id, true);
    RAISE NOTICE '  [SKIPPED - AUTH REQUIRED] 3a-b: RPC auth checks skipped (auth session claims unsupported in harness); direct SQL fallback executed.';
  END IF;

  -- History invariant: exactly 1 active, 2 total records
  SELECT count(*) INTO v_active_sa_count
  FROM public.student_assignments WHERE student_id = v_student_id AND is_current = true;
  SELECT count(*) INTO v_total_sa_count
  FROM public.student_assignments WHERE student_id = v_student_id;
  IF v_active_sa_count <> 1 OR v_total_sa_count <> 2 THEN
    RAISE EXCEPTION 'TEST 3 INVARIANT FAILED: active=% total=% (expected 1 active, 2 total)',
      v_active_sa_count, v_total_sa_count;
  END IF;
  RAISE NOTICE '  [PASS] 3-invariant: assignment history preserved (2 rows, 1 active).';


  -----------------------------------------------------------------------
  -- TEST 4: assign_class_teacher — SEQUENTIAL DISPLACEMENT & SINGLE-ACTIVE
  -----------------------------------------------------------------------
  RAISE NOTICE '=== TEST 4: assign_class_teacher sequential displacement & single-active ===';

  IF v_auth_works THEN
    -- 4a. Assign Teacher A to Section A
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

    v_result_ct := public.assign_class_teacher(v_teacher_a_id, v_sec_a_id);

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);

    IF v_result_ct.teacher_id <> v_teacher_a_id OR v_result_ct.is_current <> true THEN
      RAISE EXCEPTION 'TEST 4a FAILED: assign_class_teacher failed for teacher A';
    END IF;
    RAISE NOTICE '  [PASS] 4a: teacher A assigned as class teacher.';

    -- Verify single active CT
    SELECT count(*) INTO v_active_ct_count
    FROM public.class_teacher_assignments WHERE section_id = v_sec_a_id AND is_current = true;
    IF v_active_ct_count <> 1 THEN
      RAISE EXCEPTION 'TEST 4a INVARIANT FAILED: section A has % active class teachers (expected 1)', v_active_ct_count;
    END IF;

    -- 4b. Assign Teacher B to Section A (sequential proxy for a second winning transaction)
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

    v_result_ct := public.assign_class_teacher(v_teacher_b_id, v_sec_a_id);

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);

    IF v_result_ct.teacher_id <> v_teacher_b_id OR v_result_ct.is_current <> true THEN
      RAISE EXCEPTION 'TEST 4b FAILED: assign_class_teacher displacement failed for teacher B';
    END IF;
    RAISE NOTICE '  [PASS] 4b: teacher B displaced teacher A cleanly.';

  ELSE
    -- Partial fallback: assigned_by provided explicitly as v_admin_id
    INSERT INTO public.class_teacher_assignments (teacher_id, section_id, assigned_by, is_current)
      VALUES (v_teacher_a_id, v_sec_a_id, v_admin_id, true);
    UPDATE public.class_teacher_assignments SET is_current = false, ended_at = now()
      WHERE section_id = v_sec_a_id AND teacher_id = v_teacher_a_id AND is_current = true;
    INSERT INTO public.class_teacher_assignments (teacher_id, section_id, assigned_by, is_current)
      VALUES (v_teacher_b_id, v_sec_a_id, v_admin_id, true);
    RAISE NOTICE '  [SKIPPED - AUTH REQUIRED] 4a-b: RPC auth checks skipped (auth session claims unsupported in harness); direct SQL fallback executed.';
  END IF;

  -- Invariant: exactly 1 active CT remains on Section A
  SELECT count(*), max(teacher_id::text)::uuid INTO v_active_ct_count, v_ct_teacher
  FROM public.class_teacher_assignments WHERE section_id = v_sec_a_id AND is_current = true;
  IF v_active_ct_count <> 1 OR v_ct_teacher <> v_teacher_b_id THEN
    RAISE EXCEPTION 'TEST 4 INVARIANT FAILED: section A active CT count=% teacher=% (expected 1, teacher B)',
      v_active_ct_count, v_ct_teacher;
  END IF;
  RAISE NOTICE '  [PASS] 4-invariant: section A has exactly 1 active class teacher (teacher B).';


  -----------------------------------------------------------------------
  -- TEST 5: end_class_teacher — REMOVAL & NONEXISTENT SECTION BEHAVIOR
  -----------------------------------------------------------------------
  RAISE NOTICE '=== TEST 5: end_class_teacher removal & nonexistent section behavior ===';

  IF v_auth_works THEN
    -- 5a. Assign Teacher A to Section B
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

    v_result_ct := public.assign_class_teacher(v_teacher_a_id, v_sec_b_id);

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);

    IF v_result_ct.section_id <> v_sec_b_id OR NOT v_result_ct.is_current THEN
      RAISE EXCEPTION 'TEST 5a FAILED: assign_class_teacher to section B failed.';
    END IF;
    RAISE NOTICE '  [PASS] 5a: teacher A assigned to section B.';

    -- 5b. Remove class teacher via end_class_teacher
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

    PERFORM public.end_class_teacher(v_sec_b_id);

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE NOTICE '  [PASS] 5b: end_class_teacher succeeded on section B.';

    -- 5c. Nonexistent section handling (must succeed as no-op void return)
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

    BEGIN
      PERFORM public.end_class_teacher(gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'TEST 5c FAILED: end_class_teacher threw error on nonexistent section: %', sqlerrm;
    END;

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE NOTICE '  [PASS] 5c: end_class_teacher cleanly no-ops on nonexistent section.';

    -- 5d. Unauthorized caller rejected
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_teacher_a_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_teacher_a_id::text, 'role', 'authenticated')::text, true);

    v_threw_expected := false;
    BEGIN
      PERFORM public.end_class_teacher(v_sec_b_id);
    EXCEPTION WHEN OTHERS THEN
      IF sqlerrm LIKE '%Forbidden%' OR sqlerrm LIKE '%Only Super Admin%' THEN
        v_threw_expected := true;
      ELSE
        RAISE EXCEPTION 'Unexpected error in Test 5d: %', sqlerrm;
      END IF;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT v_threw_expected THEN
      RAISE EXCEPTION 'TEST 5d FAILED: end_class_teacher allowed non-admin caller.';
    END IF;
    RAISE NOTICE '  [PASS] 5d: unauthorized end_class_teacher rejected.';

  ELSE
    -- Partial fallback: assigned_by provided explicitly as v_admin_id
    INSERT INTO public.class_teacher_assignments (teacher_id, section_id, assigned_by, is_current)
      VALUES (v_teacher_a_id, v_sec_b_id, v_admin_id, true);
    UPDATE public.class_teacher_assignments SET is_current = false, ended_at = now()
      WHERE section_id = v_sec_b_id AND is_current = true;
    RAISE NOTICE '  [SKIPPED - AUTH REQUIRED] 5a-d: RPC auth checks skipped (auth session claims unsupported in harness); direct SQL fallback executed.';
  END IF;

  -- Invariant: 0 active CTs on Section B
  SELECT count(*) INTO v_active_ct_count
  FROM public.class_teacher_assignments WHERE section_id = v_sec_b_id AND is_current = true;
  IF v_active_ct_count <> 0 THEN
    RAISE EXCEPTION 'TEST 5 INVARIANT FAILED: section B has % active CTs (expected 0)', v_active_ct_count;
  END IF;
  RAISE NOTICE '  [PASS] 5-invariant: section B has 0 active class teachers.';


  -----------------------------------------------------------------------
  -- TEST 6: TEACHER DEMOTION TRIGGER CASCADE UNDER AUTHENTICATED CONTEXT
  -----------------------------------------------------------------------
  RAISE NOTICE '=== TEST 6: teacher demotion trigger cascade under authenticated context ===';

  -- Teacher B is currently CT of Section A (from Test 4b).
  -- Attach a teacher_assignments row to confirm cleanup (no ON CONFLICT masking).
  INSERT INTO public.teacher_assignments (teacher_id, section_id, subject_id)
    VALUES (v_teacher_b_id, v_sec_a_id, v_sub_id);

  IF v_auth_works THEN
    -- Note on table DAC vs RLS: public.users is not granted direct UPDATE to client role 'authenticated'.
    -- We set Super Admin JWT claims so public.is_admin() is TRUE and protect_sensitive_user_columns() passes,
    -- while executing the update under the test-runner role (postgres) which holds table-level DAC privileges.
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

    -- Capture diagnostic context variables
    v_actual_uid      := auth.uid();
    v_actual_is_admin := public.is_admin();

    -- Explicit security context verification before mutation
    IF v_actual_uid IS DISTINCT FROM v_admin_id THEN
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('request.jwt.claims', '', true);
      RAISE EXCEPTION 'TEST 6 SECURITY CONTEXT FAILURE: auth.uid() was "%" (expected "%")', v_actual_uid, v_admin_id;
    END IF;
    IF v_actual_is_admin IS NOT TRUE THEN
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('request.jwt.claims', '', true);
      RAISE EXCEPTION 'TEST 6 SECURITY CONTEXT FAILURE: public.is_admin() was % (expected TRUE)', v_actual_is_admin;
    END IF;

    -- Execute role change as Super Admin with guaranteed teardown
    BEGIN
      UPDATE public.users SET role = 'student' WHERE id = v_teacher_b_id;
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('request.jwt.claims', '', true);
      RAISE;
    END;

    -- Reset claims safely immediately after update
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);

    RAISE NOTICE '  [PASS] 6: role update executed and verified under Super Admin JWT claims.';
  ELSE
    -- Execute role change directly under test-runner role (fallback when auth claims unsupported in harness)
    UPDATE public.users SET role = 'student' WHERE id = v_teacher_b_id;

    RAISE NOTICE '  [PARTIAL - AUTH SKIPPED] 6: role update executed directly as database-owner/test-runner role because authenticated session claims could not be established in this test harness. Trigger cascade verified, but client-side RLS / protect_sensitive_user_columns role check bypassed.';
  END IF;

  -- Check CT assignment ended (assertions run under test runner role)
  SELECT count(*) INTO v_active_ct_count
  FROM public.class_teacher_assignments WHERE teacher_id = v_teacher_b_id AND is_current = true;
  IF v_active_ct_count <> 0 THEN
    RAISE EXCEPTION 'TEST 6 FAILED: CT assignment not ended on demotion (count=%)', v_active_ct_count;
  END IF;
  RAISE NOTICE '  [PASS] 6a: class teacher assignment ended on demotion.';

  -- Check teacher_assignments removed
  SELECT count(*) INTO v_active_ta_count
  FROM public.teacher_assignments WHERE teacher_id = v_teacher_b_id;
  IF v_active_ta_count <> 0 THEN
    RAISE EXCEPTION 'TEST 6 FAILED: teacher_assignments not removed on demotion (count=%)', v_active_ta_count;
  END IF;
  RAISE NOTICE '  [PASS] 6b: teacher_assignments deleted on demotion.';

  -- Section A now has 0 active CTs
  SELECT count(*) INTO v_active_ct_count
  FROM public.class_teacher_assignments WHERE section_id = v_sec_a_id AND is_current = true;
  IF v_active_ct_count <> 0 THEN
    RAISE EXCEPTION 'TEST 6 FAILED: section A still has active class teacher (count=%)', v_active_ct_count;
  END IF;
  RAISE NOTICE '  [PASS] 6c: section A has 0 active class teachers after demotion.';


  -----------------------------------------------------------------------
  -- TEST 7: ASSIGNMENT HISTORY PRESERVATION ACROSS TRANSFERS
  -----------------------------------------------------------------------
  RAISE NOTICE '=== TEST 7: assignment history preservation across transfers ===';

  SELECT count(*) INTO v_total_sa_count
  FROM public.student_assignments WHERE student_id = v_student_id;
  IF v_total_sa_count <> 2 THEN
    RAISE EXCEPTION 'TEST 7 FAILED: expected 2 student_assignments rows, got %', v_total_sa_count;
  END IF;

  SELECT count(*) INTO v_active_sa_count
  FROM public.student_assignments WHERE student_id = v_student_id AND is_current = true;
  IF v_active_sa_count <> 1 THEN
    RAISE EXCEPTION 'TEST 7 FAILED: expected 1 current student_assignment, got %', v_active_sa_count;
  END IF;

  SELECT section_id INTO v_sec_check
  FROM public.student_assignments WHERE student_id = v_student_id AND is_current = false;
  IF v_sec_check <> v_sec_a_id THEN
    RAISE EXCEPTION 'TEST 7 FAILED: historical assignment section=% (expected %)', v_sec_check, v_sec_a_id;
  END IF;
  RAISE NOTICE '  [PASS] 7: assignment history intact (old section A row preserved, new section B active).';


  -----------------------------------------------------------------------
  -- TEST 8: AUTHORIZATION RESTRICTIONS & EDGE CASES
  -----------------------------------------------------------------------
  RAISE NOTICE '=== TEST 8: authorization restrictions & edge cases ===';

  IF v_auth_works THEN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

    -- 8a. assign_class_teacher with non-teacher account
    v_threw_expected := false;
    BEGIN
      PERFORM public.assign_class_teacher(v_student_id, v_sec_a_id);
    EXCEPTION WHEN OTHERS THEN
      IF sqlerrm LIKE '%not a teacher%' THEN
        v_threw_expected := true;
      ELSE
        RAISE EXCEPTION 'Unexpected error in Test 8a: %', sqlerrm;
      END IF;
    END;
    IF NOT v_threw_expected THEN
      RAISE EXCEPTION 'TEST 8a FAILED: assign_class_teacher accepted non-teacher.';
    END IF;
    RAISE NOTICE '  [PASS] 8a: assign_class_teacher rejected non-teacher target.';

    -- 8b. assign_class_teacher with nonexistent section
    v_threw_expected := false;
    BEGIN
      PERFORM public.assign_class_teacher(v_teacher_a_id, gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN
      IF sqlerrm LIKE '%Section not found%' THEN
        v_threw_expected := true;
      ELSE
        RAISE EXCEPTION 'Unexpected error in Test 8b: %', sqlerrm;
      END IF;
    END;
    IF NOT v_threw_expected THEN
      RAISE EXCEPTION 'TEST 8b FAILED: assign_class_teacher accepted nonexistent section.';
    END IF;
    RAISE NOTICE '  [PASS] 8b: assign_class_teacher rejected nonexistent section.';

    -- 8c. assign_class_teacher with nonexistent teacher
    v_threw_expected := false;
    BEGIN
      PERFORM public.assign_class_teacher(gen_random_uuid(), v_sec_a_id);
    EXCEPTION WHEN OTHERS THEN
      IF sqlerrm LIKE '%Teacher account not found%' OR sqlerrm LIKE '%not a teacher%' THEN
        v_threw_expected := true;
      ELSE
        RAISE EXCEPTION 'Unexpected error in Test 8c: %', sqlerrm;
      END IF;
    END;
    IF NOT v_threw_expected THEN
      RAISE EXCEPTION 'TEST 8c FAILED: assign_class_teacher accepted nonexistent teacher.';
    END IF;
    RAISE NOTICE '  [PASS] 8c: assign_class_teacher rejected nonexistent teacher.';

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
  ELSE
    RAISE NOTICE '  [SKIPPED - AUTH REQUIRED] 8a-c: RPC auth checks skipped (auth session claims unsupported in harness).';
  END IF;


  -----------------------------------------------------------------------
  -- TEST 9: FINAL SINGLE-ACTIVE INVARIANTS
  -----------------------------------------------------------------------
  RAISE NOTICE '=== TEST 9: final single-active invariants ===';

  SELECT count(*) INTO v_active_sa_count
  FROM public.student_assignments WHERE student_id = v_student_id AND is_current = true;
  IF v_active_sa_count <> 1 THEN
    RAISE EXCEPTION 'TEST 9a FAILED: student has % current assignments (expected 1)', v_active_sa_count;
  END IF;
  RAISE NOTICE '  [PASS] 9a: student has exactly 1 current section assignment.';

  SELECT count(*) INTO v_active_ct_count
  FROM public.class_teacher_assignments WHERE section_id = v_sec_a_id AND is_current = true;
  IF v_active_ct_count > 1 THEN
    RAISE EXCEPTION 'TEST 9b FAILED: section A has % current class teachers (expected <= 1)', v_active_ct_count;
  END IF;
  RAISE NOTICE '  [PASS] 9b: section A has <= 1 current class teacher.';

  SELECT count(*) INTO v_active_ct_count
  FROM public.class_teacher_assignments WHERE section_id = v_sec_b_id AND is_current = true;
  IF v_active_ct_count > 1 THEN
    RAISE EXCEPTION 'TEST 9c FAILED: section B has % current class teachers (expected <= 1)', v_active_ct_count;
  END IF;
  RAISE NOTICE '  [PASS] 9c: section B has <= 1 current class teacher.';


  -----------------------------------------------------------------------
  -- SUMMARY
  -----------------------------------------------------------------------
  BEGIN
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  RAISE NOTICE '=======================================================';
  IF v_auth_works THEN
    RAISE NOTICE 'SEQUENTIAL REGRESSION & INVARIANT SUITE PASSED:';
    RAISE NOTICE '  - Fixture setup (Test 1) and invariant assertions (Tests 2-inv, 3-inv, 4-inv, 5-inv, 7, 9) executed under test-runner role.';
    RAISE NOTICE '  - RPC validations, assignments, and authenticated mutations (Tests 2a-e, 3a-b, 4a-b, 5a-d, 6, 8a-c) executed under authenticated role with configured JWT claims.';
  ELSE
    RAISE NOTICE 'PARTIAL TEST SUITE EXECUTED (ALLOW_PARTIAL MODE):';
    RAISE NOTICE '  - SKIPPED: RPC authorization and input checks requiring authenticated JWT claims (Tests 2a-e, 3a, 5d, 8a-c).';
    RAISE NOTICE '  - EXECUTED VIA DIRECT SQL FALLBACK: State setup for downstream tests (Tests 2 fallback, 3b fallback, 4a-b fallback, 5a-b fallback).';
    RAISE NOTICE '  - EXECUTED AS DB OWNER: Trigger cascade trg_handle_user_role_change (Test 6) executed under test-runner role; verified CT cleanup and subject-assignment deletion, but bypassed client-side RLS/protect_sensitive_user_columns.';
    RAISE NOTICE '  - EXECUTED & PASSED: Database invariants and history assertions (Tests 1, 2-inv, 3-inv, 4-inv, 5-inv, 7, 9).';
    RAISE NOTICE 'To execute full RPC authorization checks, run in an environment that supports PostgREST/Supabase auth session claims.';
  END IF;
  RAISE NOTICE '=======================================================';

END;
$$;

ROLLBACK;

-- ============================================================================
-- STANDALONE TWO-SESSION CONCURRENCY PROCEDURES (5 SCENARIOS)
--
-- PURPOSE:
--   The automated suite above runs sequentially in a single transaction with ROLLBACK.
--   True concurrency testing requires TWO separate, simultaneous client connections
--   (e.g., two interactive psql terminal windows) executing real database calls
--   against the same rows in real time.
--
-- IMPORTANT NOTE ON EXECUTION:
--   The SQL in Parts I, II, and III below is enclosed inside a block comment (/* ... */)
--   as interactive procedural DOCUMENTATION. It is NOT executed by:
--     psql "$DATABASE_URL" -f supabase/tests/assignment_concurrency_test.sql
--   To run these concurrency scenarios, copy the corresponding SQL blocks and execute
--   them manually across two separate interactive psql sessions connected to an
--   isolated disposable test database.
--
--   This section provides:
--     Part I:   Collision-safe Standalone Fixture Setup SQL.
--     Part II:  The 5 Reproducible Concurrency Scenarios with exact starting
--               conditions, setup/reset SQL, interleaved real RPC calls, and verification.
--     Part III: Strictly scoped Cleanup SQL that deletes fixtures matching these exact IDs.
--
-- SAFETY NOTICE:
--   Execute ONLY against an isolated local or disposable test database.
--   NEVER execute against Supabase production or any shared database.
-- ============================================================================

/*
-------------------------------------------------------------------------------
PART I: STANDALONE FIXTURE SETUP (SAFE OWNERSHIP & COLLISION CHECK)
[DOCUMENTATION ONLY — COPY AND EXECUTE MANUALLY IN PSQL]
Execute this script once in psql or SQL editor to establish persistent test fixtures.
This block strictly asserts that none of the target IDs already exist in ANY relevant table.
If any collision is detected, it aborts immediately without modifying any tables.
-------------------------------------------------------------------------------

BEGIN;

-- 1. Collision pre-check across all target and dependent tables
DO $$
DECLARE
  v_collision text;
BEGIN
  -- Check public.users
  SELECT 'public.users (id: ' || id || ')' INTO v_collision
  FROM public.users
  WHERE id IN (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444'
  ) LIMIT 1;
  IF v_collision IS NOT NULL THEN
    RAISE EXCEPTION 'FIXTURE COLLISION: ID already exists in % - Aborting setup to prevent overwriting existing data.', v_collision;
  END IF;

  -- Check auth.users if present
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE $chk$
      SELECT 'auth.users (id: ' || id || ')'
      FROM auth.users
      WHERE id IN (
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444'
      ) LIMIT 1
    $chk$ INTO v_collision;
    IF v_collision IS NOT NULL THEN
      RAISE EXCEPTION 'FIXTURE COLLISION: ID already exists in % - Aborting setup to prevent overwriting existing data.', v_collision;
    END IF;
  END IF;

  -- Check academic hierarchy tables
  SELECT 'academic hierarchy (id: ' || id || ')' INTO v_collision
  FROM (
    SELECT id FROM public.academic_years WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    UNION ALL
    SELECT id FROM public.regulations WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    UNION ALL
    SELECT id FROM public.programs WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    UNION ALL
    SELECT id FROM public.semesters WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    UNION ALL
    SELECT id FROM public.sections WHERE id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')
    UNION ALL
    SELECT id FROM public.subjects WHERE id = '99999999-9999-4999-8999-999999999999'
    UNION ALL
    SELECT id FROM public.lab_batches WHERE id = '88888888-8888-4888-8888-888888888888'
  ) collisions LIMIT 1;
  IF v_collision IS NOT NULL THEN
    RAISE EXCEPTION 'FIXTURE COLLISION: ID already exists in % - Aborting setup to prevent overwriting existing data.', v_collision;
  END IF;

  -- Check existing assignment and dependent records that cleanup could touch
  SELECT 'dependent assignment table (referencing fixture IDs)' INTO v_collision
  FROM (
    SELECT id FROM public.timetable_entries
    WHERE section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')
       OR teacher_id IN ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333')
    UNION ALL
    SELECT id FROM public.cr_designations
    WHERE student_id = '44444444-4444-4444-8444-444444444444'
       OR section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')
    UNION ALL
    SELECT id FROM public.student_lab_batch_assignments
    WHERE student_id = '44444444-4444-4444-8444-444444444444'
       OR section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')
       OR lab_batch_id = '88888888-8888-4888-8888-888888888888'
    UNION ALL
    SELECT id FROM public.class_teacher_assignments
    WHERE section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')
       OR teacher_id IN ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333')
    UNION ALL
    SELECT id FROM public.teacher_assignments
    WHERE section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')
       OR teacher_id IN ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333')
    UNION ALL
    SELECT id FROM public.student_assignments
    WHERE student_id = '44444444-4444-4444-8444-444444444444'
       OR section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')
  ) collisions LIMIT 1;
  IF v_collision IS NOT NULL THEN
    RAISE EXCEPTION 'FIXTURE COLLISION: Conflicting records found in % - Aborting setup.', v_collision;
  END IF;
END $$;

-- 2. Create Academic Hierarchy fixtures (no ON CONFLICT masking)
INSERT INTO public.academic_years (id, name, is_current)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CONC-TEST-YEAR', false);

INSERT INTO public.regulations (id, academic_year_id, name, is_active)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CONC-TEST-REG', true);

INSERT INTO public.programs (id, regulation_id, name, code, is_active)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'CONC-TEST-PROG', 'CTP', true);

INSERT INTO public.semesters (id, program_id, number, name)
VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 5, 'Semester 5');

INSERT INTO public.sections (id, semester_id, academic_year_id, name)
VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SEC-A'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SEC-B');

INSERT INTO public.subjects (id, semester_id, name, code)
VALUES ('99999999-9999-4999-8999-999999999999', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'CONC-SUBJECT', 'CS501');

INSERT INTO public.lab_batches (id, section_id, name)
VALUES ('88888888-8888-4888-8888-888888888888', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'CONC-BATCH-A1');

-- 3. Create or identify Super Admin and create User fixtures
DO $$
DECLARE
  v_admin_id uuid;
  v_needs_bootstrap boolean := false;
BEGIN
  -- Reuse existing Super Admin if one is already present; otherwise bootstrap one
  SELECT id INTO v_admin_id
  FROM public.users
  WHERE role = 'super_admin'
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    v_admin_id := '11111111-1111-4111-8111-111111111111';
    v_needs_bootstrap := true;

    -- Create fixture admin user with default role (student)
    IF to_regclass('auth.users') IS NOT NULL THEN
      INSERT INTO auth.users (id, email)
      VALUES (v_admin_id, 'conc_admin@test.local');
    ELSE
      INSERT INTO public.users (id, email, full_name, role)
      VALUES (v_admin_id, 'conc_admin@test.local', 'Concurrency Admin', 'student');
    END IF;

    -- Bootstrap the first Super Admin using the official Migration 20 mechanism
    PERFORM public.bootstrap_first_super_admin(v_admin_id);
    UPDATE public.users SET full_name = 'Concurrency Admin' WHERE id = v_admin_id;
  END IF;

  -- Create Teacher A, Teacher B, and Student fixtures (defaulting to student role)
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO auth.users (id, email)
    VALUES
      ('22222222-2222-4222-8222-222222222222', 'conc_teacher_a@test.local'),
      ('33333333-3333-4333-8333-333333333333', 'conc_teacher_b@test.local'),
      ('44444444-4444-4444-8444-444444444444', 'conc_student@test.local');
  ELSE
    INSERT INTO public.users (id, email, full_name, role)
    VALUES
      ('22222222-2222-4222-8222-222222222222', 'conc_teacher_a@test.local', 'Concurrency Teacher A', 'student'),
      ('33333333-3333-4333-8333-333333333333', 'conc_teacher_b@test.local', 'Concurrency Teacher B', 'student'),
      ('44444444-4444-4444-8444-444444444444', 'conc_student@test.local', 'Concurrency Student', 'student');
  END IF;

  -- Establish authenticated Super Admin JWT claims before promoting teacher fixtures.
  -- Note on table DAC vs RLS: public.users is not granted direct UPDATE to client role 'authenticated';
  -- updates are executed under test-runner role (postgres) with admin claims to satisfy protect_sensitive_user_columns().
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

  -- Under authenticated admin context, promote teacher accounts and set display names (passes protect_sensitive_user_columns)
  UPDATE public.users SET full_name = 'Concurrency Teacher A', role = 'teacher'
  WHERE id = '22222222-2222-4222-8222-222222222222';

  UPDATE public.users SET full_name = 'Concurrency Teacher B', role = 'teacher'
  WHERE id = '33333333-3333-4333-8333-333333333333';

  UPDATE public.users SET full_name = 'Concurrency Student'
  WHERE id = '44444444-4444-4444-8444-444444444444';

  -- Reset role and claims back to session default
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- 3b. Verify that all 4 public.users profiles exist with the expected roles.
DO $$
DECLARE
  v_admin_id uuid;
  v_role text;
BEGIN
  -- Verify Super Admin profile
  SELECT id, role INTO v_admin_id, v_role FROM public.users WHERE role = 'super_admin' LIMIT 1;
  IF v_admin_id IS NULL OR v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'FIXTURE VERIFICATION FAILED: no active Super Admin found in public.users.';
  END IF;

  -- Verify Teacher A
  SELECT role INTO v_role FROM public.users WHERE id = '22222222-2222-4222-8222-222222222222';
  IF v_role IS NULL OR v_role <> 'teacher' THEN
    RAISE EXCEPTION 'FIXTURE VERIFICATION FAILED: teacher A missing or has wrong role (got: %)', v_role;
  END IF;

  -- Verify Teacher B
  SELECT role INTO v_role FROM public.users WHERE id = '33333333-3333-4333-8333-333333333333';
  IF v_role IS NULL OR v_role <> 'teacher' THEN
    RAISE EXCEPTION 'FIXTURE VERIFICATION FAILED: teacher B missing or has wrong role (got: %)', v_role;
  END IF;

  -- Verify Student
  SELECT role INTO v_role FROM public.users WHERE id = '44444444-4444-4444-8444-444444444444';
  IF v_role IS NULL OR v_role <> 'student' THEN
    RAISE EXCEPTION 'FIXTURE VERIFICATION FAILED: student missing or has wrong role (got: %)', v_role;
  END IF;

  RAISE NOTICE 'Fixture verification passed: Super Admin (%), Teacher A, Teacher B, and Student profiles confirmed.', v_admin_id;
END $$;

-- 4. Initial Teacher Section Assignment (enables teacher authorization for Section A)
INSERT INTO public.teacher_assignments (teacher_id, section_id, subject_id)
VALUES
  ('22222222-2222-4222-8222-222222222222', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '99999999-9999-4999-8999-999999999999'),
  ('33333333-3333-4333-8333-333333333333', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '99999999-9999-4999-8999-999999999999');

COMMIT;


-------------------------------------------------------------------------------
PART II: THE 5 REPRODUCIBLE CONCURRENCY SCENARIOS
[DOCUMENTATION ONLY — INTERLEAVE MANUALLY ACROSS TWO PSQL SESSIONS]
Run these using TWO concurrent interactive psql terminal sessions (Session 1 and Session 2)
connected to your isolated disposable test database.

EVIDENCE NOTE ON LOCKING:
In every scenario below, NEITHER session acquires artificial or manual table locks.
Instead, Session 1 executes the actual mutating RPC/operation within an open transaction,
holding the real row locks enforced by Migration 21. Session 2 executes the competing
real RPC, which blocks directly on the target row lock (Level 1 or Level 2).
-------------------------------------------------------------------------------

SCENARIO 1: Two simultaneous first-time assignments for the same student
-------------------------------------------------------------------------------
* Objective:
  Verify that two simultaneous assign_student_to_section calls serialize on the student's
  users row lock (Level 1), so exactly one call succeeds and the second fails with a
  duplicate-assignment exception rather than creating two active assignments.

* Starting Condition:
  Student has 0 current assignments in public.student_assignments.

* Reset SQL (run in any session before starting):
  DELETE FROM public.student_assignments WHERE student_id = '44444444-4444-4444-8444-444444444444';

* Interleaved Execution:
  [Session 1] BEGIN;
  [Session 1] SET LOCAL role = authenticated;
  [Session 1] SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
  [Session 1] SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
  -- Session 1 invokes the REAL assign_student_to_section RPC.
  -- The function acquires users(student_id) FOR UPDATE (Level 1), inserts the row, and leaves transaction uncommitted:
  [Session 1] SELECT public.assign_student_to_section('44444444-4444-4444-8444-444444444444'::uuid, 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid);

  [Session 2] BEGIN;
  [Session 2] SET LOCAL role = authenticated;
  [Session 2] SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
  [Session 2] SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
  -- Session 2 invokes the REAL assign_student_to_section RPC for the SAME student to Section A.
  -- This call BLOCKS immediately on `users` FOR UPDATE (Level 1), because Session 1 holds the student row lock:
  [Session 2] SELECT public.assign_student_to_section('44444444-4444-4444-8444-444444444444'::uuid, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid);

  -- While Session 2 is blocked, commit Session 1:
  [Session 1] COMMIT;

  -- Observe Session 2 unblock:
  -- Session 2 acquires the student row lock, checks student_assignments, detects the newly committed assignment, and raises:
  --   ERROR: This student already has a current section assignment. Ask your Super Admin to reassign them.
  [Session 2] ROLLBACK;

* Post-Condition Verification:
  SELECT section_id, is_current FROM public.student_assignments WHERE student_id = '44444444-4444-4444-8444-444444444444';
  -- Result: Exactly 1 row pointing to Section B (ffffffff-ffff-4fff-8fff-ffffffffffff) with is_current = true.


-------------------------------------------------------------------------------
SCENARIO 2: First-time assignment racing with Super Admin reassignment
-------------------------------------------------------------------------------
* Objective:
  Verify that assign_student_to_section and reassign_student_to_section serialize on
  the student's users row (Level 1) without deadlock or race condition.

* Starting Condition:
  Student has 0 current assignments initially.

* Reset SQL (run before starting):
  DELETE FROM public.student_assignments WHERE student_id = '44444444-4444-4444-8444-444444444444';

* Interleaved Execution:
  [Session 1] BEGIN;
  [Session 1] SET LOCAL role = authenticated;
  [Session 1] SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
  [Session 1] SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
  -- Session 1 invokes REAL assign_student_to_section (assigning student to Section A):
  -- Holds users(student_id) row lock until commit:
  [Session 1] SELECT public.assign_student_to_section('44444444-4444-4444-8444-444444444444'::uuid, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid);

  [Session 2] BEGIN;
  [Session 2] SET LOCAL role = authenticated;
  [Session 2] SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
  [Session 2] SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
  -- Session 2 invokes REAL reassign_student_to_section (transferring student to Section B):
  -- BLOCKS immediately on users(student_id) FOR UPDATE (Level 1):
  [Session 2] SELECT public.reassign_student_to_section('44444444-4444-4444-8444-444444444444'::uuid, 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid);

  -- Commit Session 1:
  [Session 1] COMMIT;

  -- Observe Session 2 unblock:
  -- Session 2 acquires student lock, sees Session 1's newly committed Section A assignment, ends it, and inserts Section B:
  [Session 2] COMMIT;

* Post-Condition Verification:
  SELECT section_id, is_current FROM public.student_assignments WHERE student_id = '44444444-4444-4444-8444-444444444444' ORDER BY created_at ASC;
  -- Result: Exactly 2 rows:
  --   Row 1: Section A (eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee), is_current = false
  --   Row 2: Section B (ffffffff-ffff-4fff-8fff-ffffffffffff), is_current = true


-------------------------------------------------------------------------------
SCENARIO 3: Two simultaneous class-teacher assignments to the same section
-------------------------------------------------------------------------------
* Objective:
  Verify that two concurrent assign_class_teacher calls for different teachers targeting
  the same section serialize on sections(section_id) FOR UPDATE (Level 2), ensuring that
  the second call cleanly displaces the first with exactly 1 active class teacher.

* Starting Condition:
  Section A has NO current class teacher; Teacher A and Teacher B both have role = 'teacher'.

* Reset SQL (run before starting):
  UPDATE public.users SET role = 'teacher' WHERE id IN ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
  DELETE FROM public.class_teacher_assignments WHERE section_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

* Interleaved Execution:
  [Session 1] BEGIN;
  [Session 1] SET LOCAL role = authenticated;
  [Session 1] SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
  [Session 1] SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
  -- Session 1 invokes REAL assign_class_teacher for Teacher A on Section A:
  -- Holds users(teacher_a) lock (L1) and sections(section_a) lock (L2):
  [Session 1] SELECT public.assign_class_teacher('22222222-2222-4222-8222-222222222222'::uuid, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid);

  [Session 2] BEGIN;
  [Session 2] SET LOCAL role = authenticated;
  [Session 2] SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
  [Session 2] SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
  -- Session 2 invokes REAL assign_class_teacher for Teacher B on Section A:
  -- Acquires users(teacher_b) lock (L1), then BLOCKS on sections(section_a) FOR UPDATE (Level 2):
  [Session 2] SELECT public.assign_class_teacher('33333333-3333-4333-8333-333333333333'::uuid, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid);

  -- Commit Session 1:
  [Session 1] COMMIT;

  -- Observe Session 2 unblock:
  -- Session 2 acquires Section A lock, deactivates Teacher A's assignment, and inserts Teacher B:
  [Session 2] COMMIT;

* Post-Condition Verification:
  SELECT teacher_id, is_current FROM public.class_teacher_assignments WHERE section_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' ORDER BY assigned_at ASC;
  -- Result: Exactly 1 current class teacher: Teacher B (33333333-3333-4333-8333-333333333333). Teacher A is_current = false.


-------------------------------------------------------------------------------
SCENARIO 4: Class-teacher assignment racing with removal (end_class_teacher)
-------------------------------------------------------------------------------
* Objective:
  Verify that assign_class_teacher and end_class_teacher serialize cleanly on
  sections(section_id) FOR UPDATE (Level 2).

* Starting Condition:
  Section A has NO current class teacher initially.

* Reset SQL (run before starting):
  DELETE FROM public.class_teacher_assignments WHERE section_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

* Interleaved Execution:
  [Session 1] BEGIN;
  [Session 1] SET LOCAL role = authenticated;
  [Session 1] SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
  [Session 1] SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
  -- Session 1 invokes REAL assign_class_teacher for Teacher A on Section A:
  -- Holds sections(section_a) lock (L2) until commit:
  [Session 1] SELECT public.assign_class_teacher('22222222-2222-4222-8222-222222222222'::uuid, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid);

  [Session 2] BEGIN;
  [Session 2] SET LOCAL role = authenticated;
  [Session 2] SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
  [Session 2] SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
  -- Session 2 invokes REAL end_class_teacher on Section A:
  -- BLOCKS immediately on sections(section_a) FOR UPDATE (Level 2):
  [Session 2] SELECT public.end_class_teacher('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid);

  -- Commit Session 1:
  [Session 1] COMMIT;

  -- Observe Session 2 unblock:
  -- Session 2 acquires Section A lock, marks Teacher A's assignment as is_current = false, and finishes:
  [Session 2] COMMIT;

* Post-Condition Verification:
  SELECT count(*) FROM public.class_teacher_assignments WHERE section_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND is_current = true;
  -- Result: Exactly 0 active class teachers on Section A.


-------------------------------------------------------------------------------
SCENARIO 5: Teacher demotion racing with class-teacher assignment elsewhere
                (with existing class-teacher assignment exercising trigger section-lock path)
-------------------------------------------------------------------------------
* Objective:
  Verify that an admin demoting a teacher who holds a current class-teacher assignment
  on Section A while another session attempts to assign that same teacher as class teacher
  elsewhere (to Section B):
    1. Session A obtains the teacher's users row lock (Level 1).
    2. The trigger (trg_handle_user_role_change) acquires section locks in id ASC
       order (Level 2), then ends Teacher A's existing class-teacher assignment on Section A.
    3. Session B attempts to assign Teacher A to Section B and BLOCKS on the teacher's
       users row lock (Level 1).
    4. When Session A commits the demotion and trigger cleanup, Session B resumes,
       re-reads role = 'student', and rejects with 'Selected account is not a teacher.'
    5. No active class-teacher assignment remains for Teacher A on either section.
    6. Section A's previous assignment is retained as historical record with ended_at set.
    7. Teacher A's subject mappings in teacher_assignments are cleaned up by the trigger.

* Starting Condition:
  Teacher A has role = 'teacher'.
  Teacher A is the current class teacher of Section A (i.e., class_teacher_assignments
  contains a row with teacher_id = Teacher A, section_id = Section A, is_current = true).
  Section B has no current class teacher.
  Teacher A has a teacher_assignments row for Section A.

* Reset SQL (run before starting):
  BEGIN;
  -- Ensure Teacher A is a teacher (executed under test-runner role with admin claims)
  SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
  UPDATE public.users SET role = 'teacher' WHERE id = '22222222-2222-4222-8222-222222222222';

  -- Clear any stale CT assignments on Section A and Section B
  DELETE FROM public.class_teacher_assignments
  WHERE section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff');

  -- Assign Teacher A as current class teacher of Section A
  SET LOCAL role = authenticated;
  SELECT public.assign_class_teacher('22222222-2222-4222-8222-222222222222'::uuid, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid);
  COMMIT;

  -- Ensure Teacher A has a teacher_assignments row
  INSERT INTO public.teacher_assignments (teacher_id, section_id, subject_id)
  VALUES ('22222222-2222-4222-8222-222222222222', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '99999999-9999-4999-8999-999999999999')
  ON CONFLICT DO NOTHING;

  -- Verify starting state before beginning:
  SELECT teacher_id, is_current FROM public.class_teacher_assignments
  WHERE section_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND is_current = true;
  -- Expected: 1 row — Teacher A (22222222-...) with is_current = true.
  SELECT count(*) FROM public.class_teacher_assignments
  WHERE section_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' AND is_current = true;
  -- Expected: 0 rows.
  SELECT count(*) FROM public.teacher_assignments WHERE teacher_id = '22222222-2222-4222-8222-222222222222';
  -- Expected: >= 1 row.

* Interleaved Execution:
  [Session 1] BEGIN;
  -- Note on table DAC vs RLS: public.users is not granted direct UPDATE to 'authenticated'.
  -- Demotion is executed under test-runner role with authenticated admin JWT claims.
  [Session 1] SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
  [Session 1] SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
  -- Session 1 updates Teacher A's role to 'student':
  -- Holds users(teacher_a) row lock (L1). trg_handle_user_role_change fires:
  --   1. Collects section_ids where teacher_a has is_current = true CT assignments → [Section A].
  --   2. Locks sections(Section A) FOR UPDATE (L2, deterministic id order).
  --   3. Ends Teacher A's CT assignment on Section A (sets is_current = false, ended_at = now()).
  --   4. Deletes Teacher A's teacher_assignments rows.
  -- Transaction remains open — all locks held.
  [Session 1] UPDATE public.users SET role = 'student' WHERE id = '22222222-2222-4222-8222-222222222222';

  [Session 2] BEGIN;
  [Session 2] SET LOCAL role = authenticated;
  [Session 2] SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
  [Session 2] SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
  -- Session 2 invokes REAL assign_class_teacher attempting to assign Teacher A elsewhere (to Section B):
  -- Step 1: SELECT role FROM users WHERE id = teacher_a FOR UPDATE (Level 1).
  -- BLOCKS immediately because Session 1 holds the users(teacher_a) row lock:
  [Session 2] SELECT public.assign_class_teacher('22222222-2222-4222-8222-222222222222'::uuid, 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid);

  -- While Session 2 is blocked, commit Session 1:
  [Session 1] COMMIT;

  -- Observe Session 2 unblock:
  -- Session 2 acquires teacher_a row lock, re-reads role = 'student', and raises:
  --   ERROR: Selected account is not a teacher.
  [Session 2] ROLLBACK;

* Post-Condition Verification:
  -- 1. No active class-teacher assignment remains for Teacher A anywhere
  SELECT count(*) FROM public.class_teacher_assignments
  WHERE teacher_id = '22222222-2222-4222-8222-222222222222' AND is_current = true;
  -- Result: Exactly 0 active class teacher assignments.

  -- 2. Section B was never assigned
  SELECT count(*) FROM public.class_teacher_assignments
  WHERE section_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' AND is_current = true;
  -- Result: Exactly 0 active class teacher assignments.

  -- 3. The historical CT assignment on Section A was ended by the trigger
  SELECT teacher_id, is_current, ended_at FROM public.class_teacher_assignments
  WHERE section_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND teacher_id = '22222222-2222-4222-8222-222222222222';
  -- Result: 1 row with is_current = false, ended_at IS NOT NULL.

  -- 4. Teacher A's teacher_assignments rows were deleted by the trigger
  SELECT count(*) FROM public.teacher_assignments WHERE teacher_id = '22222222-2222-4222-8222-222222222222';
  -- Result: 0 rows.

  -- 5. Teacher A's role is now 'student'
  SELECT role FROM public.users WHERE id = '22222222-2222-4222-8222-222222222222';
  -- Result: 'student'.


-------------------------------------------------------------------------------
PART III: CLEANUP SQL (SAFE SCOPED REMOVAL)
[DOCUMENTATION ONLY — COPY AND EXECUTE MANUALLY IN PSQL]
Execute this script when all standalone concurrency tests are complete.
It removes strictly the persistent fixtures created in Part I using exact ID matching.

IMPORTANT SAFETY NOTICE:
Cleanup predicates match records that reference any of the fixed fixture UUIDs.
If run in a shared database where pre-existing records reference these same IDs,
those records would be removed. Therefore, the collision pre-check in Part I verifies
that no table references these IDs before setup runs.
NEVER execute this script or the standalone suite against production or shared environments.
-------------------------------------------------------------------------------

BEGIN;

-- 1. Dependent assignments
DELETE FROM public.timetable_entries
WHERE section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')
   OR teacher_id IN ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');

DELETE FROM public.cr_designations
WHERE student_id = '44444444-4444-4444-8444-444444444444'
   OR section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff');

DELETE FROM public.student_lab_batch_assignments
WHERE student_id = '44444444-4444-4444-8444-444444444444'
   OR section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')
   OR lab_batch_id = '88888888-8888-4888-8888-888888888888';

DELETE FROM public.class_teacher_assignments
WHERE section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')
   OR teacher_id IN ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');

DELETE FROM public.teacher_assignments
WHERE section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff')
   OR teacher_id IN ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');

DELETE FROM public.student_assignments
WHERE student_id = '44444444-4444-4444-8444-444444444444'
   OR section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff');

-- 2. Academic hierarchy
DELETE FROM public.lab_batches
WHERE id = '88888888-8888-4888-8888-888888888888'
   OR section_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff');

DELETE FROM public.subjects
WHERE id = '99999999-9999-4999-8999-999999999999';

DELETE FROM public.sections
WHERE id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ffffffff-ffff-4fff-8fff-ffffffffffff');

DELETE FROM public.semesters
WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

DELETE FROM public.programs
WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

DELETE FROM public.regulations
WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

DELETE FROM public.academic_years
WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- 3. Test users
-- NOTE ON PRE-EXISTING SUPER ADMIN SAFETY:
-- Part I Step 3 reuses a pre-existing Super Admin when one exists. In that case
-- '11111111-1111-4111-8111-111111111111' was never inserted, so the DELETE below
-- is a no-op for that ID. The pre-existing admin is NOT deleted. The cleanup only
-- targets the four fixed fixture UUIDs, which are either fixture-created or absent.
DELETE FROM public.users
WHERE id IN (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
);

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    DELETE FROM auth.users
    WHERE id IN (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    );
  END IF;
END $$;

COMMIT;
-------------------------------------------------------------------------------
*/
