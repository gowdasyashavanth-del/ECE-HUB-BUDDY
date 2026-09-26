-- Self-correction: the cr_designations_write_class_teacher policy added
-- in the previous migration (class_teacher_cr_write_scope_fix) was
-- broader than necessary. assign_cr_designation() already lets a Class
-- Teacher assign/replace a CR (it checks is_admin() OR
-- is_class_teacher_of_section() itself, SECURITY DEFINER) — that RPC
-- also maintains an invariant (at most one current CR1 and one current
-- CR2 per section) that a raw table INSERT/UPDATE/DELETE grant could
-- silently violate. The only genuinely missing capability was "end a
-- CR designation without immediately replacing them," which the admin
-- page previously did via a direct table UPDATE (fine there, since
-- admin already has full direct access) but a Class Teacher had no safe
-- equivalent for. This replaces the blanket table-level policy with a
-- narrow RPC that does exactly that one thing, mirroring the existing
-- assign_cr_designation() gateway pattern instead of opening the table.

drop policy if exists cr_designations_write_class_teacher on public.cr_designations;

create or replace function public.end_cr_designation(p_id uuid)
returns public.cr_designations
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_section_id uuid;
  v_result public.cr_designations;
begin
  select section_id into v_section_id from public.cr_designations where id = p_id;

  if v_section_id is null then
    raise exception 'CR designation not found.';
  end if;

  if not (public.is_admin() or public.is_class_teacher_of_section(v_section_id)) then
    raise exception 'Only Super Admin or this section''s class teacher may end a CR designation.';
  end if;

  update public.cr_designations
    set is_current = false, ended_at = now()
  where id = p_id and is_current
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.end_cr_designation(uuid) from public;
revoke all on function public.end_cr_designation(uuid) from anon;
grant execute on function public.end_cr_designation(uuid) to authenticated;
