-- Phase 14.1, Decision 4: pin search_path on set_updated_at(), matching
-- the pattern already used by every other function in this project.
-- Behavior unchanged.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
