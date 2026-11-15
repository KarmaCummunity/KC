-- Matching · quality report for staff (FR-ADMIN-029, KC#1122)
--
-- How well the engine's suggestions land, per giving world: of the pairs whose owners were
-- told in the window, how many answers came back and how many said yes (a precision proxy),
-- how many pairs went on to talk in a chat after the alert, and how many ended in a
-- completed handoff between the two owners. Pairs are internal, so the report is computed
-- with definer rights and opened to moderators and above only.

-- One row per giving world with at least one pair alerted in the last p_days (1..365):
--   notified_pairs   pairs whose first owner alert falls in the window
--   responses        answers given on those pairs (each owner answers once)
--   accepted         of them, acceptances; precision_proxy = accepted / responses
--   chat_pairs       pairs whose owners exchanged a member message after the first alert;
--                    chat_rate = chat_pairs / notified_pairs
--   completed_pairs  pairs with a handoff between the two owners on either post, handed
--                    over after the first alert; completion_rate = completed / notified
-- A rate is null when its denominator is zero. Busiest world first. An admin report over a
-- bounded window: the pairs are scanned once, the chat and handoff checks use their pair
-- and post indexes. Errors: unauthenticated / forbidden (SQLSTATE 42501).
create function public.admin_match_quality(p_days integer default 30)
returns table (
  world_slug      text,
  world_label_he  text,
  world_label_en  text,
  notified_pairs  integer,
  responses       integer,
  accepted        integer,
  precision_proxy numeric,
  chat_pairs      integer,
  chat_rate       numeric,
  completed_pairs integer,
  completion_rate numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days constant integer := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  perform kc_private.require_admin_role('moderator');

  return query
  with alerted as (
    -- The first alert of a pair; least() skips the side that was not told.
    select m.*, least(m.notified_offer_at, m.notified_request_at) as first_alert_at
      from kc_private.match_candidates m
     where least(m.notified_offer_at, m.notified_request_at) > now() - make_interval(days => v_days)
  ),
  pairs as (
    select a.world_slug, a.offer_response, a.request_response,
           exists (
             select 1
               from public.chats c
               join public.messages msg on msg.chat_id = c.id
              where c.kind = 'direct'
                and c.direct_user_a = least(a.offer_owner_id, a.request_owner_id)
                and c.direct_user_b = greatest(a.offer_owner_id, a.request_owner_id)
                and msg.kind in ('user', 'media')
                and msg.created_at >= a.first_alert_at) as chatted,
           exists (
             select 1
               from public.post_handoffs h
              where h.post_id in (a.offer_post_id, a.request_post_id)
                and h.status = 'handed_over'
                and h.handed_over_at >= a.first_alert_at
                and ((h.owner_id = a.offer_owner_id and h.recipient_id = a.request_owner_id)
                     or (h.owner_id = a.request_owner_id and h.recipient_id = a.offer_owner_id))) as completed
      from alerted a
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
  select w.slug, wl.label_he, wl.label_en, w.n, w.resp, w.acc,
         round(w.acc::numeric / nullif(w.resp, 0), 4),
         w.chats, round(w.chats::numeric / nullif(w.n, 0), 4),
         w.done, round(w.done::numeric / nullif(w.n, 0), 4)
    from per_world w
    join public.worlds wl on wl.slug = w.slug
   order by w.n desc, w.slug;
end;
$$;
comment on function public.admin_match_quality(integer) is
  'Per giving world: alerted pairs, answers, acceptances, chats and completed handoffs over the last p_days. Moderators and above.';
grant execute on function public.admin_match_quality(integer) to authenticated;
