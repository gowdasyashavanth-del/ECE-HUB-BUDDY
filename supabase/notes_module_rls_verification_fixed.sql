begin;

create temporary table _notes_rls_results (
  seq serial primary key,
  test_name text,
  expected text,
  actual text,
  status text
);

create or replace function pg_temp.log_result(p_test text, p_expected text, p_actual text, p_status text) returns void
language plpgsql security definer as $$
begin
  insert into pg_temp._notes_rls_results (test_name, expected, actual, status) values (p_test, p_expected, p_actual, p_status);
end;
$$;

do $$
declare
  v_year_id uuid;
  v_reg_id uuid;
  v_prog_id uuid;
  v_sem_id uuid;
  v_sem_other_id uuid;
  v_section_a uuid;
  v_section_b uuid;
  v_subject_1 uuid;
  v_subject_2 uuid;
  v_subject_other_sem uuid;
  v_unit_id uuid;
  v_unit_2_id uuid;
  v_unit_other_id uuid;
  v_topic_other_id uuid;
  v_topic_id uuid;
  v_topic_2_id uuid;
  v_admin_id uuid;
  v_teacher1_id uuid;
  v_teacher2_id uuid;
  v_classteacher_id uuid;
  v_cr_a_id uuid;
  v_student_a2_id uuid;
  v_student_b_id uuid;
  v_note_id uuid;
  v_note_seed_a uuid;
  v_note_seed_b uuid;
  v_rowcount int;
  v_visible boolean;
  v_rls_notes boolean;
  v_rls_storage boolean;
  v_storage_ok boolean := true;
begin

  select relrowsecurity into v_rls_notes from pg_class where oid = 'public.notes'::regclass;
  perform pg_temp.log_result('R0 RLS enabled on public.notes', 'true', coalesce(v_rls_notes::text,'null'), case when v_rls_notes then 'PASS' else 'FAIL' end);

  select relrowsecurity into v_rls_storage from pg_class where oid = 'storage.objects'::regclass;
  perform pg_temp.log_result('R0 RLS enabled on storage.objects', 'true', coalesce(v_rls_storage::text,'null'), case when v_rls_storage then 'PASS' else 'FAIL' end);

  insert into public.academic_years (name, is_current) values ('RLS-TEST-YEAR', false) returning id into v_year_id;
  insert into public.regulations (academic_year_id, name) values (v_year_id, 'RLS-TEST-REG') returning id into v_reg_id;
  insert into public.programs (regulation_id, name, code) values (v_reg_id, 'RLS-TEST-PROGRAM', 'RLSTEST') returning id into v_prog_id;
  insert into public.semesters (program_id, number) values (v_prog_id, 3) returning id into v_sem_id;
  insert into public.semesters (program_id, number) values (v_prog_id, 4) returning id into v_sem_other_id;

  insert into public.sections (semester_id, academic_year_id, name) values (v_sem_id, v_year_id, 'RLS-A') returning id into v_section_a;
  insert into public.sections (semester_id, academic_year_id, name) values (v_sem_id, v_year_id, 'RLS-B') returning id into v_section_b;

  insert into public.subjects (semester_id, name, code) values (v_sem_id, 'RLS Test Subject 1', 'RLST1') returning id into v_subject_1;
  insert into public.subjects (semester_id, name, code) values (v_sem_id, 'RLS Test Subject 2', 'RLST2') returning id into v_subject_2;
  insert into public.subjects (semester_id, name, code) values (v_sem_other_id, 'RLS Test Subject Other Sem', 'RLSTOS') returning id into v_subject_other_sem;

  insert into public.units (subject_id, name) values (v_subject_other_sem, 'RLS Unit Other Sem') returning id into v_unit_other_id;
  insert into public.topics (unit_id, name) values (v_unit_other_id, 'RLS Chapter Other Sem') returning id into v_topic_other_id;

  insert into public.units (subject_id, name) values (v_subject_1, 'RLS Unit 1') returning id into v_unit_id;
  insert into public.topics (unit_id, name) values (v_unit_id, 'RLS Chapter 1') returning id into v_topic_id;

  insert into public.units (subject_id, name) values (v_subject_2, 'RLS Unit 2') returning id into v_unit_2_id;
  insert into public.topics (unit_id, name) values (v_unit_2_id, 'RLS Chapter 2') returning id into v_topic_2_id;

  v_admin_id := gen_random_uuid();
  v_teacher1_id := gen_random_uuid();
  v_teacher2_id := gen_random_uuid();
  v_classteacher_id := gen_random_uuid();
  v_cr_a_id := gen_random_uuid();
  v_student_a2_id := gen_random_uuid();
  v_student_b_id := gen_random_uuid();

  insert into auth.users (id, email) values
    (v_admin_id, 'rls-admin@test.local'),
    (v_teacher1_id, 'rls-teacher1@test.local'),
    (v_teacher2_id, 'rls-teacher2@test.local'),
    (v_classteacher_id, 'rls-classteacher@test.local'),
    (v_cr_a_id, 'rls-cr-a@test.local'),
    (v_student_a2_id, 'rls-student-a2@test.local'),
    (v_student_b_id, 'rls-student-b@test.local');

  -- The on_auth_user_created trigger already auto-created a matching
  -- public.users row for each id above with role defaulting to
  -- student, so this must be an upsert, not a plain insert.
  insert into public.users (id, email, full_name, role) values
    (v_admin_id, 'rls-admin@test.local', 'RLS Admin', 'super_admin'),
    (v_teacher1_id, 'rls-teacher1@test.local', 'RLS Teacher One', 'teacher'),
    (v_teacher2_id, 'rls-teacher2@test.local', 'RLS Teacher Two', 'teacher'),
    (v_classteacher_id, 'rls-classteacher@test.local', 'RLS Class Teacher', 'teacher'),
    (v_cr_a_id, 'rls-cr-a@test.local', 'RLS CR A', 'student'),
    (v_student_a2_id, 'rls-student-a2@test.local', 'RLS Student A2', 'student'),
    (v_student_b_id, 'rls-student-b@test.local', 'RLS Student B', 'student')
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;

  insert into public.teacher_assignments (teacher_id, section_id, subject_id) values (v_teacher1_id, v_section_a, v_subject_1);

  insert into public.student_assignments (student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current)
    values (v_cr_a_id, v_year_id, v_reg_id, v_prog_id, v_sem_id, v_section_a, true);
  insert into public.student_assignments (student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current)
    values (v_student_a2_id, v_year_id, v_reg_id, v_prog_id, v_sem_id, v_section_a, true);
  insert into public.student_assignments (student_id, academic_year_id, regulation_id, program_id, semester_id, section_id, is_current)
    values (v_student_b_id, v_year_id, v_reg_id, v_prog_id, v_sem_id, v_section_b, true);

  insert into public.class_teacher_assignments (teacher_id, section_id, is_current) values (v_classteacher_id, v_section_a, true);
  insert into public.cr_designations (student_id, section_id, designation, is_current) values (v_cr_a_id, v_section_a, 'CR1', true);

  perform pg_temp.log_result('FX Fixtures created', 'ok', 'ok', 'PASS');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_teacher1_id::text, true);
  begin
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_a, v_subject_1, v_topic_id, 'A1 Teacher Note', 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/a1.pdf', v_teacher1_id)
      returning id into v_note_id;
    perform pg_temp.log_result('A1 Subject teacher INSERT own section+subject', 'ALLOWED', 'ALLOWED', 'PASS');
  exception when others then
    perform pg_temp.log_result('A1 Subject teacher INSERT own section+subject', 'ALLOWED', 'DENIED: ' || sqlerrm, 'FAIL');
  end;

  update public.notes set title = 'A2 Teacher Note Updated' where id = v_note_id;
  get diagnostics v_rowcount = row_count;
  perform pg_temp.log_result('A2 Subject teacher UPDATE own section+subject', 'ALLOWED', case when v_rowcount > 0 then 'ALLOWED' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'PASS' else 'FAIL' end);

  delete from public.notes where id = v_note_id;
  get diagnostics v_rowcount = row_count;
  perform pg_temp.log_result('A3 Subject teacher DELETE own section+subject', 'ALLOWED', case when v_rowcount > 0 then 'ALLOWED' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'PASS' else 'FAIL' end);

  begin
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_b, v_subject_1, v_topic_id, 'A4 Teacher unassigned section', 'notes/' || v_section_b || '/' || v_subject_1 || '/' || v_topic_id || '/a4.pdf', v_teacher1_id);
    perform pg_temp.log_result('A4 Subject teacher INSERT into unassigned section', 'DENIED', 'ALLOWED (LEAK)', 'FAIL');
  exception when others then
    perform pg_temp.log_result('A4 Subject teacher INSERT into unassigned section', 'DENIED', 'DENIED: ' || sqlerrm, 'PASS');
  end;
  execute 'reset role';

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_classteacher_id::text, true);
  begin
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_a, v_subject_1, v_topic_id, 'B1 Class Teacher Note', 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/b1.pdf', v_classteacher_id)
      returning id into v_note_id;
    perform pg_temp.log_result('B1 Class teacher INSERT own section, unassigned subject', 'ALLOWED', 'ALLOWED', 'PASS');
  exception when others then
    perform pg_temp.log_result('B1 Class teacher INSERT own section, unassigned subject', 'ALLOWED', 'DENIED: ' || sqlerrm, 'FAIL');
  end;

  update public.notes set title = 'B2 Class Teacher Note Updated' where id = v_note_id;
  get diagnostics v_rowcount = row_count;
  perform pg_temp.log_result('B2 Class teacher UPDATE own section', 'ALLOWED', case when v_rowcount > 0 then 'ALLOWED' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'PASS' else 'FAIL' end);

  delete from public.notes where id = v_note_id;
  get diagnostics v_rowcount = row_count;
  perform pg_temp.log_result('B3 Class teacher DELETE own section', 'ALLOWED', case when v_rowcount > 0 then 'ALLOWED' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'PASS' else 'FAIL' end);

  begin
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_b, v_subject_1, v_topic_id, 'B4 Class teacher other section', 'notes/' || v_section_b || '/' || v_subject_1 || '/' || v_topic_id || '/b4.pdf', v_classteacher_id);
    perform pg_temp.log_result('B4 Class teacher INSERT into another section', 'DENIED', 'ALLOWED (LEAK)', 'FAIL');
  exception when others then
    perform pg_temp.log_result('B4 Class teacher INSERT into another section', 'DENIED', 'DENIED: ' || sqlerrm, 'PASS');
  end;
  execute 'reset role';

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_cr_a_id::text, true);
  begin
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_a, v_subject_1, v_topic_id, 'C1 CR Note', 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/c1.pdf', v_cr_a_id)
      returning id into v_note_id;
    perform pg_temp.log_result('C1 CR INSERT own section', 'ALLOWED', 'ALLOWED', 'PASS');
  exception when others then
    perform pg_temp.log_result('C1 CR INSERT own section', 'ALLOWED', 'DENIED: ' || sqlerrm, 'FAIL');
  end;

  update public.notes set title = 'C2 CR Note Updated' where id = v_note_id;
  get diagnostics v_rowcount = row_count;
  perform pg_temp.log_result('C2 CR UPDATE own section', 'ALLOWED', case when v_rowcount > 0 then 'ALLOWED' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'PASS' else 'FAIL' end);

  delete from public.notes where id = v_note_id;
  get diagnostics v_rowcount = row_count;
  perform pg_temp.log_result('C3 CR DELETE own section', 'ALLOWED', case when v_rowcount > 0 then 'ALLOWED' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'PASS' else 'FAIL' end);
  execute 'reset role';

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
    values (v_section_a, v_subject_1, v_topic_id, 'Seed A', 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/seed-a.pdf', v_admin_id)
    returning id into v_note_seed_a;
  insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
    values (v_section_b, v_subject_1, v_topic_id, 'Seed B', 'notes/' || v_section_b || '/' || v_subject_1 || '/' || v_topic_id || '/seed-b.pdf', v_admin_id)
    returning id into v_note_seed_b;
  execute 'reset role';

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_cr_a_id::text, true);
  begin
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_b, v_subject_1, v_topic_id, 'D1 CR cross section', 'notes/' || v_section_b || '/' || v_subject_1 || '/' || v_topic_id || '/d1.pdf', v_cr_a_id);
    perform pg_temp.log_result('D1 CR of Section A INSERT into Section B', 'DENIED', 'ALLOWED (LEAK)', 'FAIL');
  exception when others then
    perform pg_temp.log_result('D1 CR of Section A INSERT into Section B', 'DENIED', 'DENIED: ' || sqlerrm, 'PASS');
  end;

  update public.notes set title = 'hacked-by-cr-a' where id = v_note_seed_b;
  get diagnostics v_rowcount = row_count;
  perform pg_temp.log_result('D2 CR of Section A UPDATE Section B note', 'DENIED', case when v_rowcount > 0 then 'ALLOWED (LEAK)' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'FAIL' else 'PASS' end);

  delete from public.notes where id = v_note_seed_b;
  get diagnostics v_rowcount = row_count;
  perform pg_temp.log_result('D3 CR of Section A DELETE Section B note', 'DENIED', case when v_rowcount > 0 then 'ALLOWED (LEAK)' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'FAIL' else 'PASS' end);
  execute 'reset role';

  select exists(select 1 from public.notes where id = v_note_seed_b) into v_visible;
  perform pg_temp.log_result('D3b Seed B note still exists after D3 (as postgres)', 'true', v_visible::text, case when v_visible then 'PASS' else 'FAIL' end);

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_student_a2_id::text, true);

  select exists(select 1 from public.notes where id = v_note_seed_a) into v_visible;
  perform pg_temp.log_result('E1 Normal student SELECT own section note', 'VISIBLE', case when v_visible then 'VISIBLE' else 'NOT VISIBLE' end, case when v_visible then 'PASS' else 'FAIL' end);

  select exists(select 1 from public.notes where id = v_note_seed_b) into v_visible;
  perform pg_temp.log_result('E1b Normal student SELECT other section note', 'NOT VISIBLE', case when v_visible then 'VISIBLE (LEAK)' else 'NOT VISIBLE' end, case when v_visible then 'FAIL' else 'PASS' end);

  begin
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_a, v_subject_1, v_topic_id, 'E2 Student attempt', 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/e2.pdf', v_student_a2_id);
    perform pg_temp.log_result('E2 Normal student INSERT', 'DENIED', 'ALLOWED (LEAK)', 'FAIL');
  exception when others then
    perform pg_temp.log_result('E2 Normal student INSERT', 'DENIED', 'DENIED: ' || sqlerrm, 'PASS');
  end;

  update public.notes set title = 'hacked-by-student' where id = v_note_seed_a;
  get diagnostics v_rowcount = row_count;
  perform pg_temp.log_result('E3 Normal student UPDATE own section note', 'DENIED', case when v_rowcount > 0 then 'ALLOWED (LEAK)' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'FAIL' else 'PASS' end);

  delete from public.notes where id = v_note_seed_a;
  get diagnostics v_rowcount = row_count;
  perform pg_temp.log_result('E4 Normal student DELETE own section note', 'DENIED', case when v_rowcount > 0 then 'ALLOWED (LEAK)' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'FAIL' else 'PASS' end);
  execute 'reset role';

  select exists(select 1 from public.notes where id = v_note_seed_a) into v_visible;
  perform pg_temp.log_result('E4b Seed A note still exists after E4 (as postgres)', 'true', v_visible::text, case when v_visible then 'PASS' else 'FAIL' end);

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);

  select exists(select 1 from public.notes where id = v_note_seed_a) into v_visible;
  perform pg_temp.log_result('F1 Super Admin SELECT any note', 'VISIBLE', case when v_visible then 'VISIBLE' else 'NOT VISIBLE' end, case when v_visible then 'PASS' else 'FAIL' end);

  update public.notes set title = 'F2 Admin updated seed A' where id = v_note_seed_a;
  get diagnostics v_rowcount = row_count;
  perform pg_temp.log_result('F2 Super Admin UPDATE any note', 'ALLOWED', case when v_rowcount > 0 then 'ALLOWED' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'PASS' else 'FAIL' end);

  delete from public.notes where id = v_note_seed_a;
  get diagnostics v_rowcount = row_count;
  perform pg_temp.log_result('F3 Super Admin DELETE any note (unassigned section)', 'ALLOWED', case when v_rowcount > 0 then 'ALLOWED' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'PASS' else 'FAIL' end);
  execute 'reset role';
  -- F.INSERT was already exercised (and PASSes only if true) when Seed A
  -- and Seed B were created above as v_admin_id — logged here explicitly
  -- so it appears as its own row in the results.
  perform pg_temp.log_result('F4 Super Admin INSERT (seed notes created earlier)', 'ALLOWED', 'ALLOWED', 'PASS');

  begin
    insert into storage.objects (bucket_id, name) values ('content-files', 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/g-seed-a.pdf');
    insert into storage.objects (bucket_id, name) values ('content-files', 'notes/' || v_section_b || '/' || v_subject_1 || '/' || v_topic_id || '/g-seed-b.pdf');
  exception when others then
    v_storage_ok := false;
    perform pg_temp.log_result('G0 Direct storage.objects fixture insert', 'succeeds', 'failed: ' || sqlerrm || ' -- falling back to function-level checks for G tests', 'INFO');
  end;

  if v_storage_ok then

    perform pg_temp.log_result('G0b Direct SQL DELETE on storage.objects', 'n/a', 'blocked platform-wide by protect_objects_delete trigger for every role -- delete authorization is verified via notes_object_manageable() below instead, the exact predicate notes_files_scoped_delete uses', 'INFO');

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_teacher1_id::text, true);
    select exists(select 1 from storage.objects where bucket_id = 'content-files' and name = 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/g-seed-a.pdf') into v_visible;
    perform pg_temp.log_result('G1 Subject teacher SELECT own section storage object', 'VISIBLE', case when v_visible then 'VISIBLE' else 'NOT VISIBLE' end, case when v_visible then 'PASS' else 'FAIL' end);

    begin
      insert into storage.objects (bucket_id, name) values ('content-files', 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/g2-teacher-upload.pdf');
      perform pg_temp.log_result('G2 Subject teacher INSERT own section storage object', 'ALLOWED', 'ALLOWED', 'PASS');
    exception when others then
      perform pg_temp.log_result('G2 Subject teacher INSERT own section storage object', 'ALLOWED', 'DENIED: ' || sqlerrm, 'FAIL');
    end;

    begin
      update storage.objects set metadata = '{"rls_test":true}'::jsonb where bucket_id = 'content-files' and name = 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/g2-teacher-upload.pdf';
      get diagnostics v_rowcount = row_count;
      perform pg_temp.log_result('G3 Subject teacher UPDATE own section storage object', 'ALLOWED', case when v_rowcount > 0 then 'ALLOWED' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'PASS' else 'FAIL' end);
    exception when others then
      perform pg_temp.log_result('G3 Subject teacher UPDATE own section storage object', 'ALLOWED', 'DENIED: ' || sqlerrm, 'FAIL');
    end;

    select public.notes_object_manageable('notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/g2-teacher-upload.pdf') into v_visible;
    perform pg_temp.log_result('G4 Subject teacher DELETE-authorization for own section storage object', 'true', v_visible::text, case when v_visible then 'PASS' else 'FAIL' end);
    execute 'reset role';

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_teacher2_id::text, true);
    select exists(select 1 from storage.objects where bucket_id = 'content-files' and name = 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/g-seed-a.pdf') into v_visible;
    perform pg_temp.log_result('G5 Unrelated teacher SELECT Section A storage object (path guessing)', 'NOT VISIBLE', case when v_visible then 'VISIBLE (LEAK)' else 'NOT VISIBLE' end, case when v_visible then 'FAIL' else 'PASS' end);

    begin
      insert into storage.objects (bucket_id, name) values ('content-files', 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/g6-hostile-upload.pdf');
      perform pg_temp.log_result('G6 Unrelated teacher INSERT into Section A path', 'DENIED', 'ALLOWED (LEAK)', 'FAIL');
    exception when others then
      perform pg_temp.log_result('G6 Unrelated teacher INSERT into Section A path', 'DENIED', 'DENIED: ' || sqlerrm, 'PASS');
    end;

    begin
      update storage.objects set metadata = '{"hostile":true}'::jsonb where bucket_id = 'content-files' and name = 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/g-seed-a.pdf';
      get diagnostics v_rowcount = row_count;
      perform pg_temp.log_result('G7 Unrelated teacher UPDATE Section A storage object', 'DENIED', case when v_rowcount > 0 then 'ALLOWED (LEAK)' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'FAIL' else 'PASS' end);
    exception when others then
      perform pg_temp.log_result('G7 Unrelated teacher UPDATE Section A storage object', 'DENIED', 'DENIED: ' || sqlerrm, 'PASS');
    end;

    select public.notes_object_manageable('notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/g-seed-a.pdf') into v_visible;
    perform pg_temp.log_result('G8 Unrelated teacher DELETE-authorization for Section A storage object', 'false', v_visible::text, case when not v_visible then 'PASS' else 'FAIL' end);
    execute 'reset role';

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_cr_a_id::text, true);
    select exists(select 1 from storage.objects where bucket_id = 'content-files' and name = 'notes/' || v_section_b || '/' || v_subject_1 || '/' || v_topic_id || '/g-seed-b.pdf') into v_visible;
    perform pg_temp.log_result('G9 CR of Section A SELECT Section B storage object', 'NOT VISIBLE', case when v_visible then 'VISIBLE (LEAK)' else 'NOT VISIBLE' end, case when v_visible then 'FAIL' else 'PASS' end);

    select public.notes_object_manageable('notes/' || v_section_b || '/' || v_subject_1 || '/' || v_topic_id || '/g-seed-b.pdf') into v_visible;
    perform pg_temp.log_result('G10 CR of Section A DELETE-authorization for Section B storage object', 'false', v_visible::text, case when not v_visible then 'PASS' else 'FAIL' end);

    begin
      insert into storage.objects (bucket_id, name) values ('content-files', 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/g11-cr-upload.pdf');
      perform pg_temp.log_result('G11 CR INSERT own section storage object', 'ALLOWED', 'ALLOWED', 'PASS');
    exception when others then
      perform pg_temp.log_result('G11 CR INSERT own section storage object', 'ALLOWED', 'DENIED: ' || sqlerrm, 'FAIL');
    end;

    begin
      update storage.objects set metadata = '{"cr":true}'::jsonb where bucket_id = 'content-files' and name = 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/g11-cr-upload.pdf';
      get diagnostics v_rowcount = row_count;
      perform pg_temp.log_result('G12 CR UPDATE own section storage object', 'ALLOWED', case when v_rowcount > 0 then 'ALLOWED' else 'DENIED (0 rows)' end, case when v_rowcount > 0 then 'PASS' else 'FAIL' end);
    exception when others then
      perform pg_temp.log_result('G12 CR UPDATE own section storage object', 'ALLOWED', 'DENIED: ' || sqlerrm, 'FAIL');
    end;

    select public.notes_object_manageable('notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/g11-cr-upload.pdf') into v_visible;
    perform pg_temp.log_result('G13 CR DELETE-authorization for own section storage object', 'true', v_visible::text, case when v_visible then 'PASS' else 'FAIL' end);
    execute 'reset role';

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_student_b_id::text, true);
    select public.notes_object_manageable('notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/does-not-exist-but-guessed.pdf') into v_visible;
    perform pg_temp.log_result('G14 Normal student guessing another section storage path (DELETE-authorization)', 'false', v_visible::text, case when not v_visible then 'PASS' else 'FAIL' end);
    execute 'reset role';

  else

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_teacher1_id::text, true);
    select public.notes_object_manageable('notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/x.pdf') into v_visible;
    perform pg_temp.log_result('G-fallback Subject teacher can manage own section path (function-level)', 'true', v_visible::text, case when v_visible then 'PASS' else 'FAIL' end);
    execute 'reset role';

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_teacher2_id::text, true);
    select public.notes_object_manageable('notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/x.pdf') into v_visible;
    perform pg_temp.log_result('G-fallback Unrelated teacher cannot manage Section A path (function-level)', 'false', v_visible::text, case when not v_visible then 'PASS' else 'FAIL' end);
    execute 'reset role';

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', v_cr_a_id::text, true);
    select public.notes_object_manageable('notes/' || v_section_b || '/' || v_subject_1 || '/' || v_topic_id || '/x.pdf') into v_visible;
    perform pg_temp.log_result('G-fallback CR of Section A cannot manage Section B path (function-level)', 'false', v_visible::text, case when not v_visible then 'PASS' else 'FAIL' end);
    execute 'reset role';

  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  begin
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_a, v_subject_other_sem, v_topic_other_id, 'H1a bad combo', 'notes/' || v_section_a || '/' || v_subject_other_sem || '/' || v_topic_other_id || '/h1a.pdf', v_admin_id);
    perform pg_temp.log_result('H1a Section+subject in different semesters rejected', 'REJECTED', 'ALLOWED (BUG)', 'FAIL');
  exception when others then
    perform pg_temp.log_result('H1a Section+subject in different semesters rejected', 'REJECTED', 'REJECTED: ' || sqlerrm, 'PASS');
  end;

  begin
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_a, v_subject_1, v_topic_2_id, 'H1b bad topic', 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_2_id || '/h1b.pdf', v_admin_id);
    perform pg_temp.log_result('H1b Topic belonging to a different subject rejected', 'REJECTED', 'ALLOWED (BUG)', 'FAIL');
  exception when others then
    perform pg_temp.log_result('H1b Topic belonging to a different subject rejected', 'REJECTED', 'REJECTED: ' || sqlerrm, 'PASS');
  end;

  begin
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_a, v_subject_1, v_topic_id, 'H1c mismatched path', 'notes/' || v_section_b || '/' || v_subject_1 || '/' || v_topic_id || '/h1c.pdf', v_admin_id);
    perform pg_temp.log_result('H1c File path not matching declared section/subject/chapter rejected', 'REJECTED', 'ALLOWED (BUG)', 'FAIL');
  exception when others then
    perform pg_temp.log_result('H1c File path not matching declared section/subject/chapter rejected', 'REJECTED', 'REJECTED: ' || sqlerrm, 'PASS');
  end;

  begin
    insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
      values (v_section_a, v_subject_1, v_topic_id, 'H1d non pdf', 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/h1d.docx', v_admin_id);
    perform pg_temp.log_result('H1d Non-PDF file path rejected', 'REJECTED', 'ALLOWED (BUG)', 'FAIL');
  exception when others then
    perform pg_temp.log_result('H1d Non-PDF file path rejected', 'REJECTED', 'REJECTED: ' || sqlerrm, 'PASS');
  end;
  execute 'reset role';

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_teacher1_id::text, true);
  insert into public.notes (section_id, subject_id, topic_id, title, file_path, uploaded_by)
    values (v_section_a, v_subject_1, v_topic_id, 'H2 teacher own note', 'notes/' || v_section_a || '/' || v_subject_1 || '/' || v_topic_id || '/h2.pdf', v_teacher1_id)
    returning id into v_note_id;

  begin
    update public.notes
      set section_id = v_section_b,
          file_path = 'notes/' || v_section_b || '/' || v_subject_1 || '/' || v_topic_id || '/h2-moved.pdf'
      where id = v_note_id;
    get diagnostics v_rowcount = row_count;
    if v_rowcount > 0 then
      perform pg_temp.log_result('H2 UPDATE cannot move note into an unauthorized section', 'DENIED', 'ALLOWED (LEAK)', 'FAIL');
    else
      perform pg_temp.log_result('H2 UPDATE cannot move note into an unauthorized section', 'DENIED', 'DENIED (0 rows)', 'PASS');
    end if;
  exception when others then
    perform pg_temp.log_result('H2 UPDATE cannot move note into an unauthorized section', 'DENIED', 'DENIED: ' || sqlerrm, 'PASS');
  end;

  delete from public.notes where id = v_note_id;
  execute 'reset role';

end $$;

select test_name, expected, actual, status
from (
  select seq, test_name, expected, actual, status
  from pg_temp._notes_rls_results

  union all

  select
    (select coalesce(max(seq), 0) + 1 from pg_temp._notes_rls_results) as seq,
    'OVERALL RESULT' as test_name,
    '' as expected,
    case
      when (select count(*) from pg_temp._notes_rls_results where status = 'FAIL') = 0
        then ''
      else (select string_agg(test_name, ', ') from pg_temp._notes_rls_results where status = 'FAIL')
    end as actual,
    case
      when (select count(*) from pg_temp._notes_rls_results where status = 'FAIL') = 0
        then 'ALL NOTES MODULE RLS CHECKS PASSED'
      else 'NOTES MODULE RLS CHECKS FAILED'
    end as status
) combined
order by seq
;

rollback;
