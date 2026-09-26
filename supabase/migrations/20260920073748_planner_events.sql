-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration: Academic Planner (planner_events)
-- Idempotent: safe to run multiple times.
--
-- ONE table. Targeting reuses the EXISTING academic hierarchy
-- (Academic Year → Regulation → Program → Semester → Section → Subject);
-- no parallel structure, no Branch.
--
-- Targeting model: `target_scope` declares how broadly the event is
-- aimed. The BEFORE trigger validates it and DERIVES every ancestor
-- column from the most specific target, so the stored columns can never
-- disagree with the hierarchy and clients can never forge them. A
-- student sees an event iff every non-null target column equals their
-- current assignment (student_assignments) — one uniform rule.
--
-- Time model (only what each type needs):
--   deadline types (assignment, project_submission, lab_record_submission)
--       → due_at required, start_at = optional "assigned on"
--   all other types → start_at required, end_at optional, due_at forbidden
--   anchor_at (generated) = coalesce(due_at, start_at) — the one column
--   used for ordering and date-window queries.
-- Status (upcoming / today / due soon / overdue / completed) and
-- countdowns are DERIVED in the client from these timestamps — not stored.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.planner_events (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(btrim(title)) between 1 and 200),
  description      text check (description is null or char_length(description) <= 4000),
  event_type       text not null check (event_type in (
                     'test','ia','exam','quiz','practical_exam',
                     'assignment','project_submission','lab_record_submission',
                     'seminar','presentation','viva',
                     'workshop','technical_event','holiday','academic_event')),
  priority         text not null default 'normal' check (priority in ('normal','important','critical')),
  target_scope     text not null check (target_scope in (
                     'all','academic_year','regulation','program','semester','section','subject')),
  academic_year_id uuid references public.academic_years(id) on delete cascade,
  regulation_id    uuid references public.regulations(id)    on delete cascade,
  program_id       uuid references public.programs(id)       on delete cascade,
  semester_id      uuid references public.semesters(id)      on delete cascade,
  section_id       uuid references public.sections(id)       on delete cascade,
  subject_id       uuid references public.subjects(id)       on delete cascade,
  unit_id          uuid references public.units(id)          on delete set null,
  topic_id         uuid references public.topics(id)         on delete set null,
  test_id          uuid references public.tests(id)          on delete set null,
  start_at         timestamptz,
  end_at           timestamptz,
  due_at           timestamptz,
  all_day          boolean not null default false,
  anchor_at        timestamptz generated always as (coalesce(due_at, start_at)) stored,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint planner_events_time_present check (start_at is not null or due_at is not null),
  constraint planner_events_end_after_start check (end_at is null or (start_at is not null and end_at >= start_at))
);

create index if not exists idx_planner_events_anchor         on public.planner_events (anchor_at);
create index if not exists idx_planner_events_section_anchor on public.planner_events (section_id, anchor_at) where section_id is not null;
create index if not exists idx_planner_events_semester       on public.planner_events (semester_id, anchor_at) where semester_id is not null;
create index if not exists idx_planner_events_subject        on public.planner_events (subject_id) where subject_id is not null;
create index if not exists idx_planner_events_program        on public.planner_events (program_id) where program_id is not null;
create index if not exists idx_planner_events_regulation     on public.planner_events (regulation_id) where regulation_id is not null;
create index if not exists idx_planner_events_year           on public.planner_events (academic_year_id) where academic_year_id is not null;
create index if not exists idx_planner_events_type           on public.planner_events (event_type);
create index if not exists idx_planner_events_created_by     on public.planner_events (created_by);

-- ─── Authorization helpers ────────────────────────────────────────────

-- Who may create/update/delete an event with this target:
--   Super Admin — any target.
--   Subject teacher — ONLY scope 'subject' with BOTH section and subject
--   set, and only for the exact (subject, section) pair they are assigned
--   to (teacher_has_subject_in_section — never the broader
--   teacher_has_section). CRs / class teachers get nothing extra.
create or replace function public.planner_can_manage(p_scope text, p_section_id uuid, p_subject_id uuid)
returns boolean language sql security definer stable set search_path = public
as $$
  select public.is_admin()
      or (
        p_scope = 'subject'
        and p_section_id is not null
        and p_subject_id is not null
        and public.teacher_has_subject_in_section(p_subject_id, p_section_id)
      );
$$;

-- Student visibility: every non-null target column must equal the
-- student's CURRENT assignment. All-null (scope 'all') is visible to
-- every student who has a current assignment.
create or replace function public.planner_student_can_see(
  p_year uuid, p_regulation uuid, p_program uuid, p_semester uuid, p_section uuid)
returns boolean language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.student_assignments sa
    where sa.student_id = auth.uid()
      and sa.is_current
      and (p_year       is null or sa.academic_year_id = p_year)
      and (p_regulation is null or sa.regulation_id    = p_regulation)
      and (p_program    is null or sa.program_id       = p_program)
      and (p_semester   is null or sa.semester_id      = p_semester)
      and (p_section    is null or sa.section_id       = p_section)
  );
$$;

-- Teacher read visibility (management is separate, above): events for
-- the hierarchy levels a teacher actually teaches in. Subject-specific
-- events are visible only to a teacher assigned to that subject (and to
-- that section, when the event names one). Institution-wide events
-- (scope 'all') are visible to every teacher.
create or replace function public.planner_teacher_can_see(
  p_year uuid, p_regulation uuid, p_program uuid, p_semester uuid, p_section uuid, p_subject uuid)
returns boolean language sql security definer stable set search_path = public
as $$
  select public.current_role() = 'teacher'
    and (
      (p_year is null and p_regulation is null and p_program is null
         and p_semester is null and p_section is null and p_subject is null)
      or exists (
        select 1
        from public.teacher_assignments ta
        join public.sections   s  on s.id  = ta.section_id
        join public.semesters  sm on sm.id = s.semester_id
        join public.programs   p  on p.id  = sm.program_id
        join public.regulations r on r.id  = p.regulation_id
        where ta.teacher_id = auth.uid()
          and (p_subject    is null or ta.subject_id = p_subject)
          and (p_section    is null or ta.section_id = p_section)
          and (p_semester   is null or s.semester_id = p_semester)
          and (p_program    is null or sm.program_id = p_program)
          and (p_regulation is null or p.regulation_id = p_regulation)
          and (p_year       is null or s.academic_year_id = p_year)
      )
    );
$$;

revoke all on function public.planner_can_manage(text, uuid, uuid) from public;
revoke all on function public.planner_student_can_see(uuid, uuid, uuid, uuid, uuid) from public;
revoke all on function public.planner_teacher_can_see(uuid, uuid, uuid, uuid, uuid, uuid) from public;
revoke execute on function public.planner_can_manage(text, uuid, uuid) from anon;
revoke execute on function public.planner_student_can_see(uuid, uuid, uuid, uuid, uuid) from anon;
revoke execute on function public.planner_teacher_can_see(uuid, uuid, uuid, uuid, uuid, uuid) from anon;
grant execute on function public.planner_can_manage(text, uuid, uuid) to authenticated;
grant execute on function public.planner_student_can_see(uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.planner_teacher_can_see(uuid, uuid, uuid, uuid, uuid, uuid) to authenticated;

-- ─── Validation / normalisation trigger ───────────────────────────────

create or replace function public.validate_planner_event() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_section_year uuid;
  v_section_sem  uuid;
  v_topic_unit   uuid;
  v_unit_subject uuid;
  v_test_subject uuid;
begin
  -- 1. Targeting: descendants of the declared scope must be empty;
  --    ancestors are DERIVED (client-supplied ancestors are ignored).
  case new.target_scope
    when 'all' then
      if new.academic_year_id is not null or new.regulation_id is not null or new.program_id is not null
         or new.semester_id is not null or new.section_id is not null or new.subject_id is not null then
        raise exception 'An all-students event cannot have a specific target.';
      end if;
    when 'academic_year' then
      if new.academic_year_id is null then raise exception 'Academic year is required.'; end if;
      if new.regulation_id is not null or new.program_id is not null or new.semester_id is not null
         or new.section_id is not null or new.subject_id is not null then
        raise exception 'Target does not match the selected scope.';
      end if;
    when 'regulation' then
      if new.regulation_id is null then raise exception 'Regulation is required.'; end if;
      if new.program_id is not null or new.semester_id is not null
         or new.section_id is not null or new.subject_id is not null then
        raise exception 'Target does not match the selected scope.';
      end if;
      select academic_year_id into new.academic_year_id from public.regulations where id = new.regulation_id;
      if not found then raise exception 'Regulation not found.'; end if;
    when 'program' then
      if new.program_id is null then raise exception 'Program is required.'; end if;
      if new.semester_id is not null or new.section_id is not null or new.subject_id is not null then
        raise exception 'Target does not match the selected scope.';
      end if;
      select regulation_id into new.regulation_id from public.programs where id = new.program_id;
      if not found then raise exception 'Program not found.'; end if;
      select academic_year_id into new.academic_year_id from public.regulations where id = new.regulation_id;
    when 'semester' then
      if new.semester_id is null then raise exception 'Semester is required.'; end if;
      if new.section_id is not null or new.subject_id is not null then
        raise exception 'Target does not match the selected scope.';
      end if;
      select program_id into new.program_id from public.semesters where id = new.semester_id;
      if not found then raise exception 'Semester not found.'; end if;
      select regulation_id into new.regulation_id from public.programs where id = new.program_id;
      select academic_year_id into new.academic_year_id from public.regulations where id = new.regulation_id;
    when 'section' then
      if new.section_id is null then raise exception 'Section is required.'; end if;
      if new.subject_id is not null then raise exception 'Target does not match the selected scope.'; end if;
      select semester_id, academic_year_id into v_section_sem, v_section_year from public.sections where id = new.section_id;
      if not found then raise exception 'Section not found.'; end if;
      new.semester_id := v_section_sem;
      new.academic_year_id := v_section_year;
      select program_id into new.program_id from public.semesters where id = new.semester_id;
      select regulation_id into new.regulation_id from public.programs where id = new.program_id;
    when 'subject' then
      if new.subject_id is null then raise exception 'Subject is required.'; end if;
      select semester_id into new.semester_id from public.subjects where id = new.subject_id;
      if not found then raise exception 'Subject not found.'; end if;
      select program_id into new.program_id from public.semesters where id = new.semester_id;
      select regulation_id into new.regulation_id from public.programs where id = new.program_id;
      select academic_year_id into new.academic_year_id from public.regulations where id = new.regulation_id;
      if new.section_id is not null then
        select semester_id, academic_year_id into v_section_sem, v_section_year from public.sections where id = new.section_id;
        if not found then raise exception 'Section not found.'; end if;
        if v_section_sem <> new.semester_id then
          raise exception 'Selected section and subject are not in the same semester.';
        end if;
        new.academic_year_id := v_section_year;
      end if;
    else
      raise exception 'Unknown target scope.';
  end case;

  -- 2. Unit / topic / linked test must belong to the event's subject.
  if new.topic_id is not null then
    select unit_id into v_topic_unit from public.topics where id = new.topic_id;
    if not found then raise exception 'Topic not found.'; end if;
    if new.unit_id is not null and new.unit_id <> v_topic_unit then
      raise exception 'Topic does not belong to the selected unit.';
    end if;
    new.unit_id := v_topic_unit;
  end if;
  if new.unit_id is not null then
    if new.subject_id is null then raise exception 'A unit or topic requires a subject.'; end if;
    select subject_id into v_unit_subject from public.units where id = new.unit_id;
    if v_unit_subject is null or v_unit_subject <> new.subject_id then
      raise exception 'Unit does not belong to the selected subject.';
    end if;
  end if;
  if new.test_id is not null then
    if new.subject_id is null then raise exception 'A linked test requires a subject.'; end if;
    select subject_id into v_test_subject from public.tests where id = new.test_id;
    if v_test_subject is null or v_test_subject <> new.subject_id then
      raise exception 'Linked test does not belong to the selected subject.';
    end if;
  end if;

  -- 3. Time fields: only what the event type needs.
  if new.event_type in ('assignment','project_submission','lab_record_submission') then
    if new.due_at is null then raise exception 'A due date is required for this event type.'; end if;
    if new.end_at is not null then raise exception 'This event type has a due date, not an end time.'; end if;
    if new.start_at is not null and new.due_at < new.start_at then
      raise exception 'Due date cannot be before the assigned date.';
    end if;
  else
    if new.start_at is null then raise exception 'A start date/time is required for this event type.'; end if;
    if new.due_at is not null then raise exception 'A due date is only used for deadline-type events.'; end if;
  end if;

  -- 4. Authorship is server-derived and immutable.
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();

  return new;
end;
$$;

-- Trigger functions need no client EXECUTE grant.
revoke all on function public.validate_planner_event() from public;
revoke execute on function public.validate_planner_event() from anon, authenticated;

drop trigger if exists planner_events_validate on public.planner_events;
create trigger planner_events_validate
  before insert or update on public.planner_events
  for each row execute function public.validate_planner_event();

-- ─── RLS ──────────────────────────────────────────────────────────────

alter table public.planner_events enable row level security;
revoke all on public.planner_events from anon;
grant select, insert, update, delete on public.planner_events to authenticated;

drop policy if exists planner_events_select on public.planner_events;
create policy planner_events_select on public.planner_events
  for select to authenticated
  using (
    public.is_admin()
    or public.planner_student_can_see(academic_year_id, regulation_id, program_id, semester_id, section_id)
    or public.planner_teacher_can_see(academic_year_id, regulation_id, program_id, semester_id, section_id, subject_id)
  );

drop policy if exists planner_events_insert on public.planner_events;
create policy planner_events_insert on public.planner_events
  for insert to authenticated
  with check (
    public.planner_can_manage(target_scope, section_id, subject_id)
    and created_by = auth.uid()
  );

drop policy if exists planner_events_update on public.planner_events;
create policy planner_events_update on public.planner_events
  for update to authenticated
  using      ( public.planner_can_manage(target_scope, section_id, subject_id) )
  with check ( public.planner_can_manage(target_scope, section_id, subject_id) );

drop policy if exists planner_events_delete on public.planner_events;
create policy planner_events_delete on public.planner_events
  for delete to authenticated
  using ( public.planner_can_manage(target_scope, section_id, subject_id) );
