-- Timetable conflict detection.
-- ROOT CAUSE: timetable_entries_slot_unique was unique on
-- (section_id, day_of_week, period_order, lab_batch). period_order is an
-- arbitrary counter (the admin form set it to "number of grid rows + 1"),
-- unrelated to the actual times, so a valid new Monday 09:55-10:50 entry could
-- collide with an existing Monday row holding the same counter value and fail
-- with unique_violation (23505), shown as "already exists in this context".
-- FIX: drop that index; enforce real time-overlap rules in the validation trigger.
drop index if exists public.timetable_entries_slot_unique;

create or replace function public.validate_timetable_entry() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_section_semester uuid;
  v_subject_semester uuid;
  v_batch_section uuid;
begin
  if new.teacher_id is not null and new.subject_id is not null then
    if not exists (
      select 1 from public.teacher_assignments
      where teacher_id = new.teacher_id and section_id = new.section_id and subject_id = new.subject_id
    ) then
      raise exception 'This teacher is not assigned to this subject in this section.';
    end if;
  end if;

  if new.subject_id is not null then
    select semester_id into v_section_semester from public.sections where id = new.section_id;
    select semester_id into v_subject_semester from public.subjects where id = new.subject_id;
    if v_section_semester is null or v_subject_semester is null then
      raise exception 'Section or subject not found.';
    end if;
    if v_section_semester <> v_subject_semester then
      raise exception 'This subject does not belong to the same semester as the selected section.';
    end if;
  end if;

  if new.lab_batch_id is not null then
    select section_id into v_batch_section from public.lab_batches where id = new.lab_batch_id;
    if v_batch_section is null then
      raise exception 'Lab batch not found.';
    end if;
    if v_batch_section <> new.section_id then
      raise exception 'This lab batch does not belong to the selected section.';
    end if;
  end if;

  -- Conflict checks apply only to live rows (ending an entry must always work).
  if new.is_current then
    -- serialize concurrent writers for the same year/day
    perform pg_advisory_xact_lock(hashtext('timetable:' || new.academic_year_id::text || ':' || new.day_of_week::text));

    -- exact duplicate (same section/day/time/details)
    if exists (
      select 1 from public.timetable_entries e
      where e.is_current and e.id is distinct from new.id
        and e.section_id = new.section_id and e.day_of_week = new.day_of_week
        and e.start_time = new.start_time and e.end_time = new.end_time
        and e.subject_id is not distinct from new.subject_id
        and e.teacher_id is not distinct from new.teacher_id
        and lower(btrim(coalesce(e.room, ''))) = lower(btrim(coalesce(new.room, '')))
        and e.lab_batch_id is not distinct from new.lab_batch_id
        and e.block_type = new.block_type
    ) then
      raise exception 'A timetable entry with these exact details already exists.';
    end if;

    -- section conflict (a whole-class entry overlaps any batch entry; two batches may run in parallel)
    if exists (
      select 1 from public.timetable_entries e
      where e.is_current and e.id is distinct from new.id
        and e.section_id = new.section_id and e.day_of_week = new.day_of_week
        and e.start_time < new.end_time and e.end_time > new.start_time
        and (e.lab_batch_id is null or new.lab_batch_id is null or e.lab_batch_id = new.lab_batch_id)
    ) then
      raise exception 'This section already has a class during this time.';
    end if;

    -- teacher conflict (same academic year, any section)
    if new.teacher_id is not null and exists (
      select 1 from public.timetable_entries e
      where e.is_current and e.id is distinct from new.id
        and e.academic_year_id = new.academic_year_id and e.day_of_week = new.day_of_week
        and e.teacher_id = new.teacher_id
        and e.start_time < new.end_time and e.end_time > new.start_time
    ) then
      raise exception 'This teacher is already assigned during this time.';
    end if;

    -- room conflict (same academic year, any section)
    if btrim(coalesce(new.room, '')) <> '' and exists (
      select 1 from public.timetable_entries e
      where e.is_current and e.id is distinct from new.id
        and e.academic_year_id = new.academic_year_id and e.day_of_week = new.day_of_week
        and lower(btrim(coalesce(e.room, ''))) = lower(btrim(new.room))
        and e.start_time < new.end_time and e.end_time > new.start_time
    ) then
      raise exception 'This room is already occupied during this time.';
    end if;
  end if;

  return new;
end;
$$;
