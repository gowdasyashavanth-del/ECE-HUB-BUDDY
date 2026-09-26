-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 21: Phase 16A Academic Operations DB Foundation
--
-- Adds six new pieces of schema, all built on the existing hierarchy
-- and existing helpers (current_role, is_admin, is_teacher_or_admin,
-- teacher_has_subject, teacher_has_section, student_enrolled_in_subject)
-- rather than duplicating any authorization logic:
--
--   1. class_teacher_assignments — section-specific designation, NOT a
--      new role. History preserved via is_current/ended_at.
--   2. cr_designations — CR1/CR2 student-section designation, NOT a
--      role. Same history pattern.
--   3. lab_batches + student_lab_batch_assignments — a real entity
--      (not hardcoded A1/A2 strings) plus a history-preserving
--      assignment table.
--   4. timetable_entries — flexible slot model supporting lectures,
--      labs split by batch, and non-lecture blocks (activity/break).
--   5. attendance_records + attendance_audit_log — subject-wise,
--      student-wise attendance with a same-day correction window for
--      ordinary subject teachers and a full audit trail on correction.
--   6. ia_assessments + ia_marks — normalized IA1/2/3 definitions and
--      marks, never columns on users/students.
--
-- This is a DATABASE FOUNDATION migration only — no frontend pages, no
-- seeding of the real 3A/3B/3C timetable. Every new table has RLS
-- enabled from the moment it's created; there is no window where a new
-- table exists without policies.
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- Shared helpers (new)
-- ───────────────────────────────────────────────────────────────────────
-- Note: is_class_teacher_of_section() is defined further below, right
-- after the class_teacher_assignments table it queries is created
-- (a LANGUAGE SQL function is validated against the catalog at CREATE
-- time, so it can't reference a table that doesn't exist yet).

-- True if p_student_id is CURRENTLY assigned to p_section_id. Used by
-- the CR / lab-batch validation triggers below (and reusable by RLS).
-- Distinct from student_enrolled_in_subject(), which is deliberately
-- bound to auth.uid() as the student; this one takes an explicit
-- student id because callers here are teachers/admins acting on a
-- student, not the student acting on themselves.
create or replace function public.student_currently_in_section(p_student_id uuid, p_section_id uuid) returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.student_assignments
    where student_id = p_student_id and section_id = p_section_id and is_current
  );
$$;

-- True if p_student_id is CURRENTLY enrolled in p_subject_id (i.e. the
-- subject's semester matches the student's current assignment) — the
-- explicit-student-id counterpart to student_enrolled_in_subject(),
-- needed for IA-marks authorization where the caller is a teacher.
create or replace function public.student_currently_in_subject(p_student_id uuid, p_subject_id uuid) returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1
    from public.student_assignments sa
    join public.subjects s on s.semester_id = sa.semester_id
    where sa.student_id = p_student_id and sa.is_current and s.id = p_subject_id
  );
$$;

revoke all on function public.student_currently_in_section(uuid, uuid) from public;
revoke execute on function public.student_currently_in_section(uuid, uuid) from anon;
grant execute on function public.student_currently_in_section(uuid, uuid) to authenticated;

revoke all on function public.student_currently_in_subject(uuid, uuid) from public;
revoke execute on function public.student_currently_in_subject(uuid, uuid) from anon;
grant execute on function public.student_currently_in_subject(uuid, uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
-- 1. CLASS TEACHER ASSIGNMENT
-- ═══════════════════════════════════════════════════════════════════════

create table public.class_teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.users(id),
  section_id uuid not null references public.sections(id),
  is_current boolean not null default true,
  assigned_by uuid references public.users(id),
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index class_teacher_assignments_teacher_idx on public.class_teacher_assignments (teacher_id);
create index class_teacher_assignments_section_idx on public.class_teacher_assignments (section_id);

-- True if the caller is the CURRENT class teacher of this section.
-- Mirrors the existing teacher_has_section() helper exactly in style.
-- Defined here (not in the shared-helpers block above) because it's a
-- LANGUAGE SQL function, which Postgres validates against the catalog
-- at CREATE time — it needs this table to already exist.
create or replace function public.is_class_teacher_of_section(p_section_id uuid) returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.class_teacher_assignments
    where teacher_id = auth.uid() and section_id = p_section_id and is_current
  );
$$;

revoke all on function public.is_class_teacher_of_section(uuid) from public;
revoke execute on function public.is_class_teacher_of_section(uuid) from anon;
grant execute on function public.is_class_teacher_of_section(uuid) to authenticated;

-- One active class teacher per section (per requirements: enforce
-- unless multiple are explicitly required, which they are not here).
create unique index class_teacher_assignments_one_current_per_section
  on public.class_teacher_assignments (section_id) where is_current;

-- A teacher can only ever be a "class teacher" — never changes
-- users.role, but the assignment itself must point at an actual
-- teacher account.
create or replace function public.validate_class_teacher_assignment() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select role from public.users where id = new.teacher_id) <> 'teacher' then
    raise exception 'class teacher must be an account with role = teacher';
  end if;
  return new;
end;
$$;

create trigger class_teacher_assignments_validate
  before insert or update on public.class_teacher_assignments
  for each row execute function public.validate_class_teacher_assignment();

alter table public.class_teacher_assignments enable row level security;

-- SELECT: admin; the teacher about their own current/past assignments;
-- any teacher already assigned to that section (so a subject teacher
-- can see who the class teacher is); any student currently in that
-- section (so they can see their own class teacher).
create policy class_teacher_assignments_select on public.class_teacher_assignments
  for select using (
    public.is_admin()
    or teacher_id = auth.uid()
    or public.teacher_has_section(section_id)
    or exists (
      select 1 from public.student_assignments sa
      where sa.student_id = auth.uid() and sa.is_current and sa.section_id = class_teacher_assignments.section_id
    )
  );

-- WRITE: Super Admin only via direct table access. The intended way to
-- change a class teacher is the assign_class_teacher() RPC below,
-- which atomically ends the previous holder's row — but even a raw
-- admin table write stays scoped to admin-only here, same as every
-- other admin-managed table in this schema.
create policy class_teacher_assignments_write_admin_only on public.class_teacher_assignments
  for all using (public.is_admin()) with check (public.is_admin());

-- Atomic "assign/replace class teacher" — ends the section's current
-- holder (if any) and inserts the new one in one transaction, so the
-- unique-current-per-section index is never even momentarily violated
-- and history is never destroyed.
create or replace function public.assign_class_teacher(p_teacher_id uuid, p_section_id uuid)
returns public.class_teacher_assignments
language plpgsql security definer set search_path = public
as $$
declare
  v_result public.class_teacher_assignments;
begin
  if not public.is_admin() then
    raise exception 'Only Super Admin may assign a class teacher.';
  end if;

  if (select role from public.users where id = p_teacher_id) <> 'teacher' then
    raise exception 'Selected account is not a teacher.';
  end if;

  if not exists (select 1 from public.sections where id = p_section_id) then
    raise exception 'Section not found.';
  end if;

  update public.class_teacher_assignments
    set is_current = false, ended_at = now()
  where section_id = p_section_id and is_current;

  insert into public.class_teacher_assignments (teacher_id, section_id, assigned_by, is_current)
  values (p_teacher_id, p_section_id, auth.uid(), true)
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.assign_class_teacher(uuid, uuid) from public;
revoke execute on function public.assign_class_teacher(uuid, uuid) from anon;
grant execute on function public.assign_class_teacher(uuid, uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. CR1 / CR2 DESIGNATION
-- ═══════════════════════════════════════════════════════════════════════

create table public.cr_designations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users(id),
  section_id uuid not null references public.sections(id),
  designation text not null check (designation in ('CR1', 'CR2')),
  is_current boolean not null default true,
  assigned_by uuid references public.users(id),
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index cr_designations_student_idx on public.cr_designations (student_id);
create index cr_designations_section_idx on public.cr_designations (section_id);

-- Max one CR1 and one CR2 per section...
create unique index cr_designations_one_per_slot_per_section
  on public.cr_designations (section_id, designation) where is_current;
-- ...and a student can't hold two current designations at once (which
-- also prevents being CR1 and CR2 simultaneously).
create unique index cr_designations_one_current_per_student
  on public.cr_designations (student_id) where is_current;

create or replace function public.validate_cr_designation() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select role from public.users where id = new.student_id) <> 'student' then
    raise exception 'CR designation must be assigned to a student account.';
  end if;
  if not public.student_currently_in_section(new.student_id, new.section_id) then
    raise exception 'Student is not currently assigned to this section.';
  end if;
  return new;
end;
$$;

create trigger cr_designations_validate
  before insert or update on public.cr_designations
  for each row execute function public.validate_cr_designation();

alter table public.cr_designations enable row level security;

create policy cr_designations_select on public.cr_designations
  for select using (
    public.is_admin()
    or student_id = auth.uid()
    or public.is_class_teacher_of_section(section_id)
  );

-- No direct INSERT/UPDATE policy for teachers — class-teacher writes
-- happen only through assign_cr_designation() below (SECURITY DEFINER,
-- bypasses RLS internally after its own explicit checks). Direct table
-- access stays admin-only, same pattern as class_teacher_assignments.
create policy cr_designations_write_admin_only on public.cr_designations
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.assign_cr_designation(p_student_id uuid, p_section_id uuid, p_designation text)
returns public.cr_designations
language plpgsql security definer set search_path = public
as $$
declare
  v_result public.cr_designations;
begin
  if not (public.is_admin() or public.is_class_teacher_of_section(p_section_id)) then
    raise exception 'Only Super Admin or this section''s class teacher may assign CR designations.';
  end if;

  if p_designation not in ('CR1', 'CR2') then
    raise exception 'Designation must be CR1 or CR2.';
  end if;

  if (select role from public.users where id = p_student_id) <> 'student' then
    raise exception 'Selected account is not a student.';
  end if;

  if not public.student_currently_in_section(p_student_id, p_section_id) then
    raise exception 'Student is not currently assigned to this section.';
  end if;

  -- End whoever currently holds this slot in this section...
  update public.cr_designations
    set is_current = false, ended_at = now()
  where section_id = p_section_id and designation = p_designation and is_current;

  -- ...and end this student's own previous designation, if different
  -- (e.g. moving from CR2 to CR1).
  update public.cr_designations
    set is_current = false, ended_at = now()
  where student_id = p_student_id and is_current;

  insert into public.cr_designations (student_id, section_id, designation, assigned_by, is_current)
  values (p_student_id, p_section_id, p_designation, auth.uid(), true)
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.assign_cr_designation(uuid, uuid, text) from public;
revoke execute on function public.assign_cr_designation(uuid, uuid, text) from anon;
grant execute on function public.assign_cr_designation(uuid, uuid, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
-- 3. LAB BATCH ASSIGNMENT
-- ═══════════════════════════════════════════════════════════════════════

-- A real entity per section (e.g. "A1"/"A2" under section 3A), so
-- future sections aren't limited to the same 2-batch structure and
-- nothing is hardcoded in the frontend.
create table public.lab_batches (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections(id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (section_id, name)
);

create index lab_batches_section_idx on public.lab_batches (section_id);

alter table public.lab_batches enable row level security;

create policy lab_batches_select on public.lab_batches
  for select using (
    public.is_admin()
    or public.teacher_has_section(section_id)
    or public.is_class_teacher_of_section(section_id)
    or exists (
      select 1 from public.student_assignments sa
      where sa.student_id = auth.uid() and sa.is_current and sa.section_id = lab_batches.section_id
    )
  );

-- Structural entity (what batches exist) stays admin-managed — Super
-- Admin defines "3A has batches A1, A2"; class teachers only assign
-- students into whichever batches already exist (below).
create policy lab_batches_write_admin_only on public.lab_batches
  for all using (public.is_admin()) with check (public.is_admin());

create table public.student_lab_batch_assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users(id),
  lab_batch_id uuid not null references public.lab_batches(id),
  section_id uuid not null references public.sections(id),
  is_current boolean not null default true,
  assigned_by uuid references public.users(id),
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index student_lab_batch_assignments_student_idx on public.student_lab_batch_assignments (student_id);
create index student_lab_batch_assignments_batch_idx on public.student_lab_batch_assignments (lab_batch_id);

-- At most one CURRENT lab batch per student.
create unique index student_lab_batch_assignments_one_current_per_student
  on public.student_lab_batch_assignments (student_id) where is_current;

create or replace function public.validate_student_lab_batch_assignment() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_batch_section uuid;
begin
  select section_id into v_batch_section from public.lab_batches where id = new.lab_batch_id;
  if v_batch_section is null then
    raise exception 'Lab batch not found.';
  end if;
  if v_batch_section <> new.section_id then
    raise exception 'This lab batch does not belong to the given section.';
  end if;
  if (select role from public.users where id = new.student_id) <> 'student' then
    raise exception 'Lab batch must be assigned to a student account.';
  end if;
  if not public.student_currently_in_section(new.student_id, new.section_id) then
    raise exception 'Student is not currently assigned to this section.';
  end if;
  return new;
end;
$$;

create trigger student_lab_batch_assignments_validate
  before insert or update on public.student_lab_batch_assignments
  for each row execute function public.validate_student_lab_batch_assignment();

alter table public.student_lab_batch_assignments enable row level security;

create policy student_lab_batch_assignments_select on public.student_lab_batch_assignments
  for select using (
    public.is_admin()
    or student_id = auth.uid()
    or public.teacher_has_section(section_id)
    or public.is_class_teacher_of_section(section_id)
  );

create policy student_lab_batch_assignments_write_admin_only on public.student_lab_batch_assignments
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.assign_lab_batch(p_student_id uuid, p_lab_batch_id uuid)
returns public.student_lab_batch_assignments
language plpgsql security definer set search_path = public
as $$
declare
  v_section_id uuid;
  v_result public.student_lab_batch_assignments;
begin
  select section_id into v_section_id from public.lab_batches where id = p_lab_batch_id;
  if v_section_id is null then
    raise exception 'Lab batch not found.';
  end if;

  if not (public.is_admin() or public.is_class_teacher_of_section(v_section_id)) then
    raise exception 'Only Super Admin or this section''s class teacher may assign lab batches.';
  end if;

  if (select role from public.users where id = p_student_id) <> 'student' then
    raise exception 'Selected account is not a student.';
  end if;

  if not public.student_currently_in_section(p_student_id, v_section_id) then
    raise exception 'Student is not currently assigned to this section.';
  end if;

  update public.student_lab_batch_assignments
    set is_current = false, ended_at = now()
  where student_id = p_student_id and is_current;

  insert into public.student_lab_batch_assignments (student_id, lab_batch_id, section_id, assigned_by, is_current)
  values (p_student_id, p_lab_batch_id, v_section_id, auth.uid(), true)
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.assign_lab_batch(uuid, uuid) from public;
revoke execute on function public.assign_lab_batch(uuid, uuid) from anon;
grant execute on function public.assign_lab_batch(uuid, uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════
-- 4. TIMETABLE FOUNDATION
-- ═══════════════════════════════════════════════════════════════════════

-- day_of_week: 1 = Monday .. 7 = Sunday (Sunday supported by the
-- schema even though nothing is scheduled on it today).
create table public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id),
  semester_id uuid not null references public.semesters(id),
  section_id uuid not null references public.sections(id),
  day_of_week smallint not null check (day_of_week between 1 and 7),
  period_order smallint not null check (period_order > 0),
  start_time time not null,
  end_time time not null,
  subject_id uuid references public.subjects(id),
  teacher_id uuid references public.users(id),
  room text,
  lab_batch_id uuid references public.lab_batches(id),
  block_type text not null default 'lecture' check (block_type in ('lecture', 'lab', 'activity', 'break', 'other')),
  label text,
  notes text,
  is_current boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index timetable_entries_section_idx on public.timetable_entries (section_id);
create index timetable_entries_teacher_idx on public.timetable_entries (teacher_id);

-- One row per section/day/period/lab_batch slot (NULL lab_batch_id is
-- coalesced to a sentinel so ordinary lecture rows are still unique
-- per slot, while split lab rows — e.g. batch A1 doing AEC while A2
-- does DSD in the same period — can coexist as distinct rows).
create unique index timetable_entries_slot_unique on public.timetable_entries (
  section_id, day_of_week, period_order, coalesce(lab_batch_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where is_current;

-- Only validates when BOTH a subject and a teacher are given — special
-- blocks (activity/break) may have neither, and some may have a
-- supervising teacher with no formal subject.
create or replace function public.validate_timetable_entry() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.teacher_id is not null and new.subject_id is not null then
    if not exists (
      select 1 from public.teacher_assignments
      where teacher_id = new.teacher_id and section_id = new.section_id and subject_id = new.subject_id
    ) then
      raise exception 'This teacher is not assigned to this subject in this section.';
    end if;
  end if;
  return new;
end;
$$;

create trigger timetable_entries_validate
  before insert or update on public.timetable_entries
  for each row execute function public.validate_timetable_entry();

alter table public.timetable_entries enable row level security;

-- Timetables aren't sensitive — anyone affiliated with the section can
-- view it (admin, any teacher assigned there, class teacher, students
-- currently in that section).
create policy timetable_entries_select on public.timetable_entries
  for select using (
    public.is_admin()
    or public.teacher_has_section(section_id)
    or public.is_class_teacher_of_section(section_id)
    or exists (
      select 1 from public.student_assignments sa
      where sa.student_id = auth.uid() and sa.is_current and sa.section_id = timetable_entries.section_id
    )
  );

-- Phase 16A keeps timetable writes admin-only; no frontend is being
-- built yet, and the requirements don't ask for class-teacher write
-- access to the timetable itself (only to attendance/CR/lab-batch).
create policy timetable_entries_write_admin_only on public.timetable_entries
  for all using (public.is_admin()) with check (public.is_admin());


-- ═══════════════════════════════════════════════════════════════════════
-- 5. ATTENDANCE FOUNDATION
-- ═══════════════════════════════════════════════════════════════════════

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users(id),
  section_id uuid not null references public.sections(id),
  subject_id uuid not null references public.subjects(id),
  attendance_date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  recorded_by uuid not null references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, subject_id, attendance_date)
);

create index attendance_records_student_idx on public.attendance_records (student_id);
create index attendance_records_section_subject_idx on public.attendance_records (section_id, subject_id);

-- Every status change is preserved here instead of being overwritten
-- silently — the original value is never lost even though
-- attendance_records itself only holds the current status per
-- student/subject/date (per the unique constraint above).
create table public.attendance_audit_log (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.attendance_records(id),
  previous_status text not null,
  changed_by uuid references public.users(id),
  changed_at timestamptz not null default now()
);

-- Forces recorded_by/updated_by/updated_at server-side — a client
-- can't spoof who recorded/corrected an entry by sending a different
-- value; the trigger always uses auth.uid(), on top of the RLS
-- with_check below.
create or replace function public.stamp_attendance_record() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.recorded_by := auth.uid();
    new.updated_by := auth.uid();
    new.updated_at := now();
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.attendance_audit_log (attendance_id, previous_status, changed_by)
      values (old.id, old.status, auth.uid());
    end if;
    new.recorded_by := old.recorded_by; -- immutable after creation
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger attendance_records_stamp
  before insert or update on public.attendance_records
  for each row execute function public.stamp_attendance_record();

alter table public.attendance_records enable row level security;
alter table public.attendance_audit_log enable row level security;

create policy attendance_records_select on public.attendance_records
  for select using (
    public.is_admin()
    or student_id = auth.uid()
    or public.is_class_teacher_of_section(section_id)
    or (public.teacher_has_section(section_id) and public.teacher_has_subject(subject_id))
  );

create policy attendance_records_insert on public.attendance_records
  for insert with check (
    public.is_admin()
    or public.is_class_teacher_of_section(section_id)
    or (public.teacher_has_section(section_id) and public.teacher_has_subject(subject_id))
  );

-- Ordinary subject teachers may only correct SAME-DAY entries; the
-- class teacher and Super Admin aren't limited by date.
create policy attendance_records_update on public.attendance_records
  for update using (
    public.is_admin()
    or public.is_class_teacher_of_section(section_id)
    or (public.teacher_has_section(section_id) and public.teacher_has_subject(subject_id) and attendance_date = current_date)
  ) with check (
    public.is_admin()
    or public.is_class_teacher_of_section(section_id)
    or (public.teacher_has_section(section_id) and public.teacher_has_subject(subject_id) and attendance_date = current_date)
  );

-- No DELETE policy anywhere — attendance is never destroyed, only
-- corrected (with an audit trail) or superseded going forward.

create policy attendance_audit_log_select on public.attendance_audit_log
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.attendance_records ar
      where ar.id = attendance_audit_log.attendance_id
        and (
          public.is_class_teacher_of_section(ar.section_id)
          or (public.teacher_has_section(ar.section_id) and public.teacher_has_subject(ar.subject_id))
        )
    )
  );
-- No write policy at all for attendance_audit_log: rows are only ever
-- produced by the trigger above (SECURITY DEFINER, bypasses RLS), so
-- no role — including admin — can insert/edit/delete an audit row
-- directly through the API.


-- ═══════════════════════════════════════════════════════════════════════
-- 6. IA MARKS FOUNDATION
-- ═══════════════════════════════════════════════════════════════════════

create table public.ia_assessments (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id),
  ia_number smallint not null check (ia_number in (1, 2, 3)),
  max_marks numeric not null check (max_marks > 0),
  created_at timestamptz not null default now(),
  unique (subject_id, ia_number)
);

create index ia_assessments_subject_idx on public.ia_assessments (subject_id);

alter table public.ia_assessments enable row level security;

create policy ia_assessments_select on public.ia_assessments
  for select using (
    public.is_admin()
    or public.teacher_has_subject(subject_id)
    or public.student_enrolled_in_subject(subject_id)
  );

-- Defining the IA slots/max-marks is academic-structure setup, kept
-- admin-only in this foundation phase — teachers enter marks_obtained
-- (below), not the assessment definitions themselves.
create policy ia_assessments_write_admin_only on public.ia_assessments
  for all using (public.is_admin()) with check (public.is_admin());

create table public.ia_marks (
  id uuid primary key default gen_random_uuid(),
  ia_assessment_id uuid not null references public.ia_assessments(id),
  student_id uuid not null references public.users(id),
  marks_obtained numeric not null check (marks_obtained >= 0),
  entered_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ia_assessment_id, student_id)
);

create index ia_marks_student_idx on public.ia_marks (student_id);

create or replace function public.stamp_and_validate_ia_marks() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_max numeric;
begin
  select max_marks into v_max from public.ia_assessments where id = new.ia_assessment_id;
  if v_max is null then
    raise exception 'IA assessment not found.';
  end if;
  if new.marks_obtained > v_max then
    raise exception 'Marks obtained (%) exceed this assessment''s maximum (%).', new.marks_obtained, v_max;
  end if;

  if tg_op = 'INSERT' then
    new.entered_by := auth.uid();
    new.updated_by := auth.uid();
    new.updated_at := now();
  elsif tg_op = 'UPDATE' then
    new.entered_by := old.entered_by; -- immutable after creation
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger ia_marks_stamp_and_validate
  before insert or update on public.ia_marks
  for each row execute function public.stamp_and_validate_ia_marks();

alter table public.ia_marks enable row level security;

create policy ia_marks_select on public.ia_marks
  for select using (
    public.is_admin()
    or student_id = auth.uid()
    or exists (
      select 1 from public.ia_assessments ia
      where ia.id = ia_marks.ia_assessment_id and public.teacher_has_subject(ia.subject_id)
    )
    or exists (
      -- Class teacher: any student currently in their section.
      select 1 from public.student_assignments sa
      join public.class_teacher_assignments cta
        on cta.section_id = sa.section_id and cta.is_current and cta.teacher_id = auth.uid()
      where sa.student_id = ia_marks.student_id and sa.is_current
    )
  );

-- Only the subject teacher (assigned to this mark's subject) or admin
-- may write marks. Class teachers get read access only, per spec —
-- entering/correcting marks stays with the subject teacher.
create policy ia_marks_write on public.ia_marks
  for all using (
    public.is_admin()
    or exists (
      select 1 from public.ia_assessments ia
      where ia.id = ia_marks.ia_assessment_id
        and public.teacher_has_subject(ia.subject_id)
        and public.student_currently_in_subject(ia_marks.student_id, ia.subject_id)
    )
  ) with check (
    public.is_admin()
    or exists (
      select 1 from public.ia_assessments ia
      where ia.id = ia_marks.ia_assessment_id
        and public.teacher_has_subject(ia.subject_id)
        and public.student_currently_in_subject(ia_marks.student_id, ia.subject_id)
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 21 — Phase 16A Database Foundation.
-- No RLS bypass, no fourth role, no Branch/payments/KCET/NEET, no
-- BioVerse reference, no service-role usage, no old migration touched.
-- ═══════════════════════════════════════════════════════════════════════
