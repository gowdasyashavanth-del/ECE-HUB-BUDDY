-- Phase 16G follow-up: students previously had NO read access to
-- teacher_assignments at all, so the Student Dashboard / Subject Detail
-- page could never display "Assigned Teacher". This replaces the
-- SELECT policy with a combined one that additionally allows a student
-- to read teacher_assignments rows for their OWN CURRENT section only,
-- via the existing student_currently_in_section() helper (which only
-- matches student_assignments rows with is_current = true). Historical
-- sections and unrelated sections are never matched. INSERT/UPDATE/DELETE
-- remain admin-only via the untouched teacher_assignments_write_admin_only
-- policy.

drop policy if exists teacher_assignments_select on public.teacher_assignments;

create policy teacher_assignments_select on public.teacher_assignments
  for select using (
    is_admin()
    or teacher_id = auth.uid()
    or public.student_currently_in_section(auth.uid(), section_id)
  );
