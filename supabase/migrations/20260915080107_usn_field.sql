-- Phase 16G final pass, gap #1: USN was a long-standing project-level
-- schema gap (flagged in every prior IA/dashboard report). This adds a
-- nullable, uniquely-constrained USN column to users. No new RLS is
-- needed: users_update_own_or_admin already lets a student write only
-- their OWN row (so they can never touch another student's USN), and
-- users_select_own_or_admin_or_teacher already governs exactly who can
-- see a user's row (self / admin / a teacher who is assigned to that
-- student's current section) — usn simply rides along as one more
-- column inside that same, already-correct boundary.
-- Format is deliberately loose (6-15 uppercase alphanumeric) so it
-- doesn't hard-code an assumption about any specific batch/college
-- numbering scheme.

alter table public.users add column if not exists usn text;

alter table public.users
  add constraint users_usn_format_check
  check (usn is null or (usn = upper(usn) and usn ~ '^[A-Z0-9]{6,15}$'));

create unique index if not exists users_usn_unique_idx on public.users (usn) where usn is not null;
