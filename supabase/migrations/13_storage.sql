-- ═══════════════════════════════════════════════════════════════════════
-- ECE Hub Buddy — Migration 13: Storage Buckets & Policies
-- DESIGN ONLY — review before running against a real Supabase project.
-- Idempotent: safe to run multiple times.
--
-- Two buckets, minimal by design (no certificates/assignments buckets —
-- nothing in the approved product scope calls for them yet):
--   avatars:       public-read, profile photos.
--   content-files: private. Notes/formula-sheet/document uploads
--                  referenced by content.file_url. Gated behind auth +
--                  role, same pattern as Bioverse's notes-pdfs bucket.
-- ═══════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars',       'avatars',       true,  5242880,  array['image/png','image/jpeg','image/webp']),
  ('content-files', 'content-files', false, 52428800, array['application/pdf','image/png','image/jpeg'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ─── AVATARS ────────────────────────────────────────────────────────────
-- Convention: avatars/{user_id}/filename.ext
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_own_folder_write" on storage.objects;
create policy "avatars_own_folder_write" on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and ( (storage.foldername(name))[1] = auth.uid()::text or public.is_admin() )
  );

drop policy if exists "avatars_own_folder_update" on storage.objects;
create policy "avatars_own_folder_update" on storage.objects for update
  using (
    bucket_id = 'avatars'
    and ( (storage.foldername(name))[1] = auth.uid()::text or public.is_admin() )
  );

drop policy if exists "avatars_own_folder_delete" on storage.objects;
create policy "avatars_own_folder_delete" on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and ( (storage.foldername(name))[1] = auth.uid()::text or public.is_admin() )
  );

-- ─── CONTENT-FILES ──────────────────────────────────────────────────────
-- Convention: content-files/{topic_id}/filename.ext
-- Not folder-owned by a user — access is role-based, matching the
-- 'content' table's own RLS: any authenticated user can attempt to
-- read (the actual content ROW's RLS in content_files-linked rows is
-- what really gates visibility at the application level — this policy
-- is intentionally the broader of the two, same relationship Bioverse
-- had between notes-pdfs storage policy and the notes table's RLS).
-- Only assigned teachers/admins upload or modify; only admin deletes.
drop policy if exists "content_files_authenticated_read" on storage.objects;
create policy "content_files_authenticated_read" on storage.objects for select
  using (bucket_id = 'content-files' and auth.role() = 'authenticated');

drop policy if exists "content_files_staff_write" on storage.objects;
create policy "content_files_staff_write" on storage.objects for insert
  with check (bucket_id = 'content-files' and public.is_teacher_or_admin());

drop policy if exists "content_files_staff_update" on storage.objects;
create policy "content_files_staff_update" on storage.objects for update
  using (bucket_id = 'content-files' and public.is_teacher_or_admin());

drop policy if exists "content_files_admin_delete" on storage.objects;
create policy "content_files_admin_delete" on storage.objects for delete
  using (bucket_id = 'content-files' and public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════
-- End of Migration 13.
-- ═══════════════════════════════════════════════════════════════════════
