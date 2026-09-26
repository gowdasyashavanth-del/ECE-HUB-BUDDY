-- Fix: unset trusted flags return NULL from current_setting(..., true) = 'true',
-- which made `not v_trusted` NULL and let students bypass xp/streak protection.
-- Both flags are now coalesced to false when unset. Mirrors the applied live migration.
CREATE OR REPLACE FUNCTION public.protect_sensitive_user_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_trusted boolean := coalesce(current_setting('app.trusted_engagement_update', true) = 'true', false);
  v_first_admin_bootstrap boolean := coalesce(current_setting('app.first_admin_bootstrap', true) = 'true', false);
begin
  if not public.is_admin() then
    if new.role is distinct from old.role then
      if v_first_admin_bootstrap
         and new.role = 'super_admin'
         and not exists (select 1 from public.users where role = 'super_admin')
      then
        null; -- allowed: first-admin bootstrap only
      else
        raise exception 'Not allowed to change role directly.';
      end if;
    end if;
    if new.xp is distinct from old.xp and not v_trusted then
      raise exception 'Not allowed to change xp directly.';
    end if;
    if new.streak is distinct from old.streak and not v_trusted then
      raise exception 'Not allowed to change streak directly.';
    end if;
  end if;
  return new;
end;
$function$;
