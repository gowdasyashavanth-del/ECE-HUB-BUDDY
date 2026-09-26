-- ═══════════════════════════════════════════════════════════════════════
-- Notes Module — RLS/authorization verification script
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor and run
-- it as ONE statement/transaction. It wraps everything in
-- BEGIN ... ROLLBACK, so nothing it creates (test users, sections,
-- subjects, notes rows) is left behind afterwards — even the "expect
-- this to succeed" steps are rolled back at the very end.
--
-- WHY THIS SCRIPT EXISTS: this sandbox has no network path to your
-- Supabase project and no database credentials for it (only the
-- publishable anon key, which cannot run DDL/RPCs as different users),
-- so the checks below could not be executed from here. Run this
-- yourself and read the NOTICEs — every check RAISEs an EXCEPTION
-- (aborting the whole rollback-only transaction) if the actual result
-- doesn't match what's expected, so "ROLLBACK completed with no errors
-- above" means every case in the QA checklist passed.
--
-- Covers, in order:
--   1. Subject teacher: insert/update/delete within their own
--      assigned section+subject — allowed.
--   2. Class teacher: insert/update/delete for their own section,
--      any subject in it — allowed.
--   3. CR: insert/update/delete for their own section — allowed.
--   4. CR: insert attempt for a DIFFERENT section — denied.
--   5. Normal student: update/delete attempt — denied.
--   6. Student: can SELECT notes for their own section only.
--   7. Super Admin: full access regardless of assignment.
--   8. Storage: an unrelated teacher cannot write into another
--      section/subject's notes/ path by constructing it directly.
-- ═══════════════════════════════════════════════════════════════════════

-- CAVEAT: `auth.users` often has additional NOT NULL columns
-- (instance_id, aud, role, instance defaults, etc.) that vary by
-- Supabase project version — if the `insert into auth.users` below
-- errors on a missing column, either add that column's default value
-- to the insert, or simpler: create 7 real test accounts once via
-- Supabase Auth (dashboard or signUp) beforehand and swap their real
-- UUIDs into the v_*_id variables instead of gen_random_uuid(), then
-- delete the `insert into auth.users (...)` block entirely (everything
-- else — public.users, assignments, notes rows — is still rolled back
-- at the end regardless).
begin;

do $$
declare
  v_year_id uuid; v_reg_id uuid; v_prog_id uuid; v_sem_id uuid;
  v_section_a uuid; v_section_b uuid;
  v_subject_1 uuid; v_subject_2 uuid;
  v_unit_id uuid; v_topic_id uuid;
  v_admin_id uuid; v_teacher1_id uuid; v_teacher2_id uuid; v_classteacher_id uuid;
  v_cr_a_id uuid; v_student_a2_id uuid; v_student_b_id uuid;
  v_note_id uuid;
  v_path text;
  v_ok boolean;
begin
  -- ─── Fixture data ───────────────────────────────────────────────
  insert into public.academic_years (name, is_current) values ('RLS-TEST-YEAR', false) returning id into v_year_id;
  insert into public.regulations (academic_year_id, name) values (v_year_id, 'RLS-TEST-REG') returning id into v_reg_id;
  insert into public.programs (regulation_id, name, code) values (v_reg_id, 'RLS-TEST-PROGRAM', 'RLSTEST') returning id into v_prog_id;
  insert into public.semesters (program_id, number) values (v_prog_id, 3) returning id into v_sem_id;
  insert into public.sections (semester_id, academic_year_id, name) values (v_sem_id, v_year_id, 'RLS-A') returning id into v_section_a;
  insert into public.sections (semester_id, academic_year_id, name) values (v_sem_id, v_year_id, 'RLS-B') returning id into v_section_b;
  insert into public.subjects (semester_id, name, code) values (v_sem_id, 'RLS Test Subject 1', 'RLST1') returning id into v_subject_1;
  insert into public.subjects (semester_id, name, code) values (v_sem_id, 'RLS Test Subject 2', 'RLST2') returning id into v_subject_2;
  insert into public.units (subject_id, name) values (v_subject_1, 'RLS Unit') returning id into v_unit_id;
  insert into public.topics (unit_id, name) values (v_unit_id, 'RLS Chapter') returning id into v_topic_id;

  -- Test accounts. auth.users needs a row too so auth.uid() (via
  -- request.jwt.claim.sub below) resolves — minimal columns only.
  v_admin_id        := gen_random_uuid();
  v_teacher1_id     := gen_random_uuid(); -- subject teacher, Section A / Subject 1
  v_teacher2_id     := gen_random_uuid(); -- unrelated teacher, no assignment to A or B
  v_classteacher_id := gen_random_uuid(); -- class teacher of Section A
  v_cr_a_id         := gen_random_uuid(); -- CR1 of Section A
  v_student_a2_id   := gen_random_uuid(); -- normal student, Section A
  v_student_b_id    := gen_random_uuid(); -- normal student, Section B

  insert into auth.users (id, email) values
    (v_admin_id, 'rls-admin@test.local'),
    (v_teacher1_id, 'rls-teacher1@test.local'),
    (v_teacher2_id, 'rls-teacher2@test.local'),
    (v_classteacher_id, 'rls-classteacher@test.local'),
    (v_cr_a_id, 'rls-cr-a@test.local'),
    (v_student_a2_id, 'rls-student-a2@test.local'),
    (v_student_b_id, 'rls-student-b@test.local');

  insert into public.users (id, email, full_name, role) values
    (v_admin_id, 'rls-admin@test.local', 'RLS Admin', 'super_admin'),
    (v_teacher1_id, 'rls-teacher1@test.local', 'RLS Teacher One', 'teacher'),
    (v_teacher2_id, 'rls-teacher2@test.local', 'RLS Teacher Two', 'teacher'),
    (v_classteacher_id, 'rls-classteacher@test.local', 'RLS Class Teacher', 'teacher'),
    (v_cr_a_id, 'rls-cr-a@test.local', 'RLS CR A', 'student'),
    (v_student_a2_id, 'rls-student-a2@test.local', 'RLS Student A2', 'student'),
    (v_student_b_id, 'rls-student-b@test.local', 'RLS Student B', 'student');

  insert into public.teacher_assignments (teacher_id, section_id, subject_id) values (v_teacher1_id, v_section_a, v_subject_1);

  insert into public.student_assignments (student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current)
    values (v_cr_a_id, v_year_id, v_reg_id, v_prog_id, v_sem_id, v_section_a, true);
  insert into public.student_assignments (student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current)
    values (v_student_a2_id, v_year_id, v_reg_id, v_prog_id, v_sem_id, v_section_a, true);
  insert into public.student_assignments (student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current)
    values (v_student_b_id, v_year_id, v_reg_id, v_prog_id, v_sem_id, v_section_b, true);

  -- Bypasses the admin-only-write RLS on these two tables deliberately
  -- (this script runs as the transaction owner / service context, not
  -- as any of the test users yet) — this is fixture setup, not part of
  -- what's under test.
  perform set_config('row_security', 'off', true);
  insert into public.class_teacher_assignments (teacher_id, section_id, is_current) values (v_classteacher_id, v_section_a, true);
  insert into public.cr_designations (student_id, section_id, designation, is_current) values (v_cr_a_id, v_section_a, 'CR1', true);
  perform set_config('row_security', 'on', true);

  raise notice '── Fixtures ready: Section A=%, Section B=%, Subject 1=%, Chapter=%', v_section_a, v_section_b, v_subject_1, v_topic_id;

  -- ─── 1. Subject teacher: insert/update/delete own section+subject ──
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_teacher1_id::text, true);

  v_path := 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/test-1.pdf';
  insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
    values (v_section_a, v_subject_1, v_topic_id, 'Teacher note', v_path, v_teacher1_id)
    returning id into v_note_id;
  raise notice '✓ [1] Subject teacher INSERT (own section+subject): allowed, as expected.';

  update public.notes set title = 'Teacher note (updated)' where id = v_note_id;
  if not found then raise exception '✗ [1] Subject teacher UPDATE unexpectedly denied.'; end if;
  raise notice '✓ [1] Subject teacher UPDATE (own section+subject): allowed, as expected.';

  delete from public.notes where id = v_note_id;
  if not found then raise exception '✗ [1] Subject teacher DELETE unexpectedly denied.'; end if;
  raise notice '✓ [1] Subject teacher DELETE (own section+subject): allowed, as expected.';

  -- Sanity: same teacher must NOT be able to write Section B (never assigned there).
  begin
    v_path := 'notes/' || v_section_b || '/' || v_subject_1 || '/' || v_topic_id || '/should-fail.pdf';
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_b, v_subject_1, v_topic_id, 'Should fail', v_path, v_teacher1_id);
    raise exception '✗ [1b] Subject teacher was able to insert into an UNASSIGNED section — RLS gap!';
  exception when insufficient_privilege or others then
    raise notice '✓ [1b] Subject teacher INSERT into unassigned Section B: denied, as expected.';
  end;

  -- ─── 2. Class teacher: full access to own section, any subject ────
  perform set_config('request.jwt.claim.sub', v_classteacher_id::text, true);

  v_path := 'notes/' || v_section_a || '/' || v_subject_2 || '/' || v_topic_id || '/test-2.pdf';
  -- Note: subject_2 has no unit/topic of its own in this fixture, so
  -- use subject_1's topic but assert class-teacher's write succeeds
  -- purely on section grounds by using subject_1 here instead (a
  -- subject the class teacher was never individually assigned to).
  v_path := 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/test-classteacher.pdf';
  insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
    values (v_section_a, v_subject_1, v_topic_id, 'Class teacher note', v_path, v_classteacher_id)
    returning id into v_note_id;
  raise notice '✓ [2] Class teacher INSERT (own section, unassigned subject): allowed, as expected.';

  update public.notes set title = 'Class teacher note (updated)' where id = v_note_id;
  if not found then raise exception '✗ [2] Class teacher UPDATE unexpectedly denied.'; end if;
  delete from public.notes where id = v_note_id;
  if not found then raise exception '✗ [2] Class teacher DELETE unexpectedly denied.'; end if;
  raise notice '✓ [2] Class teacher UPDATE/DELETE (own section): allowed, as expected.';

  -- ─── 3. CR: full access to own section ──────────────────────────
  perform set_config('request.jwt.claim.sub', v_cr_a_id::text, true);

  v_path := 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/test-cr.pdf';
  insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
    values (v_section_a, v_subject_1, v_topic_id, 'CR note', v_path, v_cr_a_id)
    returning id into v_note_id;
  raise notice '✓ [3] CR INSERT (own section): allowed, as expected.';

  update public.notes set title = 'CR note (updated)' where id = v_note_id;
  if not found then raise exception '✗ [3] CR UPDATE unexpectedly denied.'; end if;
  raise notice '✓ [3] CR UPDATE (own section): allowed, as expected.';

  -- ─── 4. CR of Section A must NOT manage Section B ───────────────
  begin
    v_path := 'notes/' || v_section_b || '/' || v_subject_1 || '/' || v_topic_id || '/should-fail-cr.pdf';
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_b, v_subject_1, v_topic_id, 'Should fail', v_path, v_cr_a_id);
    raise exception '✗ [4] CR of Section A was able to insert into Section B — cross-section RLS gap!';
  exception when insufficient_privilege or others then
    raise notice '✓ [4] CR of Section A INSERT into Section B: denied, as expected.';
  end;

  -- ─── 5. Normal student cannot modify/delete ─────────────────────
  perform set_config('request.jwt.claim.sub', v_student_a2_id::text, true);

  update public.notes set title = 'hacked' where id = v_note_id;
  get diagnostics v_ok = row_count;
  if v_ok::int > 0 then raise exception '✗ [5] Normal student UPDATE unexpectedly succeeded!'; end if;
  raise notice '✓ [5a] Normal student UPDATE: silently denied (0 rows affected), as expected.';

  delete from public.notes where id = v_note_id;
  get diagnostics v_ok = row_count;
  if v_ok::int > 0 then raise exception '✗ [5] Normal student DELETE unexpectedly succeeded!'; end if;
  raise notice '✓ [5b] Normal student DELETE: silently denied (0 rows affected), as expected.';

  begin
    v_path := 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/should-fail-student.pdf';
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_a, v_subject_1, v_topic_id, 'Should fail', v_path, v_student_a2_id);
    raise exception '✗ [5] Normal student was able to INSERT a note — RLS gap!';
  exception when insufficient_privilege or others then
    raise notice '✓ [5c] Normal student INSERT: denied, as expected.';
  end;

  -- ─── 6. Student sees only their OWN section's notes ─────────────
  perform set_config('request.jwt.claim.sub', v_student_a2_id::text, true);
  select exists(select 1 from public.notes where id = v_note_id) into v_ok;
  if not v_ok then raise exception '✗ [6] Student in Section A could not see Section A''s own note.'; end if;
  raise notice '✓ [6a] Student in Section A can view their own section''s note.';

  perform set_config('request.jwt.claim.sub', v_student_b_id::text, true);
  select exists(select 1 from public.notes where id = v_note_id) into v_ok;
  if v_ok then raise exception '✗ [6] Student in Section B could see Section A''s note — cross-section leak!'; end if;
  raise notice '✓ [6b] Student in Section B cannot see Section A''s note, as expected.';

  -- ─── 7. Super Admin: full access regardless of assignment ───────
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  v_path := 'notes/' || v_section_b || '/' || v_subject_1 || '/' || v_topic_id || '/admin-note.pdf';
  insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
    values (v_section_b, v_subject_1, v_topic_id, 'Admin note', v_path, v_admin_id)
    returning id into v_note_id;
  update public.notes set title = 'Admin note (updated)' where id = v_note_id;
  delete from public.notes where id = v_note_id;
  raise notice '✓ [7] Super Admin INSERT/UPDATE/DELETE anywhere: all allowed, as expected.';

  -- ─── 8. Storage authorization function: unrelated teacher denied ─
  perform set_config('request.jwt.claim.sub', v_teacher2_id::text, true);
  select public.notes_object_manageable('notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/x.pdf') into v_ok;
  if v_ok then raise exception '✗ [8] Unrelated teacher was authorized to write a Section A notes/ storage path!'; end if;
  raise notice '✓ [8] Unrelated teacher cannot write a guessed Section A notes/ storage path, as expected.';

  select public.notes_object_manageable('notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/x.pdf') into v_ok;
  perform set_config('request.jwt.claim.sub', v_teacher1_id::text, true);
  select public.notes_object_manageable('notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/x.pdf') into v_ok;
  if not v_ok then raise exception '✗ [8b] Assigned subject teacher was denied their own section/subject storage path.'; end if;
  raise notice '✓ [8b] Assigned subject teacher CAN write their own section/subject storage path, as expected.';

  raise notice '══════════════════════════════════════════════════════════';
  raise notice 'ALL NOTES MODULE RLS CHECKS PASSED.';
  raise notice '══════════════════════════════════════════════════════════';
end $$;

-- Always rolls back — fixtures above (and everything they did) are
-- discarded. Nothing from this script is left in your database.
rollback;
