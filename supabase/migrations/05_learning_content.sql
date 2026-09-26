-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 05: Formulas, Questions, Tests, Results
-- DESIGN ONLY — review before running against a real Supabase project.
--
-- 'results' is an addition beyond your literal 25-item list — flagged
-- in 00_MIGRATION_PLAN.md — added because 'tests'/'questions' need
-- somewhere to record an outcome.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.formulas (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid not null references public.subjects(id) on delete cascade,
  topic_id      uuid references public.topics(id) on delete set null,   -- nullable: subject-wide or topic-specific
  name          text not null,
  expression    text not null,
  variables     jsonb not null default '[]',   -- [{ "symbol": "V", "meaning": "Voltage", "unit": "V" }, ...]
  description   text,
  example       text,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_formulas_subject on public.formulas(subject_id);
create index if not exists idx_formulas_topic on public.formulas(topic_id);

create table if not exists public.questions (
  id              uuid primary key default gen_random_uuid(),
  topic_id        uuid not null references public.topics(id) on delete cascade,
  question_text   text not null,
  options         jsonb not null,
  correct_answer  text not null,
  explanation     text,
  difficulty      text not null default 'Medium' check (difficulty in ('Easy','Medium','Hard')),
  created_at      timestamptz not null default now()
);
create index if not exists idx_questions_topic on public.questions(topic_id);

create table if not exists public.tests (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid references public.subjects(id) on delete cascade,
  topic_id      uuid references public.topics(id) on delete cascade,
  title         text not null,
  question_ids  uuid[] not null default '{}',
  duration_min  integer default 30,
  is_published  boolean not null default true,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  -- A test is scoped to exactly one of subject or topic, never both,
  -- never neither.
  check ( (subject_id is not null)::int + (topic_id is not null)::int = 1 )
);
create index if not exists idx_tests_subject on public.tests(subject_id);
create index if not exists idx_tests_topic on public.tests(topic_id);

create table if not exists public.results (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.users(id) on delete cascade,
  test_id     uuid not null references public.tests(id) on delete cascade,
  score       integer not null,
  total       integer not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_results_student on public.results(student_id);
create index if not exists idx_results_test on public.results(test_id);

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 05.
-- ═══════════════════════════════════════════════════════════════════════
