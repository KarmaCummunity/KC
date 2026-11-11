-- 0258_chat_v2_rpcs | KC#873 — cursor resync + reactions + media send RPC.

set search_path = public;

create or replace function public.rpc_sync_chat_messages(
  p_chat_id uuid,
  p_after_created_at timestamptz default null,
  p_after_message_id uuid default null,
  p_limit integer default 50
)
returns setof public.messages
language sql
stable
security invoker
set search_path = public
as $$
  select m.*
    from public.messages m
    join public.chats c on c.chat_id = m.chat_id
   where m.chat_id = p_chat_id
     and public.is_chat_visible_to(c.*, (select auth.uid()))
     and (
       p_after_created_at is null
       or (m.created_at, m.message_id) > (
         p_after_created_at,
         coalesce(p_after_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
       )
     )
   order by m.created_at asc, m.message_id asc
   limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

grant execute on function public.rpc_sync_chat_messages(uuid, timestamptz, uuid, integer) to authenticated;

create or replace function public.rpc_set_message_reaction(
  p_message_id uuid,
  p_reaction_type text
)
returns public.message_reactions
language plpgsql
security invoker
set search_path = public
as $$
declare v_row public.message_reactions;
begin
  if not public.is_active_member((select auth.uid())) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;

  if p_reaction_type is null then
    delete from public.message_reactions
     where message_id = p_message_id and user_id = (select auth.uid());
    return null;
  end if;

  if p_reaction_type not in ('like', 'love', 'laugh', 'sad') then
    raise exception 'invalid_reaction_type' using errcode = '22023';
  end if;

  insert into public.message_reactions (message_id, user_id, reaction_type)
  values (p_message_id, (select auth.uid()), p_reaction_type)
  on conflict (message_id, user_id) do update
    set reaction_type = excluded.reaction_type
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.rpc_set_message_reaction(uuid, text) to authenticated;

create or replace function public.rpc_send_chat_media_message(
  p_chat_id uuid,
  p_media_payload jsonb,
  p_body text default null
)
returns public.messages
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_chat public.chats;
  v_row public.messages;
begin
  if not public.is_active_member((select auth.uid())) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;

  select * into v_chat from public.chats where chat_id = p_chat_id;
  if v_chat.chat_id is null or not public.is_chat_visible_to(v_chat.*, (select auth.uid())) then
    raise exception 'chat_not_visible' using errcode = 'P0001';
  end if;

  if p_media_payload is null
     or (p_media_payload ->> 'type') not in ('image', 'video', 'voice', 'location', 'post_share') then
    raise exception 'invalid_media_payload' using errcode = '22023';
  end if;

  insert into public.messages (chat_id, sender_id, kind, body, media_payload, status)
  values (
    p_chat_id,
    (select auth.uid()),
    'media',
    coalesce(nullif(trim(p_body), ''), ' '),
    p_media_payload,
    'pending'
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.rpc_send_chat_media_message(uuid, jsonb, text) to authenticated;
