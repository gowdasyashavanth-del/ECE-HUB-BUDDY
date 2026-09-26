-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 19: First super_admin bootstrap mechanism
--
-- CONTEXT (Phase 13.3): protect_sensitive_user_columns() correctly
-- refuses any role change unless is_admin() is true, and is_admin()
-- looks up the CALLER's own row in public.users. With zero super_admin
-- rows in existence, that check can never pass for anyone — a genuine,
-- by-design bootstrap deadlock, not a bug. This migration adds a single,
-- narrowly-scoped, one-time escape hatch for establishing the FIRST
-- super_admin only, and closes itself permanently the moment that first
-- super_admin exists.
--
-- THIS MIGRATION DOES NOT ASSIGN ANYONE. It only creates the mechanism.
-- No email, no UUID, and no role assignment happens here. The actual
-- bootstrap call (`select public.bootstrap_first_super_admin('<uuid>');`)
-- is a separate, explicit, human-approved action to be run afterward.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── STEP 1: extend the existing trigger with a self-closing exception ──
-- Same function, same trigger, same call sites as before (migration 09,
-- amended by migration 17) — only the role-branch logic changes.
create or replace function public.protect_sensitive_user_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trusted boolean := current_setting('app.trusted_engagement_update', true) = 'true';
  -- Set ONLY inside bootstrap_first_super_admin() below, for the
  -- duration of that function's own transaction. No client can ever
  -- set this: clients only ever call declared RPCs or query tables
  -- through PostgREST/Supabase-js — never raw SQL, never set_config().
  v_first_admin_bootstrap boolean := current_setting('app.first_admin_bootstrap', true) = 'true';
begin
  if not public.is_admin() then
    if new.role is distinct from old.role then
      -- One-time first-admin bootstrap exception. Requires ALL three:
      --   (a) the transaction-local bootstrap flag is set,
      --   (b) the target role is exactly 'super_admin' (never teacher,
      --       never anything else — this is not a general role-change
      --       bypass),
      --   (c) zero super_admin rows exist RIGHT NOW (re-checked here
      --       independently — not just trusted from the flag, so this
      --       branch has no reliance on bootstrap_first_super_admin()
      --       having verified it correctly).
      -- The moment any super_admin row exists, condition (c) can never
      -- be true again — this exception permanently and automatically
      -- closes itself after its first successful use and never reopens,
      -- with no separate revert step required.
      if v_first_admin_bootstrap
         and new.role = 'super_admin'
         and not exists (select 1 from public.users where role = 'super_admin')
      then
        null; -- allowed: first-admin bootstrap only
      else
        raise exception 'Not allowed to change role directly.';
      end if;
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
$$;

-- ─── STEP 2: the dedicated bootstrap function itself ────────────────────
-- Deliberately minimal: takes only a UUID, touches only
-- public.users.role, never touches auth.users, never disables RLS,
-- never suppresses any trigger.
create or replace function public.bootstrap_first_super_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (select 1 from public.users where role = 'super_admin') then
    raise exception 'Bootstrap refused: a super_admin already exists. This function only ever establishes the FIRST super_admin and cannot be used again.';
  end if;

  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'Bootstrap refused: no public.users row exists for that id.';
  end if;

  -- true = transaction-local (per set_config's own semantics) — this
  -- flag never outlives this single statement's transaction and is
  -- never visible to, or settable by, any other session or client.
  perform set_config('app.first_admin_bootstrap', 'true', true);

  update public.users set role = 'super_admin' where id = p_user_id;
end;
$$;

-- No permanent application-facing RPC path (requirement 14): revoke
-- from PUBLIC and BOTH client-facing roles explicitly, mirroring the
-- exact pattern already established in Migration 16 for the same
-- reason (Supabase grants EXECUTE to anon/authenticated separately
-- from PUBLIC on function creation — revoking PUBLIC alone is not
-- sufficient).
revoke all on function public.bootstrap_first_super_admin(uuid) from public;
revoke all on function public.bootstrap_first_super_admin(uuid) from anon;
revoke all on function public.bootstrap_first_super_admin(uuid) from authenticated;
-- No GRANT EXECUTE to anon/authenticated is added — the only callers
-- left with privilege to run this are roles with direct database
-- ownership (the `postgres` role used by migrations and the Supabase
-- SQL Editor / service connection), matching requirement 13.

-- ─── STEP 3 (manual, NOT part of this migration): perform the bootstrap ─
-- Only after this migration is reviewed and approved, run exactly one
-- statement, once, with the target user's real public.users.id:
--
--   select public.bootstrap_first_super_admin('<uuid-of-the-intended-first-admin>');
--
-- Then, since nothing else ever depends on this function existing,
-- it can be dropped immediately (requirement 15):
--
--   drop function public.bootstrap_first_super_admin(uuid);
--
-- Dropping it does not need to touch protect_sensitive_user_columns()
-- again — that function's bootstrap branch is already permanently
-- unreachable once a super_admin exists, by construction.

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 19.
-- ═══════════════════════════════════════════════════════════════════════
