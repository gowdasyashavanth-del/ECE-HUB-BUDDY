-- Non-admins could rewrite their own public.users.email (profile display/search field).
-- Block that; admin edits and the auth-signup trigger are unaffected.
create or replace function public.protect_sensitive_user_columns()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_trusted boolean := coalesce(current_setting('app.trusted_engagement_update', true) = 'true', false);
  v_first_admin_bootstrap boolean := coalesce(current_setting('app.first_admin_bootstrap', true) = 'true', false);
begin
  if not public.is_admin() then
    if new.role is distinct from old.role then
      if v_first_admin_bootstrap and new.role = 'super_admin'
         and not exists (select 1 from public.users where role = 'super_admin') then
        null;
      else
        raise exception 'Not allowed to change role directly.';
      end if;
    end if;
    if new.email is distinct from old.email then raise exception 'Not allowed to change email directly.'; end if;
    if new.xp is distinct from old.xp and not v_trusted then raise exception 'Not allowed to change xp directly.'; end if;
    if new.streak is distinct from old.streak and not v_trusted then raise exception 'Not allowed to change streak directly.'; end if;
  end if;
  return new;
end;
$function$;
