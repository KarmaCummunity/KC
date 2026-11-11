-- 0055_chat_mark_read_delivered_at_backfill | FR-CHAT-011 follow-up.
-- The 0054 migration as originally shipped to supabase-prod did not back-fill
-- `delivered_at` on legacy `kind='system'` rows that were inserted with
-- `status='delivered'` but `delivered_at IS NULL`. The
-- `messages_timestamps_monotonic` CHECK constraint requires
-- `delivered_at IS NOT NULL` whenever `read_at IS NOT NULL`, so any
-- `rpc_chat_mark_read` call against a chat that contains such a row would
-- error in production. The local 0054 file was updated to perform the
-- back-fill and to harden the RPC body with a `coalesce(delivered_at, now())`,
-- but that updated content cannot propagate to remotes that already recorded
-- 0054. This migration is the additive idempotent patch for those remotes.
-- Safe to re-apply: every operation here is no-op when already in place.

-- ── 1. Legacy back-fill ────────────────────────────────────────────────────
update public.messages
   set delivered_at = created_at
 where delivered_at is null
   and (status = 'delivered' or status = 'read');

-- ── 2. RPC re-definition (idempotent — same body as 0054 local) ────────────
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

-- end of 0055_chat_mark_read_delivered_at_backfill
