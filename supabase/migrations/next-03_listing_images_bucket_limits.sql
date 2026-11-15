-- Platform · size and type limits on the legacy `listing-images` bucket
--
-- `listing-images` predates the baseline: the baseline does not create it, but databases
-- that were in use before the cut-over still have it and the app still reads its existing
-- objects (older post media). New uploads go to `post-images`. Like every bucket the
-- baseline creates, it gets an upload size cap and an image-only type list, the same as
-- `post-images` plus WebP. Existing objects are unaffected (limits apply to new uploads).
-- Where the bucket does not exist (a fresh database) this changes nothing.

do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is null then
    return;
  end if;
  update storage.buckets
     set file_size_limit = 8388608,
         allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
   where id = 'listing-images'
     and (file_size_limit is distinct from 8388608
          or allowed_mime_types is distinct from array['image/jpeg', 'image/png', 'image/webp']);
end $$;
