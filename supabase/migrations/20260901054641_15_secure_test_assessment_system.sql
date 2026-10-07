-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 15: Secure Test Assessment System
--
-- Fixes 4 real gaps found during Phase 8 investigation (approved before
-- this migration was written):
--   1. results_insert_own let a student write ANY score/total directly.
--   2. No XP-awarding mechanism existed, and the existing protect_
--      sensitive_user_columns() trigger would block even a trusted
--      function's XP update (auth.uid() inside a SECURITY DEFINER
--      function still reflects the real caller).
--   3. questions_select (correctly, for teacher/admin authoring) returns
--      correct_answer/explanation — a naive student-facing query would
--      leak the answer key before submission.
--   4. tests.question_ids is a plain uuid[] — nothing validated that
--      every question actually belongs to the test's own subject.
--
-- All four fixes reuse the exact SECURITY DEFINER pattern already used
-- throughout this schema (is_admin(), teacher_has_subject(), etc.) —
-- nothing foreign is introduced. No new tables. No Branch. No is_active.
-- ═══════════════════════════════════════════════════════════════════════


-- ─── FIX 4: test/question subject-integrity trigger ─────────────────────
-- Runs on INSERT and on UPDATE of question_ids/subject_id/topic_id only
-- (not every column) so unrelated edits (title, duration) aren't
-- penalized with an extra check.
create or replace function public.validate_test_questions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test_subject_id uuid;
  v_bad_count integer;
begin
  if new.question_ids is null or array_length(new.question_ids, 1) is null then
    return new; -- an empty test (questions added later) is fine
  end if;

  v_test_subject_id := coalesce(new.subject_id, public.get_subject_id_for_topic(new.topic_id));

  select count(*) into v_bad_count
  from unnest(new.question_ids) as qid
  where not exists (
    select 1 from public.questions q
    where q.id = qid
      and public.get_subject_id_for_topic(q.topic_id) = v_test_subject_id
  );

  if v_bad_count > 0 then
    raise exception 'question_ids contains % question(s) that do not exist or do not belong to this test''s subject.', v_bad_count;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_test_questions on public.tests;
create trigger trg_validate_test_questions
before insert or update of question_ids, subject_id, topic_id on public.tests
for each row execute function public.validate_test_questions();


-- ─── FIX 2 (mechanism): narrow, explicit trusted-XP bypass ──────────────
-- role and streak protection is COMPLETELY UNCHANGED — still admin-only,
-- no exceptions. Only xp gets one additional, narrowly-scoped path: a
-- transaction-local flag that ONLY public.submit_test_attempt() (below)
-- ever sets. A client cannot set a custom Postgres GUC through the
-- REST/RPC interface — only server-side PL/pgSQL code can call
-- set_config(), so the only way this flag becomes true is by executing
-- this one reviewed function. Being transaction-local (the `true` third
-- argument to set_config), it clears itself automatically when the
-- transaction ends — no separate cleanup code needed or possible to forget.
create or replace function public.protect_sensitive_user_columns()
returns trigger as $$
declare
  v_trusted_xp boolean := current_setting('app.trusted_xp_update', true) = 'true';
begin
  if not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Not allowed to change role directly.';
    end if;
    if new.streak is distinct from old.streak then
      raise exception 'Not allowed to change streak directly.';
    end if;
    if new.xp is distinct from old.xp and not v_trusted_xp then
      raise exception 'Not allowed to change xp directly.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
-- (trigger itself was already created in 09_protected_columns_triggers.sql
-- and does not need to be recreated — CREATE OR REPLACE FUNCTION above is
-- sufficient since the trigger just calls this function by name.)


-- ─── FIX 3: safe, answer-key-free question retrieval for test-taking ───
create or replace function public.get_test_questions(p_test_id uuid)
returns table (
  id uuid,
  question_text text,
  options jsonb,
  difficulty text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_test record;
  v_subject_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated.';
  end if;

  select * into v_test from public.tests where id = p_test_id;
  if not found then
    raise exception 'Test not found.';
  end if;

  v_subject_id := coalesce(v_test.subject_id, public.get_subject_id_for_topic(v_test.topic_id));

  if not (
    public.is_admin()
    or public.teacher_has_subject(v_subject_id)
    or (v_test.is_published and public.student_enrolled_in_subject(v_subject_id))
  ) then
    raise exception 'You are not authorized to view this test.';
  end if;

  return query
    select q.id, q.question_text, q.options, q.difficulty
    from public.questions q
    where q.id = any(v_test.question_ids);
end;
$$;

revoke all on function public.get_test_questions(uuid) from public;
grant execute on function public.get_test_questions(uuid) to authenticated;


-- ─── FIX 1 + 2: trusted, server-computed test submission ────────────────
create or replace function public.submit_test_attempt(p_test_id uuid, p_answers jsonb)
returns public.results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid := auth.uid();
  v_test record;
  v_subject_id uuid;
  v_total integer;
  v_score integer := 0;
  v_question record;
  v_submitted text;
  v_xp_earned integer;
  v_result public.results;
begin
  if v_student_id is null then
    raise exception 'Not authenticated.';
  end if;
  if public.current_role() <> 'student' then
    raise exception 'Only students can submit test attempts.';
  end if;

  select * into v_test from public.tests where id = p_test_id;
  if not found then
    raise exception 'Test not found.';
  end if;
  if not v_test.is_published then
    raise exception 'This test is not currently available.';
  end if;

  v_subject_id := coalesce(v_test.subject_id, public.get_subject_id_for_topic(v_test.topic_id));

  if not public.student_enrolled_in_subject(v_subject_id) then
    raise exception 'You are not enrolled in the subject this test belongs to.';
  end if;

  if v_test.question_ids is null or array_length(v_test.question_ids, 1) is null then
    raise exception 'This test has no questions yet.';
  end if;
  v_total := array_length(v_test.question_ids, 1);

  -- Score is computed ENTIRELY from server-side data: the real
  -- correct_answer column, looked up here, compared against the
  -- student's submitted answers. p_answers is only ever read by
  -- question id -> submitted text; nothing in this function ever reads
  -- a "score"/"xp"/"correct" key from client input, so there is no key
  -- a client could add to influence the result even if they tried.
  for v_question in
    select id, correct_answer from public.questions where id = any(v_test.question_ids)
  loop
    v_submitted := p_answers ->> v_question.id::text;
    if v_submitted is not null and v_submitted = v_question.correct_answer then
      v_score := v_score + 1;
    end if;
  end loop;

  v_xp_earned := round( (v_score::numeric / v_total::numeric) * 10 );

  -- Single function invocation = one atomic statement to PostgREST; if
  -- anything below raises, Postgres rolls back everything above too
  -- (including the insert), automatically. No explicit BEGIN/COMMIT is
  -- needed or valid at this level inside a plpgsql function body.
  insert into public.results (student_id, test_id, score, total)
  values (v_student_id, p_test_id, v_score, v_total)
  returning * into v_result;

  perform set_config('app.trusted_xp_update', 'true', true);
  update public.users set xp = xp + v_xp_earned where id = v_student_id;

  return v_result;
end;
$$;

revoke all on function public.submit_test_attempt(uuid, jsonb) from public;
grant execute on function public.submit_test_attempt(uuid, jsonb) to authenticated;


-- ─── FIX 1: remove the unsafe direct student INSERT path ────────────────
-- Students no longer insert into results directly at all — only
-- submit_test_attempt() writes results now (and it bypasses this policy
-- entirely anyway, running as the table-owning role under SECURITY
-- DEFINER). This policy now only governs a DIRECT REST-API insert
-- attempt, which will correctly fail for anyone who isn't an admin.
drop policy if exists "results_insert_own" on public.results;
create policy "results_insert_admin_only" on public.results for insert
  with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 15.
-- ═══════════════════════════════════════════════════════════════════════
