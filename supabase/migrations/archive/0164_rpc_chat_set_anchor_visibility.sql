-- 0164_rpc_chat_set_anchor_visibility | H-SOC-03
--
-- Reject anchoring a chat to a post the caller cannot see.

create or replace function public.rpc_chat_set_anchor(
  p_chat_id uuid,
  p_anchor_post_id uuid
)
returns public.chats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.chats;
  v_post public.posts;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.chats
  where chat_id = p_chat_id;

  if v_row.chat_id is null then
    raise exception 'chat_not_found' using errcode = 'P0001';
  end if;

  if v_row.participant_a <> v_uid and v_row.participant_b <> v_uid then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;

  select * into v_post
  from public.posts
  where post_id = p_anchor_post_id;

  if v_post.post_id is null then
    raise exception 'post_not_found' using errcode = 'P0001';
  end if;

  if not public.is_post_visible_to(v_post, v_uid) then
    raise exception 'post_not_visible' using errcode = 'P0001';
  end if;

  if v_row.anchor_post_id is not distinct from p_anchor_post_id then
    return v_row;
  end if;

  update public.chats
     set anchor_post_id = p_anchor_post_id
   where chat_id = p_chat_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.rpc_chat_set_anchor(uuid, uuid) is
  'Participant-only anchor update; validates post visibility via is_post_visible_to (0164). FR-CHAT-014, H-SOC-03.';

grant execute on function public.rpc_chat_set_anchor(uuid, uuid) to authenticated;
