-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 08: Security Helper Functions
-- DESIGN ONLY — review before running against a real Supabase project.
--
-- Directly ported pattern from Bioverse's 03_rls_policies.sql:
-- security definer + stable, so these can be called from inside RLS
-- policies on public.users itself without infinite recursion.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.current_role()
returns text
language sql security definer stable set search_path = public
as $$ select role from public.users where id = auth.uid(); $$;

create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public
as $$ select public.current_role() = 'super_admin'; $$;

create or replace function public.is_teacher_or_admin() returns boolean
language sql security definer stable set search_path = public
as $$ select public.current_role() in ('teacher','super_admin'); $$;

-- true if the calling teacher is assigned to this subject (via ANY
-- section — content lives at subject/unit/topic level, not per-section,
-- so section-level granularity isn't needed for content access).
create or replace function public.teacher_has_subject(p_subject_id uuid) returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.teacher_assignments
    where teacher_id = auth.uid() and subject_id = p_subject_id
  );
$$;

-- true if the calling student's CURRENT assignment places them in the
-- semester this subject belongs to.
create or replace function public.student_enrolled_in_subject(p_subject_id uuid) returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1
    from public.student_assignments sa
    join public.subjects s on s.semester_id = sa.semester_id
    where sa.student_id = auth.uid() and sa.is_current and s.id = p_subject_id
  );
$$;

-- Small composable helper: several tables (content, questions,
-- experiments) reference topic_id but not subject_id directly. Rather
-- than repeat this join in every RLS policy below, resolve it once here.
create or replace function public.get_subject_id_for_topic(p_topic_id uuid) returns uuid
language sql security definer stable set search_path = public
as $$
  select u.subject_id
  from public.topics t
  join public.units u on u.id = t.unit_id
  where t.id = p_topic_id;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 08.
-- ═══════════════════════════════════════════════════════════════════════
