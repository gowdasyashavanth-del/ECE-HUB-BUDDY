CREATE OR REPLACE FUNCTION public.bootstrap_first_super_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('public.bootstrap_first_super_admin')::bigint
  );

  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE role = 'super_admin'
  ) THEN
    RAISE EXCEPTION
      'Bootstrap refused: a super_admin already exists. This function only ever establishes the FIRST super_admin and cannot be used again.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = p_user_id
  ) THEN
    RAISE EXCEPTION
      'Bootstrap refused: no public.users row exists for that id.';
  END IF;

  PERFORM set_config('app.first_admin_bootstrap', 'true', true);

  UPDATE public.users
  SET role = 'super_admin'
  WHERE id = p_user_id;
END;
$function$;
