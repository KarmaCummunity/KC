-- 0521_chat_media_private | #1064 private storage for chat media (ADR-002 §3)
--
-- Chat images are served only to people who can see the chat: the `chat-media`
-- bucket stops being public, and an object is readable when its path names a chat
-- that `is_chat_visible_to` the caller, the same predicate that gates the chat's
-- messages (`messages_select_visible`). The app renders chat images through
-- short-lived signed URLs built from `media_payload.path`.
--
-- Object paths: `<user_id>/<chat_id>/<file>` (since 0440) and, for images uploaded
-- before 0440, `<chat_id>/<user_id>/<file>`. Both folder positions are matched; a
-- user id never equals a chat id, so the extra position grants nothing else.
-- The uploader keeps reading their own objects through `chat_media_select_own` (0445).

begin;

update storage.buckets set public = false where id = 'chat-media';

-- The chat id named by the object's path, or null when that folder is not a uuid.
-- CASE guarantees the regex runs before the cast, so a malformed path never errors.
create or replace function public.chat_media_path_chat_ids(p_name text)
returns uuid[]
language sql
immutable
set search_path = public
as $$
  select array(
    select case when f ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then f::uuid end
      from unnest((string_to_array(p_name, '/'))[1:2]) as f);
$$;

comment on function public.chat_media_path_chat_ids(text) is
  'Candidate chat ids in a chat-media object path (first two folders, uuid-shaped only). Used by the chat_media_select_chat_visible storage policy.';

grant execute on function public.chat_media_path_chat_ids(text) to authenticated;

drop policy if exists chat_media_select_chat_visible on storage.objects;
create policy chat_media_select_chat_visible on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and exists (
      select 1
        from public.chats c
       where c.chat_id = any (public.chat_media_path_chat_ids(name))
         and public.is_chat_visible_to(c.*, (select auth.uid()))
    )
  );

commit;
