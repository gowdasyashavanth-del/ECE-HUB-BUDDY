-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration: Academic Event & Announcement Posters
-- Idempotent: safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Add nullable image_url column to planner_events and announcements
alter table public.planner_events
  add column if not exists image_url text;

alter table public.announcements
  add column if not exists image_url text;

-- 2. Safe migration for existing poster URLs:
-- First normalise supported legacy Supabase URLs for the 'posters' bucket to relative storage paths.
-- Strips protocol, domain, Supabase endpoint prefix, and query parameters.
update public.planner_events
set image_url = split_part(regexp_replace(image_url, '^https?://[^/]+/storage/v1/object/(public|sign|authenticated)/posters/', ''), '?', 1)
where image_url ~ '^https?://[^/]+/storage/v1/object/(public|sign|authenticated)/posters/';

update public.announcements
set image_url = split_part(regexp_replace(image_url, '^https?://[^/]+/storage/v1/object/(public|sign|authenticated)/posters/', ''), '?', 1)
where image_url ~ '^https?://[^/]+/storage/v1/object/(public|sign|authenticated)/posters/';

-- Do not silently retain unsupported external URLs or non-conforming paths:
-- Set any remaining invalid URLs to NULL before applying the strict format constraints.
update public.planner_events
set image_url = null
where image_url is not null
  and image_url !~ '^[0-9a-zA-Z_-]+/(planner|announcements)(/[0-9a-zA-Z_-]+)?/[^/\s]+$';

update public.announcements
set image_url = null
where image_url is not null
  and image_url !~ '^[0-9a-zA-Z_-]+/(planner|announcements)(/[0-9a-zA-Z_-]+)?/[^/\s]+$';

-- 3. Constraints on planner_events: allow NULL or valid relative paths in 'posters' bucket only
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'planner_events_image_url_length'
      and conrelid = 'public.planner_events'::regclass
  ) then
    alter table public.planner_events
      add constraint planner_events_image_url_length
      check (image_url is null or char_length(image_url) <= 2048);
  end if;
end $$;

do $$
begin
  alter table public.planner_events drop constraint if exists planner_events_image_url_format;
  alter table public.planner_events
    add constraint planner_events_image_url_format
    check (
      image_url is null
      or image_url ~ '^[0-9a-zA-Z_-]+/(planner|announcements)(/[0-9a-zA-Z_-]+)?/[^/\s]+$'
    );
end $$;

-- 4. Constraints on announcements: allow NULL or valid relative paths in 'posters' bucket only
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'announcements_image_url_length'
      and conrelid = 'public.announcements'::regclass
  ) then
    alter table public.announcements
      add constraint announcements_image_url_length
      check (image_url is null or char_length(image_url) <= 2048);
  end if;
end $$;

do $$
begin
  alter table public.announcements drop constraint if exists announcements_image_url_format;
  alter table public.announcements
    add constraint announcements_image_url_format
    check (
      image_url is null
      or image_url ~ '^[0-9a-zA-Z_-]+/(planner|announcements)(/[0-9a-zA-Z_-]+)?/[^/\s]+$'
    );
end $$;

-- Performance indexes for fast image path resolution in storage RLS
create index if not exists idx_planner_events_image_url on public.planner_events (image_url) where image_url is not null;
create index if not exists idx_announcements_image_url on public.announcements (image_url) where image_url is not null;

-- 3. Dedicated PRIVATE storage bucket for event and announcement posters.
-- Note: 'posters' is private to ensure event flyers and announcements
-- are accessible only to authenticated users who are authorized to view
-- the corresponding academic event or announcement.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posters', 'posters', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 4. Storage RLS policies for posters

-- Authenticated read: access granted strictly if:
-- 1. User is super admin
-- 2. Uploader access: strictly for author during upload/drafting lifecycle
--    - Teacher for own planner or announcement folders
--    - Active CR for own section announcement folder
-- 3. Consumers (students/teachers): only if authorized to view the corresponding
--    planner event or announcement record in the database
drop policy if exists "posters_public_read" on storage.objects;
drop policy if exists "posters_authorized_read" on storage.objects;
create policy "posters_authorized_read" on storage.objects for select
  using (
    bucket_id = 'posters'
    and (
      public.is_admin()
      or (
        (storage.foldername(name))[1] = auth.uid()::text
        and (
          (
            public.is_teacher_or_admin()
            and (storage.foldername(name))[2] in ('planner', 'announcements')
          )
          or (
            (storage.foldername(name))[2] = 'announcements'
            and (
              case
                when (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then public.is_current_cr_of_section(((storage.foldername(name))[3])::uuid)
                else false
              end
            )
          )
        )
      )
      or exists (
        select 1 from public.planner_events pe
        where pe.image_url = name
      )
      or exists (
        select 1 from public.announcements a
        where a.image_url = name
      )
    )
  );

-- Upload / Insert:
-- - Super admins: can upload anywhere within posters.
-- - Teachers: must upload into their own folder (auth.uid()) under 'planner' or 'announcements'.
-- - Active CRs: must upload into their own folder (auth.uid()) strictly under 'announcements/<section_id>'
--   where section_id is a valid UUID and matches their currently designated section.
-- - Regular students: cannot upload to posters.
drop policy if exists "posters_authorized_insert" on storage.objects;
create policy "posters_authorized_insert" on storage.objects for insert
  with check (
    bucket_id = 'posters'
    and (
      (
        (storage.foldername(name))[1] = auth.uid()::text
        and (
          (
            public.is_teacher_or_admin()
            and (storage.foldername(name))[2] in ('planner', 'announcements')
          )
          or (
            (storage.foldername(name))[2] = 'announcements'
            and (
              case
                when (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then public.is_current_cr_of_section(((storage.foldername(name))[3])::uuid)
                else false
              end
            )
          )
        )
      )
      or public.is_admin()
    )
  );

-- Update:
-- Evaluates both old row (USING) and new row (WITH CHECK) to apply symmetrical
-- folder, role, and module restrictions.
drop policy if exists "posters_authorized_update" on storage.objects;
create policy "posters_authorized_update" on storage.objects for update
  using (
    bucket_id = 'posters'
    and (
      (
        (storage.foldername(name))[1] = auth.uid()::text
        and (
          (
            public.is_teacher_or_admin()
            and (storage.foldername(name))[2] in ('planner', 'announcements')
          )
          or (
            (storage.foldername(name))[2] = 'announcements'
            and (
              case
                when (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then public.is_current_cr_of_section(((storage.foldername(name))[3])::uuid)
                else false
              end
            )
          )
        )
      )
      or public.is_admin()
    )
  )
  with check (
    bucket_id = 'posters'
    and (
      (
        (storage.foldername(name))[1] = auth.uid()::text
        and (
          (
            public.is_teacher_or_admin()
            and (storage.foldername(name))[2] in ('planner', 'announcements')
          )
          or (
            (storage.foldername(name))[2] = 'announcements'
            and (
              case
                when (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then public.is_current_cr_of_section(((storage.foldername(name))[3])::uuid)
                else false
              end
            )
          )
        )
      )
      or public.is_admin()
    )
  );

-- Delete:
-- Applies symmetrical folder, role, and module restrictions.
-- Super admins may manage all objects in the 'posters' bucket.
drop policy if exists "posters_authorized_delete" on storage.objects;
create policy "posters_authorized_delete" on storage.objects for delete
  using (
    bucket_id = 'posters'
    and (
      (
        (storage.foldername(name))[1] = auth.uid()::text
        and (
          (
            public.is_teacher_or_admin()
            and (storage.foldername(name))[2] in ('planner', 'announcements')
          )
          or (
            (storage.foldername(name))[2] = 'announcements'
            and (
              case
                when (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then public.is_current_cr_of_section(((storage.foldername(name))[3])::uuid)
                else false
              end
            )
          )
        )
      )
      or public.is_admin()
    )
  );
