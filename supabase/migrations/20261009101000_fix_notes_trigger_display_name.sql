-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration: Fix Notes Trigger Uploader Lookup
-- Corrects public.validate_note() uploader attribution query from
-- non-existent public.users.display_name to public.users.full_name.
-- Preserves all validation, Note Chapter checks, and storage path rules.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.validate_note() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_nc_subject       uuid;
  v_nc_topic         uuid;
  v_topic_subject    uuid;
  v_subject_semester uuid;
  v_section_semester uuid;
  v_expected_prefix  text;
  v_uploader_name    text;
  v_uploader_role    text;
  v_file_changed     boolean;
begin

  -- ─── 1. Determine whether the file_path has changed (UPDATE only) ──────
  v_file_changed := (tg_op = 'INSERT')
                 or (tg_op = 'UPDATE' and new.file_path is distinct from old.file_path);

  -- ─── 2. Validate note_chapter_id / topic_id ────────────────────────────
  if new.note_chapter_id is not null then
    select nc.subject_id, nc.topic_id into v_nc_subject, v_nc_topic
    from public.note_chapters nc
    where nc.id = new.note_chapter_id;

    if v_nc_subject is null then
      raise exception 'Note chapter not found.';
    end if;

    if v_nc_subject <> new.subject_id then
      raise exception 'Note chapter does not belong to the selected subject.';
    end if;

    -- Cross-hierarchy integrity for transitional period:
    if new.topic_id is not null then
      if v_nc_topic is distinct from new.topic_id then
        raise exception 'Inconsistent topic mapping between note and chapter.';
      end if;
    else
      -- Auto-populate topic_id for legacy compatibility (e.g. older endpoints)
      new.topic_id := v_nc_topic;
    end if;

  else
    -- Legacy fallback (should only happen for older clients or updates if somehow backfill didn't run,
    -- but backfill guarantees it did. New inserts require note_chapter_id).
    if tg_op = 'INSERT' then
      raise exception 'note_chapter_id is required.';
    end if;

    select public.get_subject_id_for_topic(new.topic_id) into v_topic_subject;
    if v_topic_subject is null then
      raise exception 'Legacy topic not found.';
    end if;
    if v_topic_subject <> new.subject_id then
      raise exception 'Legacy topic does not belong to the selected subject.';
    end if;
  end if;

  -- ─── 3. Validate Section ↔ Subject mapping ─────────────────────────────
  select semester_id into v_section_semester
  from public.sections where id = new.section_id;

  select semester_id into v_subject_semester
  from public.subjects where id = new.subject_id;

  if v_section_semester is null or v_subject_semester is null then
    raise exception 'Invalid section or subject.';
  end if;
  if v_section_semester <> v_subject_semester then
    raise exception 'Subject and Section must belong to the same semester.';
  end if;

  -- ─── 4. Validate Storage Path (only if file changed) ───────────────────
  if v_file_changed then
    if new.note_chapter_id is not null then
      v_expected_prefix := 'notes/' || new.section_id || '/' || new.subject_id || '/' || new.note_chapter_id || '/';
    else
      v_expected_prefix := 'notes/' || new.section_id || '/' || new.subject_id || '/' || new.topic_id || '/';
    end if;

    if new.file_path not like (v_expected_prefix || '%') then
      raise exception 'Invalid storage path. Expected prefix: %', v_expected_prefix;
    end if;
  end if;

  -- ─── 5. Uploader attribution ───────────────────────────────────────────
  if tg_op = 'INSERT' then
    if new.uploaded_by is null then
      new.uploaded_by := auth.uid();
    end if;

    select full_name, role into v_uploader_name, v_uploader_role
    from public.users where id = new.uploaded_by;

    new.uploaded_by_name := coalesce(v_uploader_name, 'Unknown User');
    new.uploaded_by_role := v_uploader_role;
  else
    -- Updates cannot steal attribution
    new.uploaded_by      := old.uploaded_by;
    new.uploaded_by_name := old.uploaded_by_name;
    new.uploaded_by_role := old.uploaded_by_role;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
