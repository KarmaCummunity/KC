-- WhatsApp bot · a photo sent in the chat completes a bot draft (M22 / L7, D158 as approved)
--
-- An offer the bot drafts in a photo world (D132) waits for its photo. The member may now send
-- that photo in the WhatsApp chat instead of opening the app: the webhook downloads it from the
-- Graph API, checks it against the post photo limits (JPEG or PNG, at most 8 MB, as the
-- `post-images` bucket and post_media_image_chk), uploads it under the owner's folder with the
-- service role, and calls api_bot_attach_post_photo. The photo is registered exactly as the
-- app's attach path writes it (a `pending` post_media row in `post-images`), and the post is
-- published again through the gates of api_bot_publish_post: below 0.85 confidence it stays a
-- draft in staff review; the photo rule (D132) and the open-post limit hold; and photos sent
-- through the bot have their own rate limit (the post itself was counted when it was drafted).
--
--   api_bot_pending_photo_draft(p_wa_id, p_owner_id)
--       the bot draft a photo sent now would go to, or null: the newest session of that number
--       from the last 24 hours whose post is still the owner's draft with room for a photo.
--       The webhook asks first, so an image with no draft waiting is never downloaded or stored.
--   api_bot_attach_post_photo(p_wa_id, p_owner_id, p_session_id, p_storage_path, p_mime_type,
--                             p_size_bytes, p_width, p_height)
--       {post_id, media_id, world_slug, status, review, photo_required}
--
-- Errors (P0001 unless noted): wa_id_required, user_id_required, account_not_active,
-- session_not_found, not_bot_draft, invalid_media_type, invalid_media_size,
-- invalid_storage_path, too_many_photos, rate_limited, offer_photo_required,
-- post_limit_exceeded; owner_mismatch is 42501.

insert into kc_private.rate_limits (action, max_count, "window", description) values
  ('whatsapp_post_photo', 20, interval '1 hour',
   'Photos a member attaches to bot drafts from WhatsApp. Enforced in public.api_bot_attach_post_photo.');

-- The number's identity when it is linked to p_owner_id; raises owner_mismatch otherwise.
create function kc_private.whatsapp_owner_identity(p_wa_id text, p_owner_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_identity uuid;
begin
  if p_wa_id is null or btrim(p_wa_id) = '' then
    raise exception 'wa_id_required' using errcode = 'P0001';
  end if;
  perform kc_private.whatsapp_require_active_user(p_owner_id);
  select i.id into v_identity from integrations.whatsapp_identities i
   where i.wa_id = p_wa_id and i.user_id = p_owner_id;
  if v_identity is null then
    raise exception 'owner_mismatch' using errcode = '42501';
  end if;
  return v_identity;
end;
$$;
comment on function kc_private.whatsapp_owner_identity(text, uuid) is
  'The identity of a number linked to the member; raises owner_mismatch (42501) otherwise.';

-- The bot draft a photo from this number would complete: {session_id, post_id, world_slug,
-- direction, photos}, or null when none is waiting.
create function public.api_bot_pending_photo_draft(p_wa_id text, p_owner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_identity constant uuid := kc_private.whatsapp_owner_identity(p_wa_id, p_owner_id);
begin
  return (
    select jsonb_build_object('session_id', s.id, 'post_id', p.id, 'world_slug', p.world_slug,
                              'direction', p.direction,
                              'photos', (select count(*) from public.post_media m where m.post_id = p.id))
      from integrations.bot_conversation_sessions s
      join integrations.bot_post_origins o on o.session_id = s.id
      join public.posts p on p.id = o.post_id
     where s.identity_id = v_identity
       and s.state = 'published'
       and s.created_at > now() - interval '24 hours'
       and p.owner_id = p_owner_id
       and p.status = 'draft'
       and (select count(*) from public.post_media m where m.post_id = p.id) < 5
     order by s.created_at desc, s.id desc
     limit 1);
end;
$$;
comment on function public.api_bot_pending_photo_draft(text, uuid) is
  'Webhook: the member''s bot draft (last 24 hours) a photo sent now would go to, or null.';

-- Registers an uploaded photo on the session's draft and publishes the post when the gates
-- of api_bot_publish_post allow it. See the header for the result and the errors.
create function public.api_bot_attach_post_photo(
  p_wa_id text, p_owner_id uuid, p_session_id uuid, p_storage_path text, p_mime_type text,
  p_size_bytes bigint, p_width integer default null, p_height integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity constant uuid := kc_private.whatsapp_owner_identity(p_wa_id, p_owner_id);
  v_limit kc_private.rate_limits;
  v_session integrations.bot_conversation_sessions;
  v_post public.posts;
  v_ordinal integer;
  v_media_id uuid;
  v_review boolean;
begin
  select s.* into v_session from integrations.bot_conversation_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_session.identity_id <> v_identity then
    raise exception 'owner_mismatch' using errcode = '42501';
  end if;
  select p.* into v_post from public.posts p
   where p.id = v_session.post_id and p.owner_id = p_owner_id and p.status = 'draft'
     and exists (select 1 from integrations.bot_post_origins o where o.post_id = p.id and o.session_id = p_session_id)
     for update;
  if not found then
    raise exception 'not_bot_draft' using errcode = 'P0001';
  end if;
  if p_mime_type is null or p_mime_type not in ('image/jpeg', 'image/png') then
    raise exception 'invalid_media_type' using errcode = 'P0001';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 8388608 then
    raise exception 'invalid_media_size' using errcode = 'P0001';
  end if;
  if p_storage_path is null or not starts_with(p_storage_path, p_owner_id::text || '/')
     or char_length(p_storage_path) > 512 or position('..' in p_storage_path) > 0 then
    raise exception 'invalid_storage_path' using errcode = 'P0001';
  end if;
  select coalesce(max(m.ordinal) + 1, 0) into v_ordinal from public.post_media m where m.post_id = v_post.id;
  if v_ordinal > 4 then
    raise exception 'too_many_photos' using errcode = 'P0001';
  end if;
  select l.* into v_limit from kc_private.rate_limits l where l.action = 'whatsapp_post_photo';
  if found and not kc_private.rate_limit('whatsapp_post_photo:' || p_owner_id, v_limit.max_count, v_limit."window") then
    raise exception 'rate_limited' using errcode = 'P0001', detail = 'whatsapp_post_photo';
  end if;

  -- The row the app writes for an uploaded photo (postMediaWrites.ts): pending until processed.
  insert into public.post_media (post_id, owner_id, kind, storage_bucket, storage_key, ordinal, mime_type,
                                 size_bytes, width, height)
  values (v_post.id, p_owner_id, 'image', 'post-images', p_storage_path, v_ordinal, p_mime_type, p_size_bytes,
          nullif(p_width, 0), nullif(p_height, 0))
  returning id into v_media_id;

  -- The gates of api_bot_publish_post: an unsure extraction waits for staff, a photo world
  -- needs its photo (it has one now), and the open-post limit holds (posts_apply_status_rules).
  v_review := coalesce(v_session.confidence, 1) < 0.85;
  if not v_review then
    perform kc_private.post_require_offer_photo(v_post.id);
    perform kc_private.post_move(v_post.id, 'open', 'owner');
  end if;
  return jsonb_build_object('post_id', v_post.id, 'media_id', v_media_id, 'world_slug', v_post.world_slug,
                            'status', case when v_review then 'draft' else 'open' end,
                            'review', v_review, 'photo_required', false);
end;
$$;
comment on function public.api_bot_attach_post_photo(text, uuid, uuid, text, text, bigint, integer, integer) is
  'Webhook: registers a WhatsApp photo on the member''s bot draft and publishes it when the bot gates allow.';
