-- 0149_recipient_unmark_no_owner_decrement | TD-71 — FR-CLOSURE-007 / FR-CLOSURE-005
--
-- Bug:
--   rpc_recipient_unmark_self (0075) manually decremented the owner's
--   items_given / items_received counter when transitioning a Give/Request
--   post from `closed_delivered` → `deleted_no_recipient`. Combined with
--   posts_after_change_counters firing on the next reopen
--   (deleted_no_recipient → open), the same counter was decremented twice
--   → owner counters drifted to -1 of the correct value until the nightly
--   recompute (0045) repaired them.
--
-- Why the manual decrement was wrong (confirmed by the recompute formula in
-- 0045_stats_recompute_nightly):
--   items_given (owner)    = COUNT(Give posts in {closed_delivered,
--                                  deleted_no_recipient}) ∪ recipient-of-Request.
--   items_received (owner) = COUNT(Request posts in {closed_delivered,
--                                  deleted_no_recipient}) ∪ recipient-of-Give.
--   A status flip from `closed_delivered` → `deleted_no_recipient` keeps the
--   post inside the counted set, so the owner counter MUST stay where it is.
--   The eventual `reopen_post_deleted_no_recipient` (single source of
--   truth — its UPDATE re-triggers posts_after_change_counters, which
--   already decrements correctly) handles the deduction.
--
-- Fix:
--   Recreate `rpc_recipient_unmark_self` without the manual owner-counter
--   decrement. Everything else (recipient row delete trigger, notification,
--   status flip, audit row) stays unchanged.
--
-- Historical drift on the dev/prod DB is auto-healed by the nightly
-- stats_recompute cron (0045). No explicit backfill is needed here.

set search_path = public;

create or replace function public.rpc_recipient_unmark_self(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid    := auth.uid();
  v_owner_id uuid;
  v_post_type text;
begin
  if v_caller is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Verify caller is the active recipient and post is closed_delivered.
  select p.owner_id, p.type
    into v_owner_id, v_post_type
    from public.posts p
    join public.recipients r on r.post_id = p.post_id
   where p.post_id   = p_post_id
     and p.status    = 'closed_delivered'
     and r.recipient_user_id = v_caller;

  if not found then
    raise exception 'not_recipient_or_wrong_status' using errcode = 'P0001';
  end if;

  -- Delete recipient row (triggers fire: items_received -1 + notification to owner).
  delete from public.recipients
   where post_id = p_post_id
     and recipient_user_id = v_caller;

  -- Note: owner counter is intentionally NOT decremented here (TD-71). The
  -- post remains inside the closed/deleted-no-recipient set, so the owner's
  -- items_given (Give) or items_received (Request) credit must stay. The
  -- counter is decremented when the owner reopens
  -- (reopen_post_deleted_no_recipient → posts_after_change_counters fires).

  -- Transition post to deleted_no_recipient, give owner 7 days to reopen/re-mark.
  update public.posts
     set status       = 'deleted_no_recipient',
         delete_after = now() + interval '7 days'
   where post_id = p_post_id;

  -- Audit trail.
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    v_caller,
    'unmark_recipient_self',
    'post',
    p_post_id,
    jsonb_build_object('owner_id', v_owner_id, 'post_type', v_post_type)
  );
end $$;

revoke execute on function public.rpc_recipient_unmark_self(uuid) from public;
grant  execute on function public.rpc_recipient_unmark_self(uuid) to authenticated;

comment on function public.rpc_recipient_unmark_self(uuid) is
  'FR-CLOSURE-007: recipient self-removes the credit on a closed_delivered post. Owner counter intentionally unchanged at this step (TD-71); reopen handles the eventual decrement.';
