-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 02: Users / Profiles
-- DESIGN ONLY — review before running against a real Supabase project.
-- No 'class' column (no 1st/2nd PU), no 'subscription_plan' column
-- (no payments in this platform).
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text unique not null,
  full_name       text not null default '',
  phone           text,
  role            text not null default 'student' check (role in ('student','teacher','super_admin')),
  xp              integer not null default 0,
  streak          integer not null default 0,
  avatar_url      text,
  last_active_at  timestamptz default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_users_role on public.users(role);

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at before update on public.users
  for each row execute function set_updated_at();

-- Auto-create a profile row on signup. Role always defaults to
-- 'student' — the client can never set its own role at signup.
-- Teacher/admin promotion happens only through an admin-facing flow
-- (see 04_assignments_enrollments.sql's note on teacher provisioning),
-- never through this trigger.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'phone'
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 02.
-- ═══════════════════════════════════════════════════════════════════════
