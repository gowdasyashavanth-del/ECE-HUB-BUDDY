-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 24: Timetable subject/lab-batch validation
--
-- Discovered while implementing Phase 16D: validate_timetable_entry()
-- (migration 21) only checked teacher/subject/section consistency when
-- BOTH teacher_id and subject_id were supplied, and never checked that
-- lab_batch_id actually belongs to the entry's own section_id at all.
-- That left two real gaps:
--   1. A subject_id from a different semester than the section could
--      be attached to an entry with no teacher_id set.
--   2. Nothing stopped e.g. a 3A timetable entry from pointing at a
--      3B lab batch.
--
-- This migration only REPLACES the existing trigger function (CREATE
-- OR REPLACE) to close both gaps — it does not touch migrations
-- 00–23, adds no new table, and keeps the original teacher/subject/
-- section check exactly as it was.
-- ═══════════════════════════════════════════════════════════════════════

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

  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 24.
-- ═══════════════════════════════════════════════════════════════════════
