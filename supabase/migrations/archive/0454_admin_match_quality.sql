-- 0454_admin_match_quality | KC#1122, FR-ADMIN-029, spec §7.3 / MATCHING_V2 "Quality".
-- Per-world match quality for the team (super admin + moderator), over the last p_days:
--   notified_pairs   pairs where at least one side was really alerted (opted-out sides, 0460,
--                    do not count) and whose first alert falls in the window
--   responses        accept/decline answers on those pairs (one per side at most)
--   precision_proxy  accepted / responses — how often an alerted user liked the suggestion
--   chat_rate        share of notified pairs whose two owners exchanged a user message after
--                    the first alert
--   completion_rate  share of notified pairs that ended in a handed-over giving handoff between
--                    the two owners on either listing of the pair. Tracked for the worlds that
--                    hand off through giving_handoffs (items, food, rides, knowledge — 0380/0390);
--                    null for the others.
-- Rates are null when their denominator is 0. Read-only; no schema change.

begin;

create or replace function public.admin_match_quality(p_days integer default 30)
returns table (
  world_slug       text,
  world_label_he   text,
  world_label_en   text,
  notified_pairs   integer,
  responses        integer,
  accepted         integer,
  precision_proxy  numeric,
  chat_pairs       integer,
  chat_rate        numeric,
  completed_pairs  integer,
  completion_rate  numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  -- Clamp the window to 1..365 days so a bad argument cannot scan unbounded history.
  v_days  integer := least(greatest(coalesce(p_days, 30), 1), 365);
  -- Mirrors giving_handoffs_world_slug_check (0390).
  v_handoff_worlds constant text[] := array['items', 'food', 'rides', 'knowledge'];
begin
  perform public.admin_assert_role(v_actor, array['super_admin', 'moderator']);

  return query
  with alerted as (
    -- First real alert per pair; LEAST ignores the null (not alerted / opted-out) side.
    select m.*,
           least(
             case when (m.delivery #>> '{offer,opted_out}') is distinct from 'true' then m.notified_offer_at end,
             case when (m.delivery #>> '{request,opted_out}') is distinct from 'true' then m.notified_request_at end
           ) as first_alert_at
      from public.match_candidates m
  ),
  pairs as (
    select a.*,
           exists (
             select 1
               from public.chats c
               join public.messages msg on msg.chat_id = c.chat_id
              where ((c.participant_a = a.offer_owner_id and c.participant_b = a.request_owner_id)
                  or (c.participant_a = a.request_owner_id and c.participant_b = a.offer_owner_id))
                and msg.kind = 'user'
                and msg.created_at >= a.first_alert_at
           ) as chatted,
           exists (
             select 1
               from public.giving_handoffs h
              where h.listing_id in (a.offer_listing_id, a.request_listing_id)
                and ((h.owner_id = a.offer_owner_id and h.recipient_id = a.request_owner_id)
                  or (h.owner_id = a.request_owner_id and h.recipient_id = a.offer_owner_id))
                and h.status = 'handed_over'
                and h.handed_over_at >= a.first_alert_at
           ) as completed
      from alerted a
     where a.first_alert_at > now() - make_interval(days => v_days)
  ),
  per_world as (
    select p.world_slug as slug,
           count(*)::integer as n,
           (count(p.offer_response) + count(p.request_response))::integer as resp,
           (count(*) filter (where p.offer_response = 'accepted')
            + count(*) filter (where p.request_response = 'accepted'))::integer as acc,
           (count(*) filter (where p.chatted))::integer as chats,
           (count(*) filter (where p.completed))::integer as done
      from pairs p
     group by p.world_slug
  )
  select w.slug,
         coalesce(wl.label_he, w.slug),
         coalesce(wl.label_en, w.slug),
         w.n,
         w.resp,
         w.acc,
         round(w.acc::numeric / nullif(w.resp, 0), 4),
         w.chats,
         round(w.chats::numeric / nullif(w.n, 0), 4),
         case when w.slug = any (v_handoff_worlds) then w.done end,
         case when w.slug = any (v_handoff_worlds) then round(w.done::numeric / nullif(w.n, 0), 4) end
    from per_world w
    left join public.worlds wl on wl.slug = w.slug
   order by w.n desc, w.slug;
end;
$$;

comment on function public.admin_match_quality(integer) is
  'KC#1122: per-world match quality (precision proxy, notification→chat, completion) over the last p_days (1..365). Super admin / moderator only.';

revoke all on function public.admin_match_quality(integer) from public, anon;
grant execute on function public.admin_match_quality(integer) to authenticated;

commit;
