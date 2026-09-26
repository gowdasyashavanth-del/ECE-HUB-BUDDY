-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 12: RLS — Virtual Electronics Lab
-- DESIGN ONLY — review before running against a real Supabase project.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── COMPONENT CATALOG — platform-wide, read by any authenticated
--     user (needed to render the editor's component tray), admin-only
--     write. Not subject-scoped — components aren't owned by a subject.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.lab_components enable row level security;
drop policy if exists "lab_components_select_authenticated" on public.lab_components;
create policy "lab_components_select_authenticated" on public.lab_components for select
  using (auth.role() = 'authenticated');
drop policy if exists "lab_components_write_admin_only" on public.lab_components;
create policy "lab_components_write_admin_only" on public.lab_components for all
  using (public.is_admin()) with check (public.is_admin());

alter table public.lab_component_terminals enable row level security;
drop policy if exists "lab_component_terminals_select_authenticated" on public.lab_component_terminals;
create policy "lab_component_terminals_select_authenticated" on public.lab_component_terminals for select
  using (auth.role() = 'authenticated');
drop policy if exists "lab_component_terminals_write_admin_only" on public.lab_component_terminals;
create policy "lab_component_terminals_write_admin_only" on public.lab_component_terminals for all
  using (public.is_admin()) with check (public.is_admin());

alter table public.lab_component_properties enable row level security;
drop policy if exists "lab_component_properties_select_authenticated" on public.lab_component_properties;
create policy "lab_component_properties_select_authenticated" on public.lab_component_properties for select
  using (auth.role() = 'authenticated');
drop policy if exists "lab_component_properties_write_admin_only" on public.lab_component_properties;
create policy "lab_component_properties_write_admin_only" on public.lab_component_properties for all
  using (public.is_admin()) with check (public.is_admin());


-- ═══════════════════════════════════════════════════════════════════════
-- EXPERIMENTS — subject-scoped via topic_id, published/draft gating
-- identical in shape to 'content'.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.experiments enable row level security;

drop policy if exists "experiments_select" on public.experiments;
create policy "experiments_select" on public.experiments for select
  using (
    public.is_admin()
    or public.teacher_has_subject(public.get_subject_id_for_topic(topic_id))
    or (is_published = true and public.student_enrolled_in_subject(public.get_subject_id_for_topic(topic_id)))
  );
drop policy if exists "experiments_insert" on public.experiments;
create policy "experiments_insert" on public.experiments for insert
  with check (public.is_admin() or public.teacher_has_subject(public.get_subject_id_for_topic(topic_id)));
drop policy if exists "experiments_update" on public.experiments;
create policy "experiments_update" on public.experiments for update
  using (public.is_admin() or public.teacher_has_subject(public.get_subject_id_for_topic(topic_id)))
  with check (public.is_admin() or public.teacher_has_subject(public.get_subject_id_for_topic(topic_id)));
drop policy if exists "experiments_delete_admin_only" on public.experiments;
create policy "experiments_delete_admin_only" on public.experiments for delete
  using (public.is_admin());


-- ─── EXPERIMENT_REQUIRED_COMPONENTS / EXPERIMENT_QUESTIONS — inherit
--     their parent experiment's subject scoping. ────────────────────────
alter table public.experiment_required_components enable row level security;

drop policy if exists "experiment_required_components_select" on public.experiment_required_components;
create policy "experiment_required_components_select" on public.experiment_required_components for select
  using (
    exists (
      select 1 from public.experiments e
      where e.id = experiment_required_components.experiment_id
        and (
          public.is_admin()
          or public.teacher_has_subject(public.get_subject_id_for_topic(e.topic_id))
          or (e.is_published = true and public.student_enrolled_in_subject(public.get_subject_id_for_topic(e.topic_id)))
        )
    )
  );
drop policy if exists "experiment_required_components_write" on public.experiment_required_components;
create policy "experiment_required_components_write" on public.experiment_required_components for all
  using (
    exists (
      select 1 from public.experiments e
      where e.id = experiment_required_components.experiment_id
        and (public.is_admin() or public.teacher_has_subject(public.get_subject_id_for_topic(e.topic_id)))
    )
  )
  with check (
    exists (
      select 1 from public.experiments e
      where e.id = experiment_required_components.experiment_id
        and (public.is_admin() or public.teacher_has_subject(public.get_subject_id_for_topic(e.topic_id)))
    )
  );

alter table public.experiment_questions enable row level security;

drop policy if exists "experiment_questions_select" on public.experiment_questions;
create policy "experiment_questions_select" on public.experiment_questions for select
  using (
    exists (
      select 1 from public.experiments e
      where e.id = experiment_questions.experiment_id
        and (
          public.is_admin()
          or public.teacher_has_subject(public.get_subject_id_for_topic(e.topic_id))
          or (e.is_published = true and public.student_enrolled_in_subject(public.get_subject_id_for_topic(e.topic_id)))
        )
    )
  );
drop policy if exists "experiment_questions_write" on public.experiment_questions;
create policy "experiment_questions_write" on public.experiment_questions for all
  using (
    exists (
      select 1 from public.experiments e
      where e.id = experiment_questions.experiment_id
        and (public.is_admin() or public.teacher_has_subject(public.get_subject_id_for_topic(e.topic_id)))
    )
  )
  with check (
    exists (
      select 1 from public.experiments e
      where e.id = experiment_questions.experiment_id
        and (public.is_admin() or public.teacher_has_subject(public.get_subject_id_for_topic(e.topic_id)))
    )
  );


-- ═══════════════════════════════════════════════════════════════════════
-- STUDENT_CIRCUITS — strict ownership. Not visible to teachers by
-- default (a circuit is the student's own workspace) — a future
-- "share for review" feature should be a deliberate new table/policy,
-- not a blanket teacher-read grant added here.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.student_circuits enable row level security;
drop policy if exists "student_circuits_own" on public.student_circuits;
create policy "student_circuits_own" on public.student_circuits for all
  using (student_id = auth.uid() or public.is_admin())
  with check (student_id = auth.uid());


-- ═══════════════════════════════════════════════════════════════════════
-- EXPERIMENT_ATTEMPTS — student sees/edits their own; teacher sees
-- (read-only) attempts for experiments under a subject they're
-- assigned to, for grading dashboards. Column-level protection of
-- score/xp_earned/validation_result/completion_status is enforced by
-- the trigger in 09_protected_columns_triggers.sql — this RLS layer
-- only controls which ROWS a student can touch, not which columns.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.experiment_attempts enable row level security;

drop policy if exists "experiment_attempts_select" on public.experiment_attempts;
create policy "experiment_attempts_select" on public.experiment_attempts for select
  using (
    student_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.experiments e
      where e.id = experiment_attempts.experiment_id
        and public.teacher_has_subject(public.get_subject_id_for_topic(e.topic_id))
    )
  );
drop policy if exists "experiment_attempts_insert_own" on public.experiment_attempts;
create policy "experiment_attempts_insert_own" on public.experiment_attempts for insert
  with check (student_id = auth.uid());
drop policy if exists "experiment_attempts_update_own_or_trusted" on public.experiment_attempts;
create policy "experiment_attempts_update_own_or_trusted" on public.experiment_attempts for update
  using (student_id = auth.uid() or auth.role() = 'service_role' or public.is_admin())
  with check (student_id = auth.uid() or auth.role() = 'service_role' or public.is_admin());
drop policy if exists "experiment_attempts_delete_admin_only" on public.experiment_attempts;
create policy "experiment_attempts_delete_admin_only" on public.experiment_attempts for delete
  using (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 12.
-- ═══════════════════════════════════════════════════════════════════════
