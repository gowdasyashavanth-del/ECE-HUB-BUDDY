-- Phase 14.1, Decision 2: scope content-files SELECT to enrollment/assignment.
--
-- Path convention verified live in src/components/content/ContentManager.tsx:
--   `${subjectId}/${topicId}/${uuid}-${filename}`
-- so storage.foldername(name)[1] is always the subject_id the file
-- belongs to. This lets us reuse the exact same helper functions the
-- `content` table's own RLS already uses (teacher_has_subject,
-- student_enrolled_in_subject, is_admin) with no join back through the
-- content table and no recursive RLS.

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
  begin
    v_subject_id := ((storage.foldername(p_object_name))[1])::uuid;
  exception when others then
    return false;
  end;

  if v_subject_id is null then
    return false;
  end if;

  return public.is_admin()
    or public.teacher_has_subject(v_subject_id)
    or public.student_enrolled_in_subject(v_subject_id);
end;
$$;

drop policy if exists content_files_authenticated_read on storage.objects;

create policy content_files_scoped_read
on storage.objects
for select
using (
  bucket_id = 'content-files'
  and public.content_file_authorized(name)
);
