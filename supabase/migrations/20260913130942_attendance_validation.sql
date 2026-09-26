-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 25: Attendance record validation
--
-- Discovered while implementing Phase 16E: attendance_records had only
-- the attribution-stamping trigger from Phase 16A
-- (stamp_attendance_record) — nothing validated that:
--   1. student_id is actually a CURRENT member of section_id, or
--   2. subject_id's semester matches section_id's semester.
--
-- The write RLS policies correctly restrict WHO can write (the
-- caller must be an authorized teacher/class-teacher/admin for that
-- section+subject), but nothing checked that the row's own
-- student_id/subject_id/section_id combination was actually
-- coherent — an authorized teacher's client could still (by mistake
-- or a compromised request) write an attendance row for a student who
-- isn't even in that section, or a subject from a different semester.
--
-- This closes both gaps with one BEFORE INSERT/UPDATE trigger, reusing
-- student_currently_in_section() from Phase 16A/16C rather than
-- duplicating that check. No new table, no RLS change, migrations
-- 00–24 untouched.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.validate_attendance_record() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_section_semester uuid;
  v_subject_semester uuid;
begin
  if not public.student_currently_in_section(new.student_id, new.section_id) then
    raise exception 'This student is not currently assigned to this section.';
  end if;

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

create trigger attendance_records_validate
  before insert or update on public.attendance_records
  for each row execute function public.validate_attendance_record();

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 25.
-- ═══════════════════════════════════════════════════════════════════════
