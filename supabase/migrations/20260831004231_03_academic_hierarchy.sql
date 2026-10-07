-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 03: Academic Hierarchy
-- DESIGN ONLY — review before running against a real Supabase project.
--
-- Academic Year → Regulation → Program → Semester(1-8) → Section
--   → Subject → Unit → Topic → Content
-- NO Branch. Program is admin-manageable data, not hardcoded.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.academic_years (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,          -- e.g. "2026-27"
  is_current  boolean not null default false,
  created_at  timestamptz not null default now()
);
-- At most one academic year may be marked current at a time.
create unique index if not exists one_current_academic_year
  on public.academic_years(is_current) where is_current;

create table if not exists public.regulations (
  id                uuid primary key default gen_random_uuid(),
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  name              text not null,           -- e.g. "2026 Regulation"
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (academic_year_id, name)
);
create index if not exists idx_regulations_year on public.regulations(academic_year_id);

create table if not exists public.programs (
  id              uuid primary key default gen_random_uuid(),
  regulation_id   uuid not null references public.regulations(id) on delete restrict,
  name            text not null,             -- e.g. "B.E. Electronics & Communication Engineering"
  code            text,                      -- e.g. "ECE"
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (regulation_id, code)
);
create index if not exists idx_programs_regulation on public.programs(regulation_id);

create table if not exists public.semesters (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs(id) on delete restrict,
  number      integer not null check (number between 1 and 8),
  name        text,                          -- display override, e.g. "Semester 3"
  created_at  timestamptz not null default now(),
  unique (program_id, number)
);
create index if not exists idx_semesters_program on public.semesters(program_id);

create table if not exists public.sections (
  id                uuid primary key default gen_random_uuid(),
  semester_id       uuid not null references public.semesters(id) on delete restrict,
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  name              text not null,           -- e.g. "A"
  created_at        timestamptz not null default now(),
  unique (semester_id, academic_year_id, name)
);
create index if not exists idx_sections_semester on public.sections(semester_id);

create table if not exists public.subjects (
  id            uuid primary key default gen_random_uuid(),
  semester_id   uuid not null references public.semesters(id) on delete restrict,
  name          text not null,               -- e.g. "Network Analysis"
  code          text,
  credits       integer,
  order_number  integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (semester_id, code)
);
create index if not exists idx_subjects_semester on public.subjects(semester_id);

create table if not exists public.units (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid not null references public.subjects(id) on delete cascade,
  name          text not null,               -- e.g. "Unit 1"
  order_number  integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_units_subject on public.units(subject_id);

create table if not exists public.topics (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references public.units(id) on delete cascade,
  name          text not null,               -- e.g. "Circuit Laws"
  order_number  integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_topics_unit on public.topics(unit_id);

-- Content type is a plain check constraint for V1's approved set. Adding
-- a new type later (e.g. "simulation") only requires one migration that
-- drops and re-adds this constraint with the new value included — it
-- does not require restructuring the content table itself, since every
-- content type shares the same shape (title + file/external URL +
-- uploader + published flag).
create table if not exists public.content (
  id            uuid primary key default gen_random_uuid(),
  topic_id      uuid not null references public.topics(id) on delete cascade,
  type          text not null check (type in ('note','video','document','link','assignment','quiz')),
  title         text not null,
  file_url      text,
  external_url  text,
  uploaded_by   uuid references public.users(id) on delete set null,
  is_published  boolean not null default true,
  created_at    timestamptz not null default now(),
  check (file_url is not null or external_url is not null)
);
create index if not exists idx_content_topic on public.content(topic_id);
create index if not exists idx_content_published on public.content(is_published);

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 03.
-- ═══════════════════════════════════════════════════════════════════════
