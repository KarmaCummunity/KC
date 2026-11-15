-- ─────────────────────────────────────────────
-- 0009_init_avatars_bucket.sql
-- Creates the `avatars` Storage bucket + RLS policies for FR-AUTH-011 (onboarding profile photo)
-- and FR-PROFILE-007 (Edit Profile avatar replace).
--
-- Path scheme: <user_id>/avatar.jpg (single file per user; upserted on every change).
-- Public read — same posture as `post-images` (TD-11 tracks the future tightening for both buckets).
-- ─────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_read_public on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');
