-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 17: Progress, Streak, Achievements (secure)
--
-- Phase 9 investigation (approved before this migration was written)
-- found: progress had the same insecure-client-write bug results had
-- pre-Phase-8; streak had zero mutation logic anywhere (not a bug, just
-- unbuilt); achievements/student_achievements already existed with
-- correct RLS but nothing ever awarded them; no content-completion
-- tracking existed at all.
--
-- One new table only (content_completions — a completion LOG that
-- FEEDS progress, not a competing progress system). No Branch, no
-- academic hierarchy change, no duplicate XP/role/auth systems.
-- ═══════════════════════════════════════════════════════════════════════


-- ─── NEW TABLE: content_completions ──────────────────────────────────────
create table if not exists public.content_completions (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.users(id) on delete cascade,
  content_id     uuid not null references public.content(id) on delete cascade,
  completed_at   timestamptz not null default now(),
  unique (student_id, content_id)
);
create index if not exists idx_content_completions_student on public.content_completions(student_id);
create index if not exists idx_content_completions_content on public.content_completions(content_id);

alter table public.content_completions enable row level security;

drop policy if exists "content_completions_select" on public.content_completions;
create policy "content_completions_select" on public.content_completions for select
  using (
    student_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.content c
      where c.id = content_completions.content_id
        and public.teacher_has_subject(public.get_subject_id_for_topic(c.topic_id))
    )
  );

-- No student insert/update policy at all — completions are recorded
-- ONLY via mark_content_complete() below, which bypasses RLS as the
-- table-owning role under SECURITY DEFINER (same mechanism already
-- established for results/submit_test_attempt in Phase 8).
drop policy if exists "content_completions_admin_only_write" on public.content_completions;
create policy "content_completions_admin_only_write" on public.content_completions for all
  using (public.is_admin()) with check (public.is_admin());


-- ─── LOCK DOWN progress: remove direct student write ────────────────────
drop policy if exists "progress_insert_own" on public.progress;
drop policy if exists "progress_update_own" on public.progress;
drop policy if exists "progress_delete_admin_only" on public.progress;
create policy "progress_write_admin_only" on public.progress for all
  using (public.is_admin()) with check (public.is_admin());
-- progress_select is UNCHANGED (still own/admin/teacher-of-subject) —
-- re-verified live after this migration, not just assumed.


-- ─── ENGAGEMENT PROTECTION: generalize the Phase 8 trusted-XP flag to
--     also cover streak, under the same narrow mechanism. role stays
--     unconditionally admin-only — this does not touch that at all.
create or replace function public.protect_sensitive_user_columns()
returns trigger as $$
declare
  v_trusted boolean := current_setting('app.trusted_engagement_update', true) = 'true';
begin
  if not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Not allowed to change role directly.';
    end if;
    if new.xp is distinct from old.xp and not v_trusted then
      raise exception 'Not allowed to change xp directly.';
    end if;
    if new.streak is distinct from old.streak and not v_trusted then
      raise exception 'Not allowed to change streak directly.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;


-- ─── INTERNAL HELPER 1: recompute a topic's progress from real data ─────
-- Not exposed to any client role — only called from within
-- mark_content_complete() below.
create or replace function public.recalc_topic_progress(p_student_id uuid, p_topic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_done integer;
  v_pct integer;
begin
  select count(*) into v_total from public.content where topic_id = p_topic_id and is_published = true;

  if v_total = 0 then
    v_pct := 0;
  else
    select count(*) into v_done
    from public.content_completions cc
    join public.content c on c.id = cc.content_id
    where cc.student_id = p_student_id
      and c.topic_id = p_topic_id
      and c.is_published = true;
    v_pct := round( (v_done::numeric / v_total::numeric) * 100 );
  end if;

  insert into public.progress (student_id, topic_id, percent_done, updated_at)
  values (p_student_id, p_topic_id, v_pct, now())
  on conflict (student_id, topic_id) do update set percent_done = excluded.percent_done, updated_at = now();
end;
$$;
revoke all on function public.recalc_topic_progress(uuid, uuid) from public, anon, authenticated;


-- ─── INTERNAL HELPER 2: UTC daily-activity / streak update ──────────────
-- same-day        -> no change (already active today)
-- exactly 1 day    -> streak + 1
-- gap > 1 day, or first-ever activity -> reset to 1
-- Self-contained: sets its own trusted flag right before its own
-- write, so it's safe to call from anywhere without relying on a
-- caller to have set anything first.
create or replace function public.record_daily_activity(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_date date;
  v_current_streak integer;
  v_today date := (now() at time zone 'utc')::date;
  v_new_streak integer;
begin
  select streak, (last_active_at at time zone 'utc')::date
    into v_current_streak, v_last_date
  from public.users where id = p_student_id;

  if v_last_date is null or v_last_date < v_today - 1 then
    v_new_streak := 1;
  elsif v_last_date = v_today - 1 then
    v_new_streak := v_current_streak + 1;
  else
    return; -- already active today; nothing to change
  end if;

  perform set_config('app.trusted_engagement_update', 'true', true);
  update public.users set streak = v_new_streak, last_active_at = now() where id = p_student_id;
end;
$$;
revoke all on function public.record_daily_activity(uuid) from public, anon, authenticated;


-- ─── INTERNAL HELPER 3: award an achievement if earned and not already
--     held. Idempotent by construction: student_achievements' existing
--     unique(student_id, achievement_id) + ON CONFLICT DO NOTHING.
--     Safely no-ops if the catalog doesn't have this key yet (the
--     achievements table is currently EMPTY — an admin still needs to
--     create these 4 rows; this function does not seed them itself).
create or replace function public.award_achievement_if_earned(p_student_id uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_achievement_id uuid;
  v_earned boolean := false;
  v_xp integer;
  v_streak integer;
  v_count integer;
begin
  select id into v_achievement_id from public.achievements where key = p_key;
  if v_achievement_id is null then
    return;
  end if;

  if exists (select 1 from public.student_achievements where student_id = p_student_id and achievement_id = v_achievement_id) then
    return;
  end if;

  if p_key = 'first_test_completed' then
    select count(*) into v_count from public.results where student_id = p_student_id;
    v_earned := v_count >= 1;
  elsif p_key = 'first_content_completed' then
    select count(*) into v_count from public.content_completions where student_id = p_student_id;
    v_earned := v_count >= 1;
  elsif p_key = 'seven_day_streak' then
    select streak into v_streak from public.users where id = p_student_id;
    v_earned := v_streak >= 7;
  elsif p_key = 'hundred_xp' then
    select xp into v_xp from public.users where id = p_student_id;
    v_earned := v_xp >= 100;
  end if;

  if v_earned then
    insert into public.student_achievements (student_id, achievement_id)
    values (p_student_id, v_achievement_id)
    on conflict (student_id, achievement_id) do nothing;
  end if;
end;
$$;
revoke all on function public.award_achievement_if_earned(uuid, text) from public, anon, authenticated;


-- ─── STUDENT-FACING RPC: mark_content_complete ──────────────────────────
create or replace function public.mark_content_complete(p_content_id uuid)
returns public.progress
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid := auth.uid();
  v_content record;
  v_subject_id uuid;
  v_result public.progress;
begin
  if v_student_id is null then
    raise exception 'Not authenticated.';
  end if;
  if public.current_role() <> 'student' then
    raise exception 'Only students can mark content complete.';
  end if;

  select * into v_content from public.content where id = p_content_id;
  if not found then
    raise exception 'Content not found.';
  end if;
  if not v_content.is_published then
    raise exception 'This content is not currently available.';
  end if;

  v_subject_id := public.get_subject_id_for_topic(v_content.topic_id);
  if not public.student_enrolled_in_subject(v_subject_id) then
    raise exception 'You are not enrolled in the subject this content belongs to.';
  end if;

  insert into public.content_completions (student_id, content_id)
  values (v_student_id, p_content_id)
  on conflict (student_id, content_id) do nothing;

  perform public.recalc_topic_progress(v_student_id, v_content.topic_id);
  perform public.record_daily_activity(v_student_id);
  perform public.award_achievement_if_earned(v_student_id, 'first_content_completed');
  perform public.award_achievement_if_earned(v_student_id, 'seven_day_streak');
  perform public.award_achievement_if_earned(v_student_id, 'hundred_xp');

  select * into v_result from public.progress where student_id = v_student_id and topic_id = v_content.topic_id;
  return v_result;
end;
$$;
revoke all on function public.mark_content_complete(uuid) from public, anon;
grant execute on function public.mark_content_complete(uuid) to authenticated;


-- ─── UPDATE submit_test_attempt: anti-farming XP + streak + achievements
-- Only the first-ever result row for (student, test) awards XP;
-- retakes still insert a fully legitimate, honestly-scored result row
-- (so history/analytics stay accurate), just with xp_earned effectively
-- zero this time (no xp update is issued at all when v_is_first_attempt
-- is false).
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
  v_is_first_attempt boolean;
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

  v_is_first_attempt := not exists (
    select 1 from public.results where student_id = v_student_id and test_id = p_test_id
  );

  for v_question in
    select id, correct_answer from public.questions where id = any(v_test.question_ids)
  loop
    v_submitted := p_answers ->> v_question.id::text;
    if v_submitted is not null and v_submitted = v_question.correct_answer then
      v_score := v_score + 1;
    end if;
  end loop;

  insert into public.results (student_id, test_id, score, total)
  values (v_student_id, p_test_id, v_score, v_total)
  returning * into v_result;

  if v_is_first_attempt then
    v_xp_earned := round( (v_score::numeric / v_total::numeric) * 10 );
    if v_xp_earned > 0 then
      perform set_config('app.trusted_engagement_update', 'true', true);
      update public.users set xp = xp + v_xp_earned where id = v_student_id;
    end if;
  end if;

  perform public.record_daily_activity(v_student_id);
  perform public.award_achievement_if_earned(v_student_id, 'first_test_completed');
  perform public.award_achievement_if_earned(v_student_id, 'seven_day_streak');
  perform public.award_achievement_if_earned(v_student_id, 'hundred_xp');

  return v_result;
end;
$$;
revoke all on function public.submit_test_attempt(uuid, jsonb) from public, anon;
grant execute on function public.submit_test_attempt(uuid, jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 17.
-- ═══════════════════════════════════════════════════════════════════════
