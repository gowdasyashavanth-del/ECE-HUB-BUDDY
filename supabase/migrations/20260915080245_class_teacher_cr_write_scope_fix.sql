create or replace function public.is_current_cr_of_section(p_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.cr_designations
    where student_id = auth.uid() and section_id = p_section_id and is_current
  );
$$;
revoke all on function public.is_current_cr_of_section(uuid) from public;
revoke all on function public.is_current_cr_of_section(uuid) from anon;
grant execute on function public.is_current_cr_of_section(uuid) to authenticated;

create policy cr_designations_write_class_teacher on public.cr_designations
  for all using (public.is_class_teacher_of_section(section_id))
  with check (public.is_class_teacher_of_section(section_id));

drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements
  for insert
  with check (
    is_admin()
    or (
      scope_type = 'section'
      and exists (select 1 from public.teacher_assignments ta where ta.teacher_id = auth.uid() and ta.section_id = announcements.scope_id)
    )
    or (
      scope_type = 'section'
      and public.is_class_teacher_of_section(scope_id)
      and created_by = auth.uid()
    )
    or (
      scope_type = 'section'
      and public.is_current_cr_of_section(scope_id)
      and created_by = auth.uid()
    )
  );

create policy announcements_delete_cr_own on public.announcements
  for delete
  using (
    scope_type = 'section'
    and created_by = auth.uid()
    and public.is_current_cr_of_section(scope_id)
  );
