-- 0150_post_images_bucket_cap | TD-84 — pre-launch hardening
--
-- The `post-images` bucket (created in 0002 §post-images) was left without
-- `file_size_limit` or `allowed_mime_types`. The `media_assets` row check
-- (0002 §4) caps file size at 8 MB and limits mime to image/jpeg|png|heic,
-- but any authenticated caller bypassing the FE can write directly to
-- Storage with arbitrarily large bodies or text/html / image/svg+xml —
-- a stored-XSS vector for any client that proxies bucket content inline.
--
-- Align the bucket policy with the DB constraint:
--   - file_size_limit  = 8 MB
--   - allowed_mime_types = jpeg + png + heic (same set as media_assets.mime_type check)
--
-- The FE today (apps/mobile/src/services/imageUpload.ts) only ever uploads
-- JPEG; PNG and HEIC are reserved by the row constraint for future support.
-- Tightening further to JPEG-only would prevent rollout of those formats
-- without another migration, so we match the DB constraint rather than the
-- current FE behaviour.

update storage.buckets
   set file_size_limit     = 8 * 1024 * 1024,
       allowed_mime_types  = array['image/jpeg', 'image/png', 'image/heic']
 where id = 'post-images';

-- Confirm the row actually exists (defensive — bucket should have been
-- inserted by 0002, but a fresh project that ran migrations out-of-order
-- would benefit from a clear failure here).
do $$
declare
  v_found boolean;
begin
  select exists (select 1 from storage.buckets where id = 'post-images')
    into v_found;
  if not v_found then
    raise exception '0150_post_images_bucket_cap: storage.buckets row for "post-images" not found — did 0002 run?';
  end if;
end $$;

-- Skip a column-level COMMENT here — storage.buckets.allowed_mime_types is a
-- shared system column, not a per-bucket field, so a comment would describe
-- post-images for every bucket. The header above plus this migration's
-- filename carries the per-bucket intent.
