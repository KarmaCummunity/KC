-- 0683_fsm_post_handoff_writers — wave 1b-ii of docs/architecture/state-machines.md (#1989):
-- the handoff writers that close a post follow the post graph.
--
-- 1. `mark_giving_handed_over` is the "handed over" step of the four worlds whose screen
--    offers it (items, food, knowledge, animals; mobile `HANDOFF_WORLDS`). Rides, housing and
--    events close through their own RPCs (`complete_ride_trip`, `complete_housing_booking`,
--    `mark_event_attendance`), which carry their own windows and caps; this RPC now refuses
--    their handoffs instead of closing the whole post on the first one.
--    It closes the post only from `open`; before, an expired or removed post made the graph
--    refuse and rolled back the handoff itself. A post hidden for review stays hidden until a
--    moderator decides (closing it would make it visible again). The duplicate write through
--    the `listings` view (a view over `posts` since 0667) is gone: the post is the record.
-- 2. `post_close_from_handoff` (the items closing, G34) drops the same view write, which
--    moved the post a second time through the view's trigger without a status check.
-- 3. The two-argument `owner_complete_offer_with_user(uuid, uuid)` added by 0666 duplicated
--    the live three-argument RPC (0658, FR-CLOSURE-011) with older rules, and the app never
--    calls it. It is dropped so one RPC owns the owner-assigns-a-recipient move.

begin;

-- ── 1. mark_giving_handed_over ────────────────────────────────────────────────
create or replace function public.mark_giving_handed_over(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_h public.post_handoffs;
  v_row public.giving_handoffs;
begin
  -- The worlds this step belongs to; the others complete through their own RPCs.
  if exists (
    select 1 from public.post_handoffs
     where handoff_id = p_handoff_id
       and world_slug not in ('items', 'food', 'knowledge', 'animals')
  ) then
    raise exception 'handoff_world_not_supported' using errcode = '23514';
  end if;

  update public.post_handoffs
     set status = 'handed_over', handed_over_at = now()
   where handoff_id = p_handoff_id
     and status = 'confirmed'
     and (owner_id = auth.uid() or recipient_id = auth.uid())
  returning * into v_h;
  if not found then raise exception 'handoff_not_confirmed' using errcode = '23514'; end if;

  if v_h.world_slug = 'items'
     and exists (select 1 from public.posts p where p.post_id = v_h.post_id and p.listing_id is null) then
    -- One closing system (G34): the post closure pays giver 20 + value bonus / receiver 15 once.
    perform public.post_close_from_handoff(v_h);
  else
    -- Close a live post only; an expired, removed or under-review post keeps its status and
    -- the handoff still completes.
    update public.posts
       set status = 'closed_delivered', availability_status = 'ongoing', updated_at = now()
     where post_id = v_h.post_id
       and status = 'open';
    perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, p_handoff_id);
  end if;

  v_row := public.giving_handoff_row_of(p_handoff_id);
  return v_row;
end;
$$;

comment on function public.mark_giving_handed_over(uuid) is
  'Handed-over step for items, food, knowledge and animals handoffs (0683). Closes the post only from open.';

revoke all on function public.mark_giving_handed_over(uuid) from public, anon;
grant execute on function public.mark_giving_handed_over(uuid) to authenticated, service_role;

-- ── 2. post_close_from_handoff: the post only ─────────────────────────────────
create or replace function public.post_close_from_handoff(p_h public.post_handoffs)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The hand-over notice (0528) already told the recipient; skip the 0063 "marked" notice.
  perform set_config('kc.closing_from_handoff', 'on', true);
  insert into public.recipients (post_id, recipient_user_id)
  values (p_h.post_id, p_h.recipient_id)
  on conflict (post_id) do update
    set recipient_user_id = excluded.recipient_user_id, marked_at = now();
  perform set_config('kc.closing_from_handoff', '', true);

  -- Close a live post only (same rule as mark_giving_handed_over).
  update public.posts
     set status = 'closed_delivered', delete_after = null, availability_status = 'ongoing', updated_at = now()
   where post_id = p_h.post_id
     and status = 'open';
end;
$$;

-- ── 3. One owner-assigns-a-recipient RPC ──────────────────────────────────────
drop function if exists public.owner_complete_offer_with_user(uuid, uuid);

commit;
