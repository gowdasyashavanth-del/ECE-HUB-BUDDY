-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration: Notes Chapters (Phase 1 — Additive)
-- Idempotent: safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Helper: teacher is assigned to this subject (directly or as class
--     teacher of a section whose semester contains the subject) ──────────
create or replace function public.teacher_manages_subject(p_subject_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.teacher_assignments ta
    where ta.teacher_id = auth.uid() and ta.subject_id = p_subject_id
  )
  or exists (
    select 1
    from public.class_teacher_assignments cta
    join public.sections sec on sec.id = cta.section_id
    join public.subjects sub on sub.semester_id = sec.semester_id
    where cta.teacher_id = auth.uid()
      and cta.is_current
      and sub.id = p_subject_id
  );
$$;
revoke all    on function public.teacher_manages_subject(uuid) from public;
revoke execute on function public.teacher_manages_subject(uuid) from anon;
grant  execute on function public.teacher_manages_subject(uuid) to authenticated;

-- ─── Table ────────────────────────────────────────────────────────────
create table if not exists public.note_chapters (
  id            uuid        primary key default gen_random_uuid(),
  subject_id    uuid        not null references public.subjects(id) on delete cascade,
  unit_id       uuid        not null references public.units(id)    on delete cascade,
  topic_id      uuid        references public.topics(id) on delete set null,
  name          text        not null,
  display_order integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_note_chapters_subject on public.note_chapters(subject_id);
create index if not exists idx_note_chapters_unit    on public.note_chapters(unit_id);
create index if not exists idx_note_chapters_topic   on public.note_chapters(topic_id);

-- At most one Notes Chapter may map to a given academic topic
create unique index if not exists uq_note_chapters_topic
  on public.note_chapters(topic_id)
  where topic_id is not null;

-- ─── Consistency trigger ──────────────────────────────────────────────
create or replace function public.validate_note_chapter() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_unit_subject  uuid;
  v_topic_unit    uuid;
  v_topic_subject uuid;
begin
  select u.subject_id into v_unit_subject
  from public.units u where u.id = new.unit_id;

  if v_unit_subject is null then
    raise exception 'Unit not found.';
  end if;

  new.subject_id := v_unit_subject;

  if new.topic_id is not null then
    select t.unit_id, public.get_subject_id_for_topic(t.id)
      into v_topic_unit, v_topic_subject
    from public.topics t where t.id = new.topic_id;

    if v_topic_unit is null then
      raise exception 'Topic not found.';
    end if;
    if v_topic_unit is distinct from new.unit_id then
      raise exception 'Topic does not belong to the selected unit.';
    end if;
    if v_topic_subject is distinct from new.subject_id then
      raise exception 'Topic does not belong to the selected subject.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists note_chapters_validate on public.note_chapters;
create trigger note_chapters_validate
  before insert or update on public.note_chapters
  for each row execute function public.validate_note_chapter();

-- ─── RLS ──────────────────────────────────────────────────────────────
alter table public.note_chapters enable row level security;

-- SELECT: admin, or student enrolled in the subject's semester, or teacher managing the subject
drop policy if exists note_chapters_select on public.note_chapters;
create policy note_chapters_select on public.note_chapters
  for select using (
    public.is_admin()
    or (public.current_role() = 'student' and public.student_enrolled_in_subject(subject_id))
    or (public.current_role() = 'teacher' and public.teacher_manages_subject(subject_id))
  );

drop policy if exists note_chapters_insert on public.note_chapters;
create policy note_chapters_insert on public.note_chapters
  for insert with check (
    public.is_admin()
    or (public.current_role() = 'teacher' and public.teacher_manages_subject(subject_id))
  );

drop policy if exists note_chapters_update on public.note_chapters;
create policy note_chapters_update on public.note_chapters
  for update
  using (
    public.is_admin() or (public.current_role() = 'teacher' and public.teacher_manages_subject(subject_id))
  )
  with check (
    public.is_admin() or (public.current_role() = 'teacher' and public.teacher_manages_subject(subject_id))
  );

drop policy if exists note_chapters_delete on public.note_chapters;
create policy note_chapters_delete on public.note_chapters
  for delete using (public.is_admin());

-- ─── Add note_chapter_id to public.notes ────────
alter table public.notes
  add column if not exists note_chapter_id uuid
    references public.note_chapters(id) on delete restrict;

create index if not exists idx_notes_note_chapter
  on public.notes(note_chapter_id);

-- Drop NOT NULL constraint on topic_id to allow unmapped chapters
ALTER TABLE public.notes ALTER COLUMN topic_id DROP NOT NULL;
