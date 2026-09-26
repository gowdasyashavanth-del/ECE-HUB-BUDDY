-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 22: Single current academic year
--
-- academic_years.is_current had no DB-level enforcement that only one
-- row can be current at a time — the existing admin UI achieves it by
-- issuing two sequential UPDATEs (unset old, set new) and hoping
-- nothing goes wrong in between. This closes that gap the same way
-- Phase 16A closed "one current class teacher per section": a trigger
-- for graceful same-statement behavior, backed by a partial unique
-- index as the absolute guarantee.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.enforce_single_current_academic_year() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.is_current then
    update public.academic_years
      set is_current = false
    where id <> new.id and is_current;
  end if;
  return new;
end;
$$;

create trigger academic_years_single_current
  before insert or update of is_current on public.academic_years
  for each row execute function public.enforce_single_current_academic_year();

-- Backstop: even if the trigger were ever bypassed, the DB still
-- cannot end up with two current rows.
create unique index academic_years_one_current
  on public.academic_years (is_current) where is_current;

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 22.
-- ═══════════════════════════════════════════════════════════════════════
