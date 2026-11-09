-- 0681_fsm_post_s1 — wave 1 of docs/architecture/state-machines.md: the post lifecycle S1
-- (spec 07 §7.1, D104) moves onto the FSM kernel (0680).
--
-- 1. Catalog rows for machine `post`, equal to `postMachine` in @kc/domain (the contract
--    test replays them).
-- 2. `posts_enforce_status_fsm` asks `fsm_assert_transition` instead of its hard-coded
--    `case` list (0665). The owner guards that read other rows stay here, before the
--    kernel call, unchanged. Clients keep the same error codes.
-- 3. Graph change ({{D:expired-post-republish}}): `expired → open` is gone. An expired
--    post comes back only as a new post (republish); no writer performed this move.

begin;

-- ── 1. Catalog: machine `post` ────────────────────────────────────────────────
insert into public.fsm_state (machine_id, status) values
  ('post', 'open'),
  ('post', 'closed_delivered'),
  ('post', 'deleted_no_recipient'),
  ('post', 'expired'),
  ('post', 'removed_admin'),
  ('post', 'hidden_pending_review'),
  ('post', 'paused');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('post', 'open', 'paused', ''),
  ('post', 'open', 'closed_delivered', ''),
  ('post', 'open', 'deleted_no_recipient', ''),
  ('post', 'open', 'expired', ''),
  ('post', 'open', 'removed_admin', ''),
  ('post', 'open', 'hidden_pending_review', ''),
  ('post', 'paused', 'open', ''),
  ('post', 'paused', 'deleted_no_recipient', ''),
  ('post', 'paused', 'expired', ''),
  ('post', 'paused', 'removed_admin', ''),
  ('post', 'paused', 'hidden_pending_review', ''),
  ('post', 'closed_delivered', 'open', ''),
  ('post', 'closed_delivered', 'deleted_no_recipient', ''),
  ('post', 'closed_delivered', 'removed_admin', ''),
  ('post', 'closed_delivered', 'hidden_pending_review', ''),
  ('post', 'expired', 'deleted_no_recipient', ''),
  ('post', 'expired', 'removed_admin', ''),
  ('post', 'expired', 'hidden_pending_review', ''),
  ('post', 'hidden_pending_review', 'open', ''),
  ('post', 'hidden_pending_review', 'closed_delivered', ''),
  ('post', 'hidden_pending_review', 'deleted_no_recipient', ''),
  ('post', 'hidden_pending_review', 'removed_admin', ''),
  ('post', 'deleted_no_recipient', 'open', ''),
  ('post', 'deleted_no_recipient', 'removed_admin', ''),
  ('post', 'removed_admin', 'open', '');

-- ── 2. posts_status_fsm trigger on the kernel ─────────────────────────────────
create or replace function public.posts_enforce_status_fsm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text := old.status;
  v_to   text := new.status;
begin
  -- Same status: not a transition; nothing to check.
  if v_from is not distinct from v_to then
    return new;
  end if;

  -- The graph: one catalog, shared with @kc/domain. Kernel codes map back to the code
  -- clients already handle (23514 posts_status_transition_invalid).
  begin
    perform public.fsm_assert_transition('post', v_from, v_to, null);
  exception
    when sqlstate 'P0001' then
      if sqlerrm in ('illegal_transition', 'unknown_state') then
        raise exception 'posts_status_transition_invalid'
          using errcode = '23514',
                detail = format('invalid status transition from %s to %s', v_from, v_to);
      end if;
      raise;
  end;

  -- Owner guards per spec 07 §7.1 and D104 (unchanged from 0665). They read other rows,
  -- so they stay beside the kernel call rather than in the graph.
  -- 1. Resuming a paused post whose expiry has passed is refused.
  if v_from = 'paused' and v_to = 'open'
     and new.expires_at is not null and new.expires_at <= now() then
    raise exception 'listing_expired'
      using errcode = '23514', detail = 'cannot resume an expired post';
  end if;

  -- 2. Pausing, or deleting a live post, while a reservation / booking is active is
  --    refused. Event registrations (`time`) do not block (0665).
  if (v_to = 'paused' or (v_to = 'deleted_no_recipient' and v_from in ('open', 'paused')))
     and exists (
       select 1 from public.post_handoffs h
        where h.post_id = new.post_id
          and h.world_slug <> 'time'
          and h.status in ('reserved', 'confirmed')
     ) then
    raise exception 'listing_has_active_handoff'
      using errcode = '23514',
            detail = case when v_to = 'paused'
                          then 'cannot pause a post with an active handoff'
                          else 'cannot delete a post with an active handoff' end;
  end if;

  return new;
end;
$$;

comment on function public.posts_enforce_status_fsm() is
  'FSM kernel wave 1 (0681): posts.status moves follow machine `post` in fsm_edge (spec 07 §7.1, D104); owner guards for expiry and active handoffs run after the graph check.';

revoke all on function public.posts_enforce_status_fsm() from public, anon, authenticated;
grant execute on function public.posts_enforce_status_fsm() to service_role;

-- The 0665 trigger (`before update of status on public.posts`) already calls this
-- function by name; it is not recreated.

commit;
