-- ECE Hub Buddy — Admin User Management, gap #1: teacher/employee ID.
--
-- Mirrors 20260915080107_usn_field.sql exactly (same reasoning, same
-- shape) but for teachers instead of students: nullable, loosely
-- formatted, uniquely constrained where present. No new RLS needed —
-- users_update_own_or_admin (self or admin) and
-- users_select_own_or_admin_or_teacher already govern this column the
-- same way they already govern usn.
--
-- This is the only schema change required for real admin-driven user
-- creation: profile role/full_name/phone/usn/employee_id updates and
-- student_assignments/teacher_assignments inserts by a super_admin
-- already pass through existing RLS and the existing
-- protect_sensitive_user_columns trigger unmodified — that trigger
-- only restricts NON-admin callers (`if not public.is_admin()`), so an
-- admin's own direct role/profile update was never blocked and needs
-- no new RPC, no new trusted flag, and no trigger change.

alter table public.users add column if not exists employee_id text;

alter table public.users
  add constraint users_employee_id_format_check
  check (employee_id is null or (employee_id = upper(employee_id) and employee_id ~ '^[A-Z0-9]{4,20}$'));

create unique index if not exists users_employee_id_unique_idx
  on public.users (employee_id) where employee_id is not null;
