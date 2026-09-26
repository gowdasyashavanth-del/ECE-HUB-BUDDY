-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 01: Extensions & Shared Helpers
-- DESIGN ONLY — review before running against a real Supabase project.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- Shared updated_at trigger, used by every table below that has an
-- updated_at column. One definition, reused everywhere.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 01.
-- ═══════════════════════════════════════════════════════════════════════
