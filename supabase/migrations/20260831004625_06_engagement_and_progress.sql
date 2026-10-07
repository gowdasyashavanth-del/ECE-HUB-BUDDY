-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 06: Announcements, Reels, Progress, Achievements
-- DESIGN ONLY — review before running against a real Supabase project.
--
-- 'student_achievements' is an addition beyond your literal 25-item
-- list, alongside 'achievements' — flagged in 00_MIGRATION_PLAN.md —
-- an achievement catalog needs a join table recording who's unlocked
-- what, or the catalog does nothing.
-- ═══════════════════════════════════════════════════════════════════════

-- scope_type covers global (admin) announcements plus every level of the
-- academic hierarchy Academic Year -> Regulation -> Program -> Semester
-- -> Section, so an announcement can target as broad or as narrow an
-- audience as makes sense. scope_id then points at the matching row's
-- id for whichever level was chosen (academic_years.id, regulations.id,
-- programs.id, semesters.id, or sections.id) — enforced by application
-- code / the RLS policies in 11_rls_learning_and_engagement.sql, since
-- Postgres has no polymorphic FK constraint; a check keeps scope_id
-- required for every scope except 'all'.
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  scope_type  text not null check (scope_type in ('all','academic_year','regulation','program','semester','section')),
  scope_id    uuid,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check ( (scope_type = 'all' and scope_id is null) or (scope_type <> 'all' and scope_id is not null) )
);
create index if not exists idx_announcements_scope on public.announcements(scope_type, scope_id);

create table if not exists public.reels (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  video_url     text not null,
  category      text,
  subject_id    uuid references public.subjects(id) on delete set null,   -- nullable: general or subject-tagged
  is_published  boolean not null default true,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_reels_subject on public.reels(subject_id);
create index if not exists idx_reels_published on public.reels(is_published);

create table if not exists public.reel_bookmarks (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.users(id) on delete cascade,
  reel_id     uuid not null references public.reels(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (student_id, reel_id)
);

create table if not exists public.reel_watch_history (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.users(id) on delete cascade,
  reel_id     uuid not null references public.reels(id) on delete cascade,
  watched_at  timestamptz not null default now()
);
create index if not exists idx_reel_watch_student on public.reel_watch_history(student_id);

create table if not exists public.progress (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.users(id) on delete cascade,
  topic_id      uuid not null references public.topics(id) on delete cascade,
  percent_done  integer not null default 0 check (percent_done between 0 and 100),
  updated_at    timestamptz not null default now(),
  unique (student_id, topic_id)
);
create index if not exists idx_progress_student on public.progress(student_id);

create table if not exists public.achievements (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,   -- stable machine identifier, e.g. "first_experiment_complete"
  name         text not null,
  description  text,
  icon         text,
  xp_reward    integer not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.student_achievements (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.users(id) on delete cascade,
  achievement_id  uuid not null references public.achievements(id) on delete cascade,
  unlocked_at     timestamptz not null default now(),
  unique (student_id, achievement_id)
);
create index if not exists idx_student_achievements_student on public.student_achievements(student_id);

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 06.
-- ═══════════════════════════════════════════════════════════════════════
