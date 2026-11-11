-- 0054_chat_mark_read_includes_system | FR-CHAT-011, FR-CHAT-012.
-- Fixes the asymmetry between rpc_chat_mark_read (uses `<>`, runs as INVOKER,
-- blocked by the `kind = 'user'` RLS column policy) and rpc_chat_unread_total
-- (uses `IS DISTINCT FROM`, counts system messages with `sender_id IS NULL`).
-- Without this fix, opening a chat that contains a system message could not
-- clear the unread badge — the local optimistic clear would be overwritten by
-- the next debounced unread-total RPC.
-- Design: docs/superpowers/specs/2026-05-13-chat-mark-read-system-messages-design.md

-- ── 0. Pre-fix legacy data inconsistency ────────────────────────────────────
-- Some system messages were inserted with `status='delivered'` but
-- `delivered_at IS NULL` (older trigger code paths). The
-- `messages_timestamps_monotonic` CHECK constraint requires
-- `delivered_at IS NOT NULL` whenever `read_at IS NOT NULL`, so any subsequent
-- mark-read on those rows would error. Backfill `delivered_at` from
-- `created_at` (monotonic by construction) before touching status.
update public.messages
   set delivered_at = created_at
 where delivered_at is null
   and (status = 'delivered' or status = 'read');

-- ── 1. Replace the RPC: DEFINER + IS DISTINCT FROM + participant guard ──────
-- `IS DISTINCT FROM` includes system messages (sender_id IS NULL).
-- `coalesce(delivered_at, now())` is defensive — keeps the monotonic CHECK
-- happy for any row that slipped through the §0 backfill (e.g. inserted
-- between this migration and a future trigger fix).
create or replace function public.rpc_chat_mark_read(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Caller must be a participant of the target chat. SECURITY DEFINER bypasses
  -- RLS, so this explicit check replaces the implicit policy filter.
  if not exists (
    select 1 from public.chats
     where chat_id = p_chat_id
       and v_uid in (participant_a, participant_b)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.messages
     set status = 'read',
         delivered_at = coalesce(delivered_at, now())
   where chat_id = p_chat_id
     and sender_id is distinct from v_uid
     and status <> 'read';
end;
$$;

grant execute on function public.rpc_chat_mark_read(uuid) to authenticated;

-- ── 2. One-time cleanup for chats the user has already engaged with ─────────
-- Conservative scope: only flip system messages in chats where every user
-- message is already `read`. Leaves chats with active user-message unreads
-- alone — the next time the user opens those chats, the fixed RPC handles them.
update public.messages target
   set status = 'read'
  from public.chats c
 where target.chat_id = c.chat_id
   and target.kind = 'system'
   and target.status <> 'read'
   and not exists (
     select 1 from public.messages m2
      where m2.chat_id = c.chat_id
        and m2.kind = 'user'
        and m2.status <> 'read'
   );

-- end of 0054_chat_mark_read_includes_system
