-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 11: RLS — Learning Content & Engagement
-- DESIGN ONLY — review before running against a real Supabase project.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── FORMULAS — subject-scoped, same shape as content ──────────────────
alter table public.formulas enable row level security;

drop policy if exists "formulas_select" on public.formulas;
create policy "formulas_select" on public.formulas for select
  using (
    public.is_admin()
    or public.teacher_has_subject(subject_id)
    or public.student_enrolled_in_subject(subject_id)
  );
drop policy if exists "formulas_insert" on public.formulas;
create policy "formulas_insert" on public.formulas for insert
  with check (public.is_admin() or public.teacher_has_subject(subject_id));
drop policy if exists "formulas_update" on public.formulas;
create policy "formulas_update" on public.formulas for update
  using (public.is_admin() or public.teacher_has_subject(subject_id))
  with check (public.is_admin() or public.teacher_has_subject(subject_id));
drop policy if exists "formulas_delete_admin_only" on public.formulas;
create policy "formulas_delete_admin_only" on public.formulas for delete
  using (public.is_admin());


-- ─── QUESTIONS — topic-scoped (resolve subject via helper) ─────────────
alter table public.questions enable row level security;

drop policy if exists "questions_select" on public.questions;
create policy "questions_select" on public.questions for select
  using (
    public.is_admin()
    or public.teacher_has_subject(public.get_subject_id_for_topic(topic_id))
    or public.student_enrolled_in_subject(public.get_subject_id_for_topic(topic_id))
  );
drop policy if exists "questions_insert" on public.questions;
create policy "questions_insert" on public.questions for insert
  with check (public.is_admin() or public.teacher_has_subject(public.get_subject_id_for_topic(topic_id)));
drop policy if exists "questions_update" on public.questions;
create policy "questions_update" on public.questions for update
  using (public.is_admin() or public.teacher_has_subject(public.get_subject_id_for_topic(topic_id)))
  with check (public.is_admin() or public.teacher_has_subject(public.get_subject_id_for_topic(topic_id)));
drop policy if exists "questions_delete_admin_only" on public.questions;
create policy "questions_delete_admin_only" on public.questions for delete
  using (public.is_admin());


-- ─── TESTS — scoped via its own subject_id OR topic_id column ──────────
alter table public.tests enable row level security;

drop policy if exists "tests_select" on public.tests;
create policy "tests_select" on public.tests for select
  using (
    public.is_admin()
    or public.teacher_has_subject(coalesce(subject_id, public.get_subject_id_for_topic(topic_id)))
    or (is_published = true and public.student_enrolled_in_subject(coalesce(subject_id, public.get_subject_id_for_topic(topic_id))))
  );
drop policy if exists "tests_insert" on public.tests;
create policy "tests_insert" on public.tests for insert
  with check (public.is_admin() or public.teacher_has_subject(coalesce(subject_id, public.get_subject_id_for_topic(topic_id))));
drop policy if exists "tests_update" on public.tests;
create policy "tests_update" on public.tests for update
  using (public.is_admin() or public.teacher_has_subject(coalesce(subject_id, public.get_subject_id_for_topic(topic_id))))
  with check (public.is_admin() or public.teacher_has_subject(coalesce(subject_id, public.get_subject_id_for_topic(topic_id))));
drop policy if exists "tests_delete_admin_only" on public.tests;
create policy "tests_delete_admin_only" on public.tests for delete
  using (public.is_admin());


-- ─── RESULTS — student owns their own; teacher sees results for their
--     subject's tests only (not every result); immutable once written
--     except by admin (same "results can't be edited after the fact"
--     principle Bioverse used).
-- ═══════════════════════════════════════════════════════════════════════
alter table public.results enable row level security;

drop policy if exists "results_select" on public.results;
create policy "results_select" on public.results for select
  using (
    student_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.tests t
      where t.id = results.test_id
        and public.teacher_has_subject(coalesce(t.subject_id, public.get_subject_id_for_topic(t.topic_id)))
    )
  );
drop policy if exists "results_insert_own" on public.results;
create policy "results_insert_own" on public.results for insert
  with check (student_id = auth.uid());
drop policy if exists "results_update_admin_only" on public.results;
create policy "results_update_admin_only" on public.results for update
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "results_delete_admin_only" on public.results;
create policy "results_delete_admin_only" on public.results for delete
  using (public.is_admin());


-- ─── ANNOUNCEMENTS ──────────────────────────────────────────────────────
-- Visibility: a student's CURRENT academic-context chain (their
-- section, and every ancestor above it — semester, program, regulation,
-- academic year) all match against student_assignments' own FK columns
-- directly, no extra joins needed since that row already denormalizes
-- the full chain. A teacher's context is derived from their assigned
-- sections, joined up through sections -> semesters -> programs ->
-- regulations -> academic_years.
--
-- Authoring: admins may post at any scope. Teachers are only
-- authorized to manage the SECTION level (the one level they actually
-- have an assignment record for) — 'academic_year'/'regulation'/
-- 'program'/'semester' are structural/global announcements reserved
-- for admins, matching "teachers may only create/publish within the
-- academic scope they are authorized to manage."
alter table public.announcements enable row level security;

drop policy if exists "announcements_select" on public.announcements;
create policy "announcements_select" on public.announcements for select
  using (
    scope_type = 'all'
    or public.is_admin()
    or (scope_type = 'academic_year' and exists (
          select 1 from public.student_assignments sa
          where sa.student_id = auth.uid() and sa.is_current and sa.academic_year_id = announcements.scope_id
        ))
    or (scope_type = 'regulation' and exists (
          select 1 from public.student_assignments sa
          where sa.student_id = auth.uid() and sa.is_current and sa.regulation_id = announcements.scope_id
        ))
    or (scope_type = 'program' and exists (
          select 1 from public.student_assignments sa
          where sa.student_id = auth.uid() and sa.is_current and sa.program_id = announcements.scope_id
        ))
    or (scope_type = 'semester' and exists (
          select 1 from public.student_assignments sa
          where sa.student_id = auth.uid() and sa.is_current and sa.semester_id = announcements.scope_id
        ))
    or (scope_type = 'section' and exists (
          select 1 from public.student_assignments sa
          where sa.student_id = auth.uid() and sa.is_current and sa.section_id = announcements.scope_id
        ))
    or (scope_type = 'section' and exists (
          select 1 from public.teacher_assignments ta
          where ta.teacher_id = auth.uid() and ta.section_id = announcements.scope_id
        ))
    or (scope_type in ('academic_year','regulation','program','semester') and exists (
          select 1 from public.teacher_assignments ta
          join public.sections sec on sec.id = ta.section_id
          join public.semesters sem on sem.id = sec.semester_id
          join public.programs p on p.id = sem.program_id
          join public.regulations r on r.id = p.regulation_id
          where ta.teacher_id = auth.uid()
            and (
              (announcements.scope_type = 'academic_year' and sec.academic_year_id = announcements.scope_id)
              or (announcements.scope_type = 'regulation' and r.id = announcements.scope_id)
              or (announcements.scope_type = 'program' and p.id = announcements.scope_id)
              or (announcements.scope_type = 'semester' and sem.id = announcements.scope_id)
            )
        ))
  );

drop policy if exists "announcements_insert" on public.announcements;
create policy "announcements_insert" on public.announcements for insert
  with check (
    public.is_admin()
    or (scope_type = 'section' and exists (
          select 1 from public.teacher_assignments ta where ta.teacher_id = auth.uid() and ta.section_id = scope_id
        ))
  );
drop policy if exists "announcements_delete_admin_only" on public.announcements;
create policy "announcements_delete_admin_only" on public.announcements for delete
  using (public.is_admin());


-- ─── REELS — cross-cutting content, not subject-security-critical;
--     kept at the same "teacher/admin manage, published visible to
--     all" granularity Bioverse used for videos. ─────────────────────
alter table public.reels enable row level security;

drop policy if exists "reels_select" on public.reels;
create policy "reels_select" on public.reels for select
  using (is_published = true or public.is_teacher_or_admin());
drop policy if exists "reels_insert_teacher_or_admin" on public.reels;
create policy "reels_insert_teacher_or_admin" on public.reels for insert
  with check (public.is_teacher_or_admin());
drop policy if exists "reels_update_teacher_or_admin" on public.reels;
create policy "reels_update_teacher_or_admin" on public.reels for update
  using (public.is_teacher_or_admin()) with check (public.is_teacher_or_admin());
drop policy if exists "reels_delete_admin_only" on public.reels;
create policy "reels_delete_admin_only" on public.reels for delete
  using (public.is_admin());

alter table public.reel_bookmarks enable row level security;
drop policy if exists "reel_bookmarks_own" on public.reel_bookmarks;
create policy "reel_bookmarks_own" on public.reel_bookmarks for all
  using (student_id = auth.uid() or public.is_admin())
  with check (student_id = auth.uid());

alter table public.reel_watch_history enable row level security;
drop policy if exists "reel_watch_history_own" on public.reel_watch_history;
create policy "reel_watch_history_own" on public.reel_watch_history for all
  using (student_id = auth.uid() or public.is_admin())
  with check (student_id = auth.uid());


-- ─── PROGRESS — student owns their own; teacher reads only for
--     subjects they're assigned to; admin-only delete. ─────────────────
alter table public.progress enable row level security;

drop policy if exists "progress_select" on public.progress;
create policy "progress_select" on public.progress for select
  using (
    student_id = auth.uid()
    or public.is_admin()
    or public.teacher_has_subject(public.get_subject_id_for_topic(topic_id))
  );
drop policy if exists "progress_insert_own" on public.progress;
create policy "progress_insert_own" on public.progress for insert
  with check (student_id = auth.uid());
drop policy if exists "progress_update_own" on public.progress;
create policy "progress_update_own" on public.progress for update
  using (student_id = auth.uid()) with check (student_id = auth.uid());
drop policy if exists "progress_delete_admin_only" on public.progress;
create policy "progress_delete_admin_only" on public.progress for delete
  using (public.is_admin());


-- ─── ACHIEVEMENTS (catalog) + STUDENT_ACHIEVEMENTS (awards) ────────────
alter table public.achievements enable row level security;
drop policy if exists "achievements_select_authenticated" on public.achievements;
create policy "achievements_select_authenticated" on public.achievements for select
  using (auth.role() = 'authenticated');
drop policy if exists "achievements_write_admin_only" on public.achievements;
create policy "achievements_write_admin_only" on public.achievements for all
  using (public.is_admin()) with check (public.is_admin());

alter table public.student_achievements enable row level security;
drop policy if exists "student_achievements_select" on public.student_achievements;
create policy "student_achievements_select" on public.student_achievements for select
  using (student_id = auth.uid() or public.is_admin());
-- No student insert policy: achievements are awarded by trusted
-- server-side logic (service_role) or admin, never self-granted —
-- same principle as XP/score protection elsewhere in this schema.
drop policy if exists "student_achievements_write_trusted_only" on public.student_achievements;
create policy "student_achievements_write_trusted_only" on public.student_achievements for insert
  with check (auth.role() = 'service_role' or public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 11.
-- ═══════════════════════════════════════════════════════════════════════
