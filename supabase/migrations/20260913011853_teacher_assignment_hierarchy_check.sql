-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 23: Teacher assignment hierarchy validation
--
-- Discovered while implementing Phase 16C (test "Y: cross-section
-- teacher assignment is rejected unless valid"): teacher_assignments
-- had no trigger or constraint checking that its section_id and
-- subject_id actually belong to the same semester. Section/subject FKs
-- alone don't prevent combining, say, a Semester 3 section with a
-- Semester 5 subject — both ids are individually valid, just
-- inconsistent with each other. That combination would then let
-- teacher_has_subject() grant a teacher access to a subject with no
-- real relationship to the section they're supposedly teaching it in.
--
-- This mirrors the same validation style as validate_timetable_entry
-- (migration 21) — a small BEFORE INSERT/UPDATE trigger, no new table,
-- no changes to teacher_has_subject()/teacher_has_section()/RLS.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.validate_teacher_assignment_hierarchy() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_section_semester uuid;
  v_subject_semester uuid;
begin
  select semester_id into v_section_semester from public.sections where id = new.section_id;
  select semester_id into v_subject_semester from public.subjects where id = new.subject_id;

  if v_section_semester is null or v_subject_semester is null then
    raise exception 'Section or subject not found.';
  end if;

  if v_section_semester <> v_subject_semester then
    raise exception 'This subject does not belong to the same semester as the selected section.';
  end if;

  return new;
end;
$$;

create trigger teacher_assignments_validate_hierarchy
  before insert or update on public.teacher_assignments
  for each row execute function public.validate_teacher_assignment_hierarchy();

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 23.
-- ═══════════════════════════════════════════════════════════════════════
