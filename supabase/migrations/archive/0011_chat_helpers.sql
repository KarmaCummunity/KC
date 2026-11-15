-- 0011_chat_helpers | P0.5 — RPCs for read receipts, unread totals, support thread.
-- FR-CHAT-007, FR-CHAT-011, FR-CHAT-012.

-- ── 1. Bulk mark-read (FR-CHAT-011 AC2) ────────────────────────────────────
-- Single round-trip; the existing messages_update_status_recipient policy
-- and messages_on_status_change trigger handle authorization + timestamps.
create or replace function public.rpc_chat_mark_read(p_chat_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.messages
  set status = 'read'
  where chat_id = p_chat_id
    and sender_id <> auth.uid()
    and status <> 'read';
$$;

grant execute on function public.rpc_chat_mark_read(uuid) to authenticated;

-- ── 2. Unread total across visible chats (FR-CHAT-012) ─────────────────────
create or replace function public.rpc_chat_unread_total()
returns bigint
language sql
security invoker
stable
set search_path = public
as $$
  select count(*)::bigint
  from public.messages m
  join public.chats c on c.chat_id = m.chat_id
  where auth.uid() in (c.participant_a, c.participant_b)
    and m.sender_id is distinct from auth.uid()
    and m.status <> 'read'
    and public.is_chat_visible_to(c, auth.uid());
$$;

grant execute on function public.rpc_chat_unread_total() to authenticated;

-- ── 3. Get-or-create support thread (FR-CHAT-007) ──────────────────────────
-- SECURITY DEFINER so the caller can locate the super-admin user_id even
-- though their RLS doesn't grant SELECT on that row through normal policies.
create or replace function public.rpc_get_or_create_support_thread()
returns public.chats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_viewer   uuid := auth.uid();
  v_a        uuid;
  v_b        uuid;
  v_chat     public.chats;
begin
  if v_viewer is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select user_id into v_admin_id
  from public.users
  where is_super_admin = true
  limit 1;

  if v_admin_id is null then
    raise exception 'super_admin_not_found' using errcode = 'P0001';
  end if;

  if v_admin_id = v_viewer then
    raise exception 'super_admin_self_thread_forbidden' using errcode = 'P0001';
  end if;

  -- Canonical pair ordering matches chats_canonicalize_participants.
  if v_viewer < v_admin_id then v_a := v_viewer; v_b := v_admin_id;
  else v_a := v_admin_id; v_b := v_viewer; end if;

  select * into v_chat
  from public.chats
  where participant_a = v_a and participant_b = v_b;

  if found then return v_chat; end if;

  insert into public.chats (participant_a, participant_b, is_support_thread)
  values (v_a, v_b, true)
  returning * into v_chat;

  return v_chat;
end;
$$;

grant execute on function public.rpc_get_or_create_support_thread() to authenticated;
