-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 09: Protected-Column Triggers
-- DESIGN ONLY — review before running against a real Supabase project.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── USERS: role/xp/streak can only change via an admin ────────────────
-- Directly ported from Bioverse (minus subscription_plan, which doesn't
-- exist in this schema).
create or replace function public.protect_sensitive_user_columns()
returns trigger as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.xp is distinct from old.xp
       or new.streak is distinct from old.streak then
      raise exception 'Not allowed to change role, xp, or streak directly.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_protect_sensitive_user_columns on public.users;
create trigger trg_protect_sensitive_user_columns
before update on public.users
for each row execute function public.protect_sensitive_user_columns();


-- ─── EXPERIMENT_ATTEMPTS: scoring fields only via trusted grading ──────
-- A student's own JWT can update circuit_snapshot/started_at/completed_at
-- (see RLS in 12_rls_virtual_lab.sql), but never score, xp_earned,
-- validation_result, or completion_status directly — those are written
-- ONLY by a server-side grading Edge Function using the service_role
-- key (auth.role() = 'service_role' when PostgREST is called with that
-- key), or by an admin for support/correction purposes.
create or replace function public.protect_attempt_scoring_columns()
returns trigger as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    if new.score is distinct from old.score
       or new.xp_earned is distinct from old.xp_earned
       or new.validation_result is distinct from old.validation_result
       or new.completion_status is distinct from old.completion_status then
      raise exception 'Not allowed to change score, xp_earned, validation_result, or completion_status directly.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_protect_attempt_scoring_columns on public.experiment_attempts;
create trigger trg_protect_attempt_scoring_columns
before update on public.experiment_attempts
for each row execute function public.protect_attempt_scoring_columns();

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 09.
-- ═══════════════════════════════════════════════════════════════════════
