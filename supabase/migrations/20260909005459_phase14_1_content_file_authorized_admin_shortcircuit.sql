-- Fix: super_admin must have full access to all content files
-- regardless of path format (per Decision 2 requirements), so check
-- is_admin() before attempting to parse the folder-embedded subject_id.

create or replace function public.content_file_authorized(p_object_name text)
returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_subject_id uuid;
begin
  if public.is_admin() then
    return true;
  end if;

  begin
    v_subject_id := ((storage.foldername(p_object_name))[1])::uuid;
  exception when others then
    return false;
  end;

  if v_subject_id is null then
    return false;
  end if;

  return public.teacher_has_subject(v_subject_id)
    or public.student_enrolled_in_subject(v_subject_id);
end;
$$;
