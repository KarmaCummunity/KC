-- 0027_rpc_chat_set_anchor | P1.2.x — FR-CHAT-014 ext.
--
-- Adapter-callable RPC to update chats.anchor_post_id. The chats table has no
-- client UPDATE grant (see 0004 §12 + grants block) and no client UPDATE RLS
-- policy — anchor changes therefore have to go through a SECURITY DEFINER
-- function that authorizes the caller as a participant.
--
-- This pairs with the SupabaseChatRepository.findOrCreateChat re-anchor path
-- shipped in P1.2.x: that path was attempting a direct UPDATE which silently
-- failed (missing grant), so the AnchoredPostCard never reflected the new
-- anchor on chat reuse. With this RPC the adapter can re-anchor successfully.

set search_path = public;

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
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  -- Caller must be a participant of the chat. We read the row directly (not
  -- through RLS) since SECURITY DEFINER bypasses it; the participant check
  -- below is the real gate.
  select * into v_row
  from public.chats
  where chat_id = p_chat_id;

  if v_row.chat_id is null then
    raise exception 'chat_not_found' using errcode = 'P0001';
  end if;

  if v_row.participant_a <> v_uid and v_row.participant_b <> v_uid then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;

  -- No-op when already at the requested anchor (cheap idempotency, also
  -- avoids a spurious realtime UPDATE event going to both clients).
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

grant execute on function public.rpc_chat_set_anchor(uuid, uuid) to authenticated;

-- end of 0027_rpc_chat_set_anchor
