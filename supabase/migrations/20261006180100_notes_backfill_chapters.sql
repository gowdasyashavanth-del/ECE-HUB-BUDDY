-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration: Notes Backfill (Phase 2)
-- Safely seeds note_chapters for existing topic-based notes and maps them.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  v_notes_total int;
  v_notes_mapped int;
  v_notes_unmapped int;
begin
  -- 1. Create a note_chapter for every unique (subject_id, unit_id, topic_id) combo
  --    found in existing notes, where one doesn't already exist.
  insert into public.note_chapters (subject_id, unit_id, topic_id, name, display_order)
  select distinct on (n.subject_id, t.unit_id, n.topic_id)
    n.subject_id,
    t.unit_id,
    n.topic_id,
    t.name,
    coalesce(t.order_number, 0)
  from public.notes n
  join public.topics t on t.id = n.topic_id
  where n.note_chapter_id is null
    and n.topic_id is not null
    and not exists (
      select 1 from public.note_chapters nc where nc.topic_id = n.topic_id
    );

  -- 2. Backfill note_chapter_id on public.notes.
  update public.notes n
  set note_chapter_id = nc.id
  from public.note_chapters nc
  where n.note_chapter_id is null
    and n.topic_id = nc.topic_id;

  -- 3. Verify data integrity.
  select count(*) into v_notes_total from public.notes;
  select count(*) into v_notes_mapped from public.notes where note_chapter_id is not null;
  select count(*) into v_notes_unmapped from public.notes where note_chapter_id is null;

  raise notice 'Backfill complete. Total Notes: %. Mapped: %. Unmapped: %.',
               v_notes_total, v_notes_mapped, v_notes_unmapped;

  if v_notes_unmapped > 0 then
    raise exception 'DATA INTEGRITY ERROR: % notes failed to map to a note_chapter.', v_notes_unmapped;
  end if;

end;
$$;
