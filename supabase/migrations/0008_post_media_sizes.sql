-- Social · post media carry their recorded type and size (FR-POST-005, D127)
--
-- The app records each uploaded photo with its real MIME type and size, so the post_media
-- type and 8 MB checks see the real file. A republish attaches the source's photos again
-- and needs both, so the JSON form of a media row returns them too. The signature and the
-- grant stay those of the baseline.

-- What a client needs to fetch and lay out one file, and to attach it again to a new post
-- (republish): its type and size as recorded at upload.
create or replace function kc_access.post_media_json(p_media public.post_media)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_media.id, 'kind', p_media.kind, 'storage_bucket', p_media.storage_bucket,
    'storage_key', p_media.storage_key, 'mime_type', p_media.mime_type, 'size_bytes', p_media.size_bytes,
    'width', p_media.width, 'height', p_media.height,
    'duration_ms', p_media.duration_ms, 'blurhash', p_media.blurhash);
$$;
comment on function kc_access.post_media_json(public.post_media) is 'JSON form of a media row inside a card or a detail payload.';
