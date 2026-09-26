-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration: Notes Module
-- DESIGN ONLY — review before running against a real Supabase project.
-- Idempotent: safe to run multiple times.
--
-- Notes are a SEPARATE learning-content feature from the generic
-- `content` table (which stays untouched — no risk to the existing
-- Content/Formulas/Questions/Tests/Results/Announcements screens).
--
-- Organized as Section → Subject → Chapter, reusing the EXISTING
-- Unit/Topic hierarchy for "chapter" (topics.name is already the
-- chapter-level concept — no new academic hierarchy level is added).
-- Section is stored explicitly on each note because the existing
-- `content`/topic hierarchy has no section concept at all, and Notes
-- specifically need it (CRs and class teachers act per-section; a
-- student must only ever see notes for their OWN section).
--
-- Storage reuses the existing private `content-files` bucket (PDF is
-- already an allowed mime type there) with a distinct `notes/` path
-- prefix so its authorization can differ from the generic content
-- storage rules without touching them:
--   notes/{section_id}/{subject_id}/{topic_id}/{uuid}-{filename}.pdf
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Table ────────────────────────────────────────────────────────────

create table if not exists public.notes (
  id                uuid primary key default gen_random_uuid(),
  section_id        uuid not null references public.sections(id) on delete restrict,
  subject_id        uuid not null references public.subjects(id) on delete cascade,
  topic_id          uuid not null references public.topics(id) on delete cascade,
  title             text not null,
  file_path         text not null,
  file_size_bytes   bigint,
  uploaded_by       uuid references public.users(id) on delete set null,
  -- Denormalized at write time (never updated afterwards). Cross-role
  -- `users` RLS means a student or teacher can't always read the
  -- uploader's own users row later (e.g. a student can't read a
  -- teacher's row directly) — capturing the name/role snapshot here
  -- lets the UI show "uploaded by" to everyone who can see the note
  -- without depending on a join that may legitimately come back empty.
  uploaded_by_name  text,
  uploaded_by_role  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_notes_section on public.notes(section_id);
create index if not exists idx_notes_subject on public.notes(subject_id);
create index if not exists idx_notes_topic   on public.notes(topic_id);

-- ─── Helper functions ───────────────────────────────────────────────
-- Combined (subject AND section) check — deliberately stricter than
-- chaining teacher_has_subject() and teacher_has_section() separately,
-- which would wrongly authorize a teacher for a subject/section
-- COMBINATION they were never actually assigned (e.g. assigned to
-- Section A / Subject 1 and Section B / Subject 2 — the separate
-- checks would incorrectly also pass for Section B / Subject 1).

create or replace function public.teacher_has_subject_in_section(p_subject_id uuid, p_section_id uuid) returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.teacher_assignments
    where teacher_id = auth.uid() and subject_id = p_subject_id and section_id = p_section_id
  );
$$;
revoke all on function public.teacher_has_subject_in_section(uuid, uuid) from public;
revoke execute on function public.teacher_has_subject_in_section(uuid, uuid) from anon;
grant execute on function public.teacher_has_subject_in_section(uuid, uuid) to authenticated;

-- Who may upload/replace/delete Notes for this (section, subject):
--   Super Admin · the subject teacher actually assigned to that exact
--   section+subject · the section's current class teacher (any subject
--   in their own section — same "class teacher = whole section" scope
--   already used by the announcements feature) · the section's current
--   CR1/CR2 (any subject in their own section, never another section).
create or replace function public.notes_manager(p_section_id uuid, p_subject_id uuid) returns boolean
language sql security definer stable set search_path = public
as $$
  select
    public.is_admin()
    or public.teacher_has_subject_in_section(p_subject_id, p_section_id)
    or public.is_class_teacher_of_section(p_section_id)
    or public.is_current_cr_of_section(p_section_id);
$$;
revoke all on function public.notes_manager(uuid, uuid) from public;
revoke execute on function public.notes_manager(uuid, uuid) from anon;
grant execute on function public.notes_manager(uuid, uuid) to authenticated;

-- Who may VIEW Notes for this (section, subject): anyone who can
-- manage them, plus any student currently assigned to that section.
create or replace function public.notes_viewer(p_section_id uuid, p_subject_id uuid) returns boolean
language sql security definer stable set search_path = public
as $$
  select
    public.notes_manager(p_section_id, p_subject_id)
    or exists (
      select 1 from public.student_assignments sa
      where sa.student_id = auth.uid() and sa.is_current and sa.section_id = p_section_id
    );
$$;
revoke all on function public.notes_viewer(uuid, uuid) from public;
revoke execute on function public.notes_viewer(uuid, uuid) from anon;
grant execute on function public.notes_viewer(uuid, uuid) to authenticated;

-- ─── Row consistency trigger ────────────────────────────────────────
-- Keeps every note internally consistent so RLS on the `notes` table
-- (section_id/subject_id columns) can never drift from what the
-- storage-side policies below authorize (section_id/subject_id parsed
-- out of the object path) — both must always describe the same file.
create or replace function public.validate_note() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_topic_subject     uuid;
  v_subject_semester  uuid;
  v_section_semester   uuid;
  v_expected_prefix    text;
  v_uploader_name      text;
  v_uploader_role      text;
begin
  v_topic_subject := public.get_subject_id_for_topic(new.topic_id);
  if v_topic_subject is null or v_topic_subject <> new.subject_id then
    raise exception 'Chapter (topic) does not belong to the selected subject.';
  end if;

  select semester_id into v_subject_semester from public.subjects where id = new.subject_id;
  select semester_id into v_section_semester from public.sections where id = new.section_id;
  if v_subject_semester is null or v_section_semester is null or v_subject_semester <> v_section_semester then
    raise exception 'Selected section and subject are not in the same semester.';
  end if;

  v_expected_prefix := 'notes/' || new.section_id::text || '/' || new.subject_id::text || '/' || new.topic_id::text || '/';
  if new.file_path is null or left(new.file_path, length(v_expected_prefix)) <> v_expected_prefix then
    raise exception 'File path does not match the declared section/subject/chapter.';
  end if;

  if new.file_path !~* '\.pdf$' then
    raise exception 'Notes must be PDF files.';
  end if;

  if tg_op = 'INSERT' then
    -- Never trust client-supplied uploader identity/name/role — always
    -- derive from the authenticated caller's own users row server-side.
    new.uploaded_by := auth.uid();
    select full_name, role into v_uploader_name, v_uploader_role
      from public.users where id = auth.uid();
    new.uploaded_by_name := coalesce(v_uploader_name, '');
    new.uploaded_by_role := v_uploader_role;
  else
    -- Uploader identity/attribution is immutable after creation —
    -- replacing a file is still the same note record, not a reassignment
    -- of authorship.
    new.uploaded_by := old.uploaded_by;
    new.uploaded_by_name := old.uploaded_by_name;
    new.uploaded_by_role := old.uploaded_by_role;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists notes_validate on public.notes;
create trigger notes_validate
  before insert or update on public.notes
  for each row execute function public.validate_note();

-- ─── RLS ──────────────────────────────────────────────────────────────

alter table public.notes enable row level security;

drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes
  for select using ( public.notes_viewer(section_id, subject_id) );

drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes
  for insert with check (
    public.notes_manager(section_id, subject_id)
    and uploaded_by = auth.uid()
  );

drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes
  for update
  using ( public.notes_manager(section_id, subject_id) )
  with check ( public.notes_manager(section_id, subject_id) );

drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes
  for delete using ( public.notes_manager(section_id, subject_id) );

-- ─── Storage: scope the existing generic content-files policies OFF
--     the notes/ prefix, so those broader (teacher_or_admin-wide,
--     unscoped) rules can never apply to Notes storage objects ─────────

drop policy if exists content_files_staff_write on storage.objects;
create policy content_files_staff_write on storage.objects for insert
  with check (
    bucket_id = 'content-files'
    and public.is_teacher_or_admin()
    and (storage.foldername(name))[1] is distinct from 'notes'
  );

drop policy if exists content_files_staff_update on storage.objects;
create policy content_files_staff_update on storage.objects for update
  using (
    bucket_id = 'content-files'
    and public.is_teacher_or_admin()
    and (storage.foldername(name))[1] is distinct from 'notes'
  );

drop policy if exists content_files_admin_delete on storage.objects;
create policy content_files_admin_delete on storage.objects for delete
  using (
    bucket_id = 'content-files'
    and public.is_admin()
    and (storage.foldername(name))[1] is distinct from 'notes'
  );

-- ─── Storage: dedicated, section+subject-scoped Notes policies ────────
-- Path convention: notes/{section_id}/{subject_id}/{topic_id}/{file}.
-- Parses the path itself and defers entirely to notes_viewer/
-- notes_manager — the exact same authorization the `notes` TABLE rows
-- use — so a CR (or anyone) cannot gain access to another section's
-- files by guessing/constructing a path: the path's own encoded
-- section_id/subject_id must independently satisfy the same checks.

create or replace function public.notes_object_viewable(p_name text) returns boolean
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_parts   text[];
  v_section uuid;
  v_subject uuid;
begin
  v_parts := storage.foldername(p_name);
  if v_parts is null or array_length(v_parts, 1) < 3 or v_parts[1] <> 'notes' then
    return false;
  end if;
  begin
    v_section := v_parts[2]::uuid;
    v_subject := v_parts[3]::uuid;
  exception when others then
    return false;
  end;
  return public.notes_viewer(v_section, v_subject);
end;
$$;
revoke all on function public.notes_object_viewable(text) from public;
revoke execute on function public.notes_object_viewable(text) from anon;
grant execute on function public.notes_object_viewable(text) to authenticated;

create or replace function public.notes_object_manageable(p_name text) returns boolean
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_parts   text[];
  v_section uuid;
  v_subject uuid;
begin
  v_parts := storage.foldername(p_name);
  if v_parts is null or array_length(v_parts, 1) < 3 or v_parts[1] <> 'notes' then
    return false;
  end if;
  begin
    v_section := v_parts[2]::uuid;
    v_subject := v_parts[3]::uuid;
  exception when others then
    return false;
  end;
  return public.notes_manager(v_section, v_subject);
end;
$$;
revoke all on function public.notes_object_manageable(text) from public;
revoke execute on function public.notes_object_manageable(text) from anon;
grant execute on function public.notes_object_manageable(text) to authenticated;

drop policy if exists notes_files_scoped_read on storage.objects;
create policy notes_files_scoped_read on storage.objects for select
  using (
    bucket_id = 'content-files'
    and (storage.foldername(name))[1] = 'notes'
    and public.notes_object_viewable(name)
  );

drop policy if exists notes_files_scoped_write on storage.objects;
create policy notes_files_scoped_write on storage.objects for insert
  with check (
    bucket_id = 'content-files'
    and (storage.foldername(name))[1] = 'notes'
    and public.notes_object_manageable(name)
  );

drop policy if exists notes_files_scoped_update on storage.objects;
create policy notes_files_scoped_update on storage.objects for update
  using (
    bucket_id = 'content-files'
    and (storage.foldername(name))[1] = 'notes'
    and public.notes_object_manageable(name)
  );

drop policy if exists notes_files_scoped_delete on storage.objects;
create policy notes_files_scoped_delete on storage.objects for delete
  using (
    bucket_id = 'content-files'
    and (storage.foldername(name))[1] = 'notes'
    and public.notes_object_manageable(name)
  );

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration.
-- ═══════════════════════════════════════════════════════════════════════
