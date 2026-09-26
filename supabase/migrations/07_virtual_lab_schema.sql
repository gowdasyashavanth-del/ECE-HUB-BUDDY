-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 07: Virtual Electronics Lab Schema
-- DESIGN ONLY — review before running against a real Supabase project.
--
-- Per the approved Virtual Lab design:
--  - Component INSTANCES (in a circuit) are embedded JSON inside
--    student_circuits.circuit_data — no separate instance table.
--  - No attempt_measurements time-series table for V1 (deferred).
--  - No branch/payments/exam-type concepts anywhere in this file.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── COMPONENT CATALOG (shared, admin-managed, type-level) ─────────────
create table if not exists public.lab_components (
  id                      uuid primary key default gen_random_uuid(),
  type_key                text not null unique,   -- stable id referenced from circuit JSON, e.g. "resistor"
  display_name            text not null,
  category                text,                    -- e.g. "Passive", "Source", "Instrument"
  symbol_ref              text,                    -- reference to an icon/SVG asset, not the SVG itself
  educational_description text,
  is_active               boolean not null default true,   -- soft-retire; never delete a type once circuits use it
  created_at              timestamptz not null default now()
);

create table if not exists public.lab_component_terminals (
  id                  uuid primary key default gen_random_uuid(),
  component_type_id   uuid not null references public.lab_components(id) on delete cascade,
  terminal_key        text not null,               -- e.g. "anode", "t1"
  polarity            text not null check (polarity in ('positive','negative','neutral','signal')),
  position_hint       jsonb,                       -- relative { "x":.., "y":.. } on the component's default footprint
  label               text,
  unique (component_type_id, terminal_key)
);

create table if not exists public.lab_component_properties (
  id                  uuid primary key default gen_random_uuid(),
  component_type_id   uuid not null references public.lab_components(id) on delete cascade,
  property_key        text not null,               -- e.g. "resistance"
  label               text not null,
  unit                text,                        -- e.g. "Ω"
  data_type           text not null check (data_type in ('number','enum','boolean')),
  default_value       jsonb,
  min_value           numeric,
  max_value           numeric,
  enum_options        jsonb,                       -- for data_type='enum'
  unique (component_type_id, property_key)
);

-- ─── EXPERIMENTS ─────────────────────────────────────────────────────────
create table if not exists public.experiments (
  id                    uuid primary key default gen_random_uuid(),
  topic_id              uuid not null references public.topics(id) on delete cascade,
  title                 text not null,
  description           text,
  objective             text,
  theory                text,
  instructions          jsonb not null default '[]',   -- ordered step array
  expected_observations text,
  difficulty            text not null default 'Medium' check (difficulty in ('Easy','Medium','Hard')),
  evaluation_criteria   jsonb not null default '{}',   -- structured grading rules, read by the grading function
  is_published          boolean not null default false,
  created_by            uuid references public.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_experiments_topic on public.experiments(topic_id);
create index if not exists idx_experiments_published on public.experiments(is_published);

drop trigger if exists trg_experiments_updated_at on public.experiments;
create trigger trg_experiments_updated_at before update on public.experiments
  for each row execute function set_updated_at();

create table if not exists public.experiment_required_components (
  id                  uuid primary key default gen_random_uuid(),
  experiment_id       uuid not null references public.experiments(id) on delete cascade,
  component_type_id   uuid not null references public.lab_components(id) on delete restrict,
  quantity_min        integer not null default 1,
  quantity_max        integer,
  unique (experiment_id, component_type_id)
);

create table if not exists public.experiment_questions (
  id              uuid primary key default gen_random_uuid(),
  experiment_id   uuid not null references public.experiments(id) on delete cascade,
  question_text   text not null,
  options         jsonb not null,
  correct_answer  text not null,
  explanation     text,
  order_number    integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_experiment_questions_experiment on public.experiment_questions(experiment_id);

-- ─── STUDENT CIRCUITS (component instances + wires embedded as JSON) ────
create table if not exists public.student_circuits (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references public.users(id) on delete cascade,
  experiment_id       uuid references public.experiments(id) on delete set null,   -- nullable: free-play circuits allowed
  name                text not null default 'Untitled circuit',
  circuit_data        jsonb not null default '{"components": [], "wires": []}',
  is_valid_snapshot   boolean,   -- cached result of the last simulation run, nullable until first run
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_student_circuits_student on public.student_circuits(student_id);
create index if not exists idx_student_circuits_experiment on public.student_circuits(experiment_id);

drop trigger if exists trg_student_circuits_updated_at on public.student_circuits;
create trigger trg_student_circuits_updated_at before update on public.student_circuits
  for each row execute function set_updated_at();

-- ─── EXPERIMENT ATTEMPTS ─────────────────────────────────────────────────
create table if not exists public.experiment_attempts (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references public.users(id) on delete cascade,
  experiment_id       uuid not null references public.experiments(id) on delete cascade,
  circuit_id          uuid references public.student_circuits(id) on delete set null,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  circuit_snapshot    jsonb,      -- a COPY of circuit_data at submission time, not a live reference
  validation_result   jsonb,      -- structured grading output; written only by trusted server-side logic
  score               integer,
  xp_earned           integer not null default 0,
  completion_status   text not null default 'in_progress' check (completion_status in ('in_progress','completed','abandoned')),
  created_at          timestamptz not null default now()
);
create index if not exists idx_experiment_attempts_student on public.experiment_attempts(student_id, experiment_id);
create index if not exists idx_experiment_attempts_experiment on public.experiment_attempts(experiment_id);

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 07.
-- ═══════════════════════════════════════════════════════════════════════
