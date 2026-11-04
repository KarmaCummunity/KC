-- 0565_g1_readers_reports_on_posts | G1 step 6a-1 (ADR-006, D-214, BACKLOG G1-S6): the leaf
-- readers read `posts` / `post_handoffs` instead of `listings` / `giving_handoffs`.
--
-- Step 6 removes the legacy tables; 6a moves their readers first, one group per PR. This group
-- holds the readers nothing else depends on:
--   1. admin_world_flow_funnel   (0542)  cohort of posts, stages from post_handoffs
--   2. my_world_givings          (0547)  post_handoffs, closed posts
--   3. admin_match_quality       (0454)  its completion check reads post_handoffs
--   4. ops.check_rides_bookings_unconfirmed, ops.check_rides_trips_not_completed (0463)
--   5. reports_open_inbox, reports_case_detail (0339)  a listing target's title and owner come
--      from its post; its moderation status and dates stay the listing's until 6a-5
--   6. get_nonprofit_public_page (0361)  the campaigns are money posts
--   7. feed_ranked_ids           (0557)  the sub-category filter reads posts.category_id
-- Each body is the latest definition copied verbatim; every changed line carries a `-- 0565:`
-- note. Names, arguments, return types and grants are unchanged. On existing data the output is
-- the same, except where noted:
--   * a listing that never got a post — the v1 rides of origin 'ride_listing' (G44, cleaned up
--     before step 6c) — drops out of the funnel and of the "closed" counts;
--   * my_world_givings now also counts handed-over handoffs that live on post_handoffs only
--     (time-world event attendance, 0563 / 0564), which giving_handoffs never held;
--   * a post's title is capped at 80 characters where a listing's is at 120, so a report
--     preview or a campaign title of a longer listing-sourced listing shows its first 80
--     (posts gain the listing's own columns in 6a-5).
-- A report or a match pair still names a listing id; `post_id_of_listing` (0553) resolves it to
-- the post (it reads `listings.legacy_post_id` for an items listing until the listing ids go, 6d).
-- Read-only; no schema change. Idempotent (create or replace only).

begin;

-- ── 1. admin_world_flow_funnel (0542) ─────────────────────────────────────────────────────────

create or replace function public.admin_world_flow_funnel(p_days integer default 30)
returns table (
  world_slug                 text,
  world_label_he             text,
  world_label_en             text,
  direction                  text,
  published                  integer,
  booked                     integer,
  confirmed                  integer,
  completed                  integer,
  cancelled                  integer,
  closed                     integer,
  median_hours_to_booking    numeric,
  median_hours_to_completion numeric
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
  -- Mirrors giving_handoffs_world_slug_check (0390). 0565: unchanged on purpose, so the time
  -- world (event registrations live on post_handoffs only, 0563) keeps null handoff columns.
  v_handoff_worlds constant text[] := array['items', 'food', 'rides', 'knowledge'];
begin
  perform public.admin_assert_role(v_actor, array['super_admin', 'moderator']);
  return query
  -- 0565: the cohort is the posts published in the window. A post is created when its listing
  -- is published (posts.created_at = listings.published_at; a post-sourced listing takes the
  -- post's created_at), and its listing's direction is 'give' for an offer, kept as the output.
  -- Listings that never got a post (v1 rides, origin 'ride_listing', G44) are no longer counted.
  with cohort as (
    select p.post_id, p.world_slug,
           case when p.direction = 'request' then 'request' else 'give' end as direction, -- 0565
           p.status, p.created_at as published_at                                        -- 0565
      from public.posts p                                                                -- 0565
     where p.created_at > now() - make_interval(days => v_days)                          -- 0565
  ),
  -- One row per cohort listing: when it reached each handoff stage, if it did.
  stages as (
    select c.world_slug,
           c.direction,
           c.status,
           min(h.reserved_at) as first_booked_at,
           bool_or(h.confirmed_at is not null or h.handed_over_at is not null) as reached_confirmed,
           min(h.handed_over_at) as first_handed_over_at,
           count(h.handoff_id) > 0
             and bool_and(h.status in ('cancelled', 'no_show')) as all_cancelled,
           c.published_at
      from cohort c
      left join public.post_handoffs h on h.post_id = c.post_id -- 0565: the handoff record
     group by c.post_id, c.world_slug, c.direction, c.status, c.published_at -- 0565
  ),
  per_world as (
    select s.world_slug as slug,
           s.direction as dir,
           count(*)::integer as n_published,
           (count(*) filter (where s.first_booked_at is not null))::integer as n_booked,
           (count(*) filter (where s.reached_confirmed))::integer as n_confirmed,
           (count(*) filter (where s.first_handed_over_at is not null))::integer as n_completed,
           (count(*) filter (where s.all_cancelled))::integer as n_cancelled,
           -- 0565: the post statuses whose listing is 'closed' (listing_status_for_post, 0554):
           -- handed over / marked delivered, or closed without marking a recipient.
           (count(*) filter (where s.status in ('closed_delivered', 'deleted_no_recipient')))::integer as n_closed,
           percentile_cont(0.5) within group (
             order by extract(epoch from s.first_booked_at - s.published_at) / 3600
           ) filter (where s.first_booked_at is not null) as hours_to_booking,
           percentile_cont(0.5) within group (
             order by extract(epoch from s.first_handed_over_at - s.published_at) / 3600
           ) filter (where s.first_handed_over_at is not null) as hours_to_completion
      from stages s
     group by s.world_slug, s.direction
  )
  select w.slug,
         coalesce(wl.label_he, w.slug),
         coalesce(wl.label_en, w.slug),
         w.dir,
         w.n_published,
         case when w.slug = any (v_handoff_worlds) then w.n_booked end,
         case when w.slug = any (v_handoff_worlds) then w.n_confirmed end,
         case when w.slug = any (v_handoff_worlds) then w.n_completed end,
         case when w.slug = any (v_handoff_worlds) then w.n_cancelled end,
         w.n_closed,
         case when w.slug = any (v_handoff_worlds) then round(w.hours_to_booking::numeric, 1) end,
         case when w.slug = any (v_handoff_worlds) then round(w.hours_to_completion::numeric, 1) end
    from per_world w
    left join public.worlds wl on wl.slug = w.slug
   order by w.n_published desc, w.slug, w.dir;
end;
$$;

comment on function public.admin_world_flow_funnel(integer) is
  'G43: per-world flow funnel (published → booked → confirmed → completed / cancelled, closed, median hours) over the posts published in the last p_days (1..365), through post_handoffs (0565). Super admin / moderator only.';

revoke all on function public.admin_world_flow_funnel(integer) from public, anon;
grant execute on function public.admin_world_flow_funnel(integer) to authenticated;

-- ── 2. my_world_givings (0547) ────────────────────────────────────────────────────────────────

create or replace function public.my_world_givings()
returns table (
  world_slug     text,
  world_label_he text,
  world_label_en text,
  given          integer,
  received       integer,
  closed         integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select h.world_slug,
           count(*) filter (where h.owner_id = auth.uid())::integer     as given,
           count(*) filter (where h.recipient_id = auth.uid())::integer as received,
           0                                                           as closed
      from public.post_handoffs h -- 0565: the handoff record; time-world attendance (0564) counts too
     where h.status = 'handed_over'
       and (h.owner_id = auth.uid() or h.recipient_id = auth.uid())
     group by h.world_slug
    union all
    -- 0565: the member's closed posts, i.e. the post statuses whose listing is 'closed' (0554).
    select p.world_slug, 0, 0, count(*)::integer
      from public.posts p
     where p.owner_id = auth.uid()
       and p.status in ('closed_delivered', 'deleted_no_recipient')
     group by p.world_slug
  )
  select m.world_slug,
         coalesce(w.label_he, m.world_slug),
         coalesce(w.label_en, m.world_slug),
         sum(m.given)::integer,
         sum(m.received)::integer,
         sum(m.closed)::integer
    from mine m
    left join public.worlds w on w.slug = m.world_slug
   group by m.world_slug, w.label_he, w.label_en
   order by sum(m.given) + sum(m.received) + sum(m.closed) desc, m.world_slug;
$$;

comment on function public.my_world_givings() is
  'FR-STATS-008: the caller''s own handed-over givings (given / received, post_handoffs) and closed posts, per world (0565).';

revoke all on function public.my_world_givings() from public, anon;
grant execute on function public.my_world_givings() to authenticated;

-- ── 3. admin_match_quality (0454) ─────────────────────────────────────────────────────────────

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
               from public.post_handoffs h -- 0565: the handoff record, on the pair's posts
              where h.post_id in (public.post_id_of_listing(a.offer_listing_id),
                                  public.post_id_of_listing(a.request_listing_id))
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

-- ── 4. Rides health checks (0463) ─────────────────────────────────────────────────────────────

-- Seat bookings still waiting for the driver after their confirm-by deadline.
create or replace function ops.check_rides_bookings_unconfirmed()
returns ops.health_result
language sql
stable
set search_path = public, pg_temp
as $$
  select count(*)::numeric,
         format('%s ride bookings past their confirm-by deadline', count(*))
    from public.post_handoffs -- 0565: the handoff record
   where world_slug = 'rides'
     and status = 'reserved'
     and confirm_by < now();
$$;
revoke all on function ops.check_rides_bookings_unconfirmed() from public, anon, authenticated;

-- Confirmed seats on rides that left over a day ago and were never completed.
create or replace function ops.check_rides_trips_not_completed()
returns ops.health_result
language sql
stable
set search_path = ops, public, pg_temp
as $$
  select count(*)::numeric,
         format('%s confirmed ride seats not completed 24 h after departure', count(*))
    from public.post_handoffs h                               -- 0565: the handoff record
    join public.posts p on p.post_id = h.post_id              -- 0565: the ride's post, same details
   where h.world_slug = 'rides'
     and h.status = 'confirmed'
     and ops.ride_departs_at(p.details) < now() - interval '24 hours';
$$;
revoke all on function ops.check_rides_trips_not_completed() from public, anon, authenticated;

-- ── 5. Reports inbox and case detail (0339; grants 0120 / 0121) ───────────────────────────────

create or replace function public.reports_open_inbox(
  p_target_type_filter text  default null,
  p_max_age_days       int   default null,
  p_reporter_filter    uuid  default null,
  p_cursor             jsonb default null,
  p_limit              int   default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator','support']);

  if p_limit is null or p_limit < 1 or p_limit > 100 then p_limit := 25; end if;

  if p_target_type_filter is not null
     and p_target_type_filter not in ('post','user','chat','listing') then
    raise exception 'invalid_target_type_filter' using errcode = '22023';
  end if;

  with grouped as (
    select
      r.target_type,
      r.target_id,
      count(distinct r.reporter_id)::int as reporter_count,
      min(r.created_at) as oldest_at,
      (array_agg(r.reporter_id order by r.created_at desc))[1] as latest_reporter_id,
      case
        when r.target_type = 'post' then (
          select jsonb_build_object(
            'preview', left(coalesce(p.title, p.description, ''), 120),
            'status', p.status,
            'author_id', p.owner_id
          ) from public.posts p where p.post_id = r.target_id)
        when r.target_type = 'user' then (
          select jsonb_build_object(
            'display_name', u.display_name,
            'status', u.account_status
          ) from public.users u where u.user_id = r.target_id)
        when r.target_type = 'chat' then (
          select jsonb_build_object('removed_at', c.removed_at)
            from public.chats c where c.chat_id = r.target_id)
        -- 0565: a listing target resolves to its post (post_id_of_listing); the title and the
        -- owner come from the post. Fallback: a listing that has no post (a v1 ride, G44) keeps
        -- its own. The status stays the listing's: the listing moderation writers (0339 / 0468)
        -- still write it, and an items post does not follow them (posts gain it in 6a-5).
        when r.target_type = 'listing' then (
          select jsonb_build_object(
            'preview', left(coalesce(p.title, l.title, l.summary, ''), 120), -- 0565
            'status', l.status,
            'owner_id', coalesce(p.owner_id, l.owner_id),                  -- 0565
            'world_slug', l.world_slug
          ) from public.listings l
            left join public.posts p on p.post_id = public.post_id_of_listing(l.listing_id) -- 0565
           where l.listing_id = r.target_id)
        else '{}'::jsonb
      end as target
    from public.reports r
    where r.status = 'open'
      and r.target_type in ('post','user','chat','listing')
      and r.target_id is not null
      and (p_target_type_filter is null or r.target_type = p_target_type_filter)
      and (p_max_age_days is null or r.created_at >= now() - make_interval(days => p_max_age_days))
      and (p_reporter_filter is null or exists (
             select 1 from public.reports r2
              where r2.target_type = r.target_type and r2.target_id = r.target_id
                and r2.reporter_id = p_reporter_filter and r2.status = 'open'))
    group by r.target_type, r.target_id
  ),
  paged as (
    select g.* from grouped g
     where p_cursor is null
        or (g.oldest_at, g.target_type, g.target_id::text)
           > ((p_cursor->>'oldest_at')::timestamptz, p_cursor->>'target_type', p_cursor->>'target_id')
     order by g.oldest_at asc, g.target_type asc, g.target_id asc
     limit p_limit + 1
  ),
  numbered as (
    select p.*, row_number() over (order by p.oldest_at asc, p.target_type asc, p.target_id asc) as rn
      from paged p
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
         'target_type', n.target_type, 'target_id', n.target_id,
         'reporter_count', n.reporter_count, 'oldest_at', n.oldest_at,
         'latest_reporter_id', n.latest_reporter_id,
         'target', coalesce(n.target, '{}'::jsonb)) order by n.rn)
       from numbered n where n.rn <= p_limit), '[]'::jsonb),
    'next_cursor', case when exists (select 1 from numbered where rn = p_limit + 1) then (
          select jsonb_build_object('oldest_at', n.oldest_at, 'target_type', n.target_type, 'target_id', n.target_id::text)
          from numbered n where n.rn = p_limit) else null end
  ) into v_result;

  return v_result;
end;
$$;
revoke execute on function public.reports_open_inbox(text, int, uuid, jsonb, int) from public;
grant  execute on function public.reports_open_inbox(text, int, uuid, jsonb, int) to authenticated;
-- 0436 granted service_role on every SECURITY DEFINER function in public; restated as it is today.
grant  execute on function public.reports_open_inbox(text, int, uuid, jsonb, int) to service_role;

create or replace function public.reports_case_detail(
  p_target_type text,
  p_target_id   uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_target jsonb;
  v_reporters jsonb;
  v_timeline jsonb;
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator','support']);

  if p_target_type not in ('post','user','chat','listing') or p_target_id is null then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  if p_target_type = 'post' then
    select jsonb_build_object(
      'preview', left(coalesce(p.title, p.description, ''), 280),
      'status', p.status, 'author_id', p.owner_id, 'created_at', p.created_at
    ) into v_target from public.posts p where p.post_id = p_target_id;
  elsif p_target_type = 'user' then
    select jsonb_build_object(
      'display_name', u.display_name, 'status', u.account_status, 'created_at', u.created_at
    ) into v_target from public.users u where u.user_id = p_target_id;
  elsif p_target_type = 'chat' then
    select jsonb_build_object('removed_at', c.removed_at) into v_target
      from public.chats c where c.chat_id = p_target_id;
  elsif p_target_type = 'listing' then
    -- 0565: title and owner from the listing's post, as in reports_open_inbox; a listing without
    -- a post (a v1 ride, G44) falls back to its own. Status and dates stay the listing's.
    select jsonb_build_object(
      'preview', left(coalesce(p.title, l.title, l.summary, ''), 280), -- 0565
      'status', l.status, 'owner_id', coalesce(p.owner_id, l.owner_id), -- 0565
      'world_slug', l.world_slug, 'created_at', l.created_at
    ) into v_target from public.listings l
      left join public.posts p on p.post_id = public.post_id_of_listing(l.listing_id) -- 0565
     where l.listing_id = p_target_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'report_id', r.report_id, 'reporter_id', r.reporter_id,
    'reporter_name', u.display_name, 'reason', r.reason, 'note', r.note,
    'status', r.status, 'created_at', r.created_at,
    'resolved_at', r.resolved_at, 'resolved_by', r.resolved_by
  ) order by r.created_at asc), '[]'::jsonb)
    into v_reporters
    from public.reports r
    left join public.users u on u.user_id = r.reporter_id
   where r.target_type = p_target_type and r.target_id = p_target_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id', e.event_id, 'actor_id', e.actor_id, 'action', e.action,
    'metadata', e.metadata, 'created_at', e.created_at
  ) order by e.created_at desc), '[]'::jsonb)
    into v_timeline
    from public.audit_events e
   where e.target_type = p_target_type and e.target_id = p_target_id;

  return jsonb_build_object(
    'target_type', p_target_type, 'target_id', p_target_id,
    'target', coalesce(v_target, '{}'::jsonb),
    'reporters', v_reporters, 'timeline', v_timeline
  );
end;
$$;
revoke execute on function public.reports_case_detail(text, uuid) from public;
grant  execute on function public.reports_case_detail(text, uuid) to authenticated;
grant  execute on function public.reports_case_detail(text, uuid) to service_role;

-- ── 6. get_nonprofit_public_page (0361) ───────────────────────────────────────────────────────

create or replace function public.get_nonprofit_public_page(p_org_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org public.organizations%rowtype;
  v_raised numeric;
  v_campaigns jsonb;
begin
  select * into v_org from public.organizations
   where slug = p_org_slug and is_verified_nonprofit;
  if not found then
    return null;
  end if;

  select coalesce(sum(p.amount_ils), 0) into v_raised
    from public.payments p
   where p.org_id = v_org.org_id and p.status = 'succeeded';

  select coalesce(jsonb_agg(row_to_json(c)::jsonb order by c.published_at desc nulls last), '[]'::jsonb)
    into v_campaigns
  from (
    -- 0565: the campaigns are the money posts. A published open / closed listing is an
    -- 'open' / 'closed_delivered' post; the campaign keeps its listing id (donation intents and
    -- the app's links key on it) and its listing status vocabulary.
    select
      cp.listing_id,
      cp.title,
      cp.description as summary,
      case cp.status when 'open' then 'open' else 'closed' end as status,
      cp.created_at as published_at,
      coalesce((cp.details->>'goal_ils')::numeric, 0) as goal_ils,
      (
        select coalesce(sum(p2.amount_ils), 0)
          from public.payments p2
         where p2.org_id = v_org.org_id
           and p2.status = 'succeeded'
           and (p2.intent_id in (
             select di.intent_id from public.donation_intents di
              where di.listing_id = cp.listing_id
           ) or cp.beneficiary_org_id = v_org.org_id)
      ) as raised_ils
    from public.posts cp
    where cp.beneficiary_org_id = v_org.org_id
      and cp.world_slug = 'money'
      and cp.listing_id is not null
      and cp.status in ('open', 'closed_delivered')
  ) c;

  return jsonb_build_object(
    'org_id', v_org.org_id,
    'slug', v_org.slug,
    'name', v_org.name,
    'tagline_he', v_org.public_tagline_he,
    'tagline_en', v_org.public_tagline_en,
    'about_he', v_org.public_about_he,
    'about_en', v_org.public_about_en,
    'is_verified_nonprofit', v_org.is_verified_nonprofit,
    'total_raised_ils', v_raised,
    'campaigns', v_campaigns
  );
end;
$$;

revoke all on function public.get_nonprofit_public_page(text) from public;
grant execute on function public.get_nonprofit_public_page(text) to anon, authenticated;
-- 0436 granted service_role on every SECURITY DEFINER function in public; restated as it is today.
grant execute on function public.get_nonprofit_public_page(text) to service_role;

-- ── 7. feed_ranked_ids (0557 body; only the sub-category filter changes) ──────────────────────

create or replace function public.feed_ranked_ids(
  p_viewer_id uuid,
  p_filter_type text default null,
  p_filter_categories text[] default null,
  p_filter_item_conditions text[] default null,
  p_filter_status text default 'open',
  p_filter_center_city text default null,
  p_filter_radius_km double precision default null,
  p_sort_order text default 'newest',
  p_proximity_sort_city text default null,
  p_page_limit integer default 20,
  p_cursor_distance double precision default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_post_id uuid default null,
  p_filter_search_query text default null,
  p_followers_only boolean default false,
  p_cursor_rank_score double precision default null,
  p_filter_worlds text[] default null,
  p_filter_subcategories text[] default null
)
returns table (
  post_id uuid,
  distance_km double precision,
  rank_score double precision
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_center_lat double precision;
  v_center_lon double precision;
  v_filter_lat double precision;
  v_filter_lon double precision;
  v_status_set text[];
  v_search_esc text;
  v_sort text;
  v_use_mv boolean := false;
  w_fresh double precision;
  w_follow double precision;
  w_eng double precision;
  w_geo double precision;
  w_cat double precision;
  v_lim integer := greatest(1, least(coalesce(p_page_limit, 20), 100));
  v_n integer := 0;
  v_cur refcursor;
  r record;
  v_followed uuid[] := '{}'::uuid[];
  v_cats text[] := '{}'::text[];
  v_vc_lat double precision;
  v_vc_lon double precision;
  v_post public.posts;
begin
  v_sort := coalesce(p_sort_order, 'newest');
  if v_sort not in ('newest', 'oldest', 'distance', 'personalized') then
    v_sort := 'newest';
  end if;

  select coalesce(max(case when config_key = 'freshness' then weight end), 0.35),
         coalesce(max(case when config_key = 'follow_graph' then weight end), 0.25),
         coalesce(max(case when config_key = 'engagement' then weight end), 0.20),
         coalesce(max(case when config_key = 'geo' then weight end), 0.15),
         coalesce(max(case when config_key = 'interest_category' then weight end), 0.05)
    into w_fresh, w_follow, w_eng, w_geo, w_cat
    from public.feed_ranking_config;

  if v_sort = 'distance' then
    if p_proximity_sort_city is not null then
      select c.lat, c.lon into v_center_lat, v_center_lon
      from public.cities c where c.city_id = p_proximity_sort_city;
    elsif p_viewer_id is not null then
      select c.lat, c.lon into v_center_lat, v_center_lon
      from public.users u
      join public.cities c on c.city_id = u.city
      where u.user_id = p_viewer_id;
    end if;
    if v_center_lat is null then v_sort := 'newest'; end if;
  elsif v_sort = 'personalized' and p_viewer_id is null then
    v_sort := 'newest';
  end if;

  if p_filter_center_city is not null and p_filter_radius_km is not null then
    select c.lat, c.lon into v_filter_lat, v_filter_lon
    from public.cities c where c.city_id = p_filter_center_city;
  end if;

  v_status_set := case p_filter_status
    when 'open'   then array['open']::text[]
    when 'closed' then array['closed_delivered']::text[]
    when 'all'    then array['open','closed_delivered']::text[]
    else array['open']::text[]
  end;

  if p_filter_search_query is not null and length(trim(p_filter_search_query)) >= 2 then
    v_search_esc := public.escape_ilike(trim(p_filter_search_query));
  end if;

  v_use_mv := v_sort = 'newest'
    and v_search_esc is null
    and coalesce(p_followers_only, false) = false
    and p_filter_radius_km is null
    and p_filter_center_city is null;

  if p_viewer_id is not null then
    v_followed := coalesce(array(
      select fe.followed_id from public.follow_edges fe where fe.follower_id = p_viewer_id
    ), '{}'::uuid[]);
    if v_sort = 'personalized' then
      v_cats := coalesce(array(
        select distinct px.category
          from public.post_reactions pr
          join public.posts px on px.post_id = pr.post_id
         where pr.user_id = p_viewer_id
      ), '{}'::text[]);
      select c.lat, c.lon into v_vc_lat, v_vc_lon
        from public.users u
        join public.cities c on c.city_id = u.city
       where u.user_id = p_viewer_id;
    end if;
  end if;

  if v_use_mv then
    -- Newest fast path: walk feed_open_posts_mv_open_newest_idx in order.
    open v_cur for
      select p as prow, p.post_id as pid, null::double precision as dist, null::double precision as score
        from kc_private.feed_open_posts_mv fm
        join public.posts p on p.post_id = fm.post_id
        join public.cities c on c.city_id = fm.city
       where fm.status = any(v_status_set)
         and (p_filter_type is null or fm.type = p_filter_type)
         and (p_filter_categories is null or fm.category = any(p_filter_categories))
         and (p_filter_item_conditions is null or fm.item_condition = any(p_filter_item_conditions))
         and (p_filter_worlds is null or coalesce(p.listing_world_slug, 'items') = any(p_filter_worlds))
         and (
           p_filter_subcategories is null
           or (
             p.listing_id is not null
             and exists (
               -- 0565: the post carries its listing's sub-category (posts.category_id, 0551).
               select 1 from public.categories cat
               where cat.category_id = p.category_id
                 and cat.slug = any(p_filter_subcategories)
             )
           )
           or (
             p.listing_id is null
             and exists (
               select 1 from public.categories cat
               where cat.world_slug = 'items'
                 and cat.legacy_post_category = p.category
                 and cat.slug = any(p_filter_subcategories)
             )
           )
         )
         and (
           p_cursor_created_at is null
           or (fm.created_at, fm.post_id) < (p_cursor_created_at, p_cursor_post_id)
         )
       order by fm.created_at desc, fm.post_id desc;
  elsif v_sort in ('personalized', 'distance') and v_search_esc is null then
    open v_cur for
      select q.prow, q.pid, q.dist, q.score
        from (
          select
            p as prow,
            fm.post_id as pid,
            fm.created_at as cat,
            case when v_sort = 'distance'
                 then public.haversine_km(v_center_lat, v_center_lon, c.lat, c.lon)
            end as dist,
            case when v_filter_lat is not null
                 then public.haversine_km(v_filter_lat, v_filter_lon, c.lat, c.lon)
            end as filter_dist,
            case when v_sort = 'personalized' then (
              w_fresh * (1.0 / (1.0 + extract(epoch from (now() - fm.created_at)) / 86400.0))
              + w_follow * case when fm.owner_id = any(v_followed) then 1.0 else 0.0 end
              + w_eng * ln(1.0 + fm.reaction_count + fm.comment_count)
              + w_geo * case when v_vc_lat is not null then
                  1.0 / (1.0 + public.haversine_km(v_vc_lat, v_vc_lon, c.lat, c.lon) / 50.0)
                else 0.0 end
              + w_cat * case when fm.category = any(v_cats) then 1.0 else 0.0 end
            )::double precision end as score
          from kc_private.feed_open_posts_mv fm
          join public.posts p on p.post_id = fm.post_id
          join public.cities c on c.city_id = fm.city
          where fm.status = any(v_status_set)
            and (p_filter_type is null or fm.type = p_filter_type)
            and (p_filter_categories is null or fm.category = any(p_filter_categories))
            and (p_filter_item_conditions is null or fm.item_condition = any(p_filter_item_conditions))
            and (p_filter_worlds is null or coalesce(p.listing_world_slug, 'items') = any(p_filter_worlds))
            and (
              p_filter_subcategories is null
              or (
                p.listing_id is not null
                and exists (
                  -- 0565: the post carries its listing's sub-category (posts.category_id, 0551).
                  select 1 from public.categories cat
                  where cat.category_id = p.category_id
                    and cat.slug = any(p_filter_subcategories)
                )
              )
              or (
                p.listing_id is null
                and exists (
                  select 1 from public.categories cat
                  where cat.world_slug = 'items'
                    and cat.legacy_post_category = p.category
                    and cat.slug = any(p_filter_subcategories)
                )
              )
            )
            and (coalesce(p_followers_only, false) = false or fm.owner_id = any(v_followed))
        ) q
       where (p_filter_radius_km is null or q.filter_dist is null or q.filter_dist <= p_filter_radius_km)
         and (
           case
             when p_cursor_created_at is null then true
             when v_sort = 'personalized' then
               coalesce(q.score, 0) < coalesce(p_cursor_rank_score, 1e9)
               or (coalesce(q.score, 0) = coalesce(p_cursor_rank_score, 0)
                   and (q.cat, q.pid) < (p_cursor_created_at, p_cursor_post_id))
             else
               coalesce(q.dist, 1e9) > coalesce(p_cursor_distance, -1)
               or (coalesce(q.dist, 1e9) = coalesce(p_cursor_distance, -1)
                   and q.cat < p_cursor_created_at)
               or (coalesce(q.dist, 1e9) = coalesce(p_cursor_distance, -1)
                   and q.cat = p_cursor_created_at
                   and q.pid > p_cursor_post_id)
           end
         )
       order by
         case when v_sort = 'personalized' then q.score end desc nulls last,
         case when v_sort = 'distance' then q.dist end asc nulls last,
         q.cat desc,
         q.pid desc;
  else
    open v_cur for
      select q.prow, q.pid, q.dist, q.score
        from (
          select
            p as prow,
            p.post_id as pid,
            p.created_at as cat,
            case when v_sort = 'distance'
                 then public.haversine_km(v_center_lat, v_center_lon, c.lat, c.lon)
            end as dist,
            case when v_filter_lat is not null
                 then public.haversine_km(v_filter_lat, v_filter_lon, c.lat, c.lon)
            end as filter_dist,
            case when v_sort = 'personalized' then (
              w_fresh * (1.0 / (1.0 + extract(epoch from (now() - p.created_at)) / 86400.0))
              + w_follow * case when p.owner_id = any(v_followed) then 1.0 else 0.0 end
              + w_eng * ln(1.0 + coalesce(ps.reaction_count, 0) + coalesce(ps.comment_count, 0))
              + w_geo * case when v_vc_lat is not null then
                  1.0 / (1.0 + public.haversine_km(v_vc_lat, v_vc_lon, c.lat, c.lon) / 50.0)
                else 0.0 end
              + w_cat * case when p.category = any(v_cats) then 1.0 else 0.0 end
            )::double precision end as score
          from public.posts p
          join public.cities c on c.city_id = p.city
          left join public.post_stats ps on ps.post_id = p.post_id
          where p.status = any(v_status_set)
            and (p_filter_type is null or p.type = p_filter_type)
            and (p_filter_categories is null or p.category = any(p_filter_categories))
            and (p_filter_item_conditions is null or p.item_condition = any(p_filter_item_conditions))
            and (p_filter_worlds is null or coalesce(p.listing_world_slug, 'items') = any(p_filter_worlds))
            and (
              p_filter_subcategories is null
              or (
                p.listing_id is not null
                and exists (
                  -- 0565: the post carries its listing's sub-category (posts.category_id, 0551).
                  select 1 from public.categories cat
                  where cat.category_id = p.category_id
                    and cat.slug = any(p_filter_subcategories)
                )
              )
              or (
                p.listing_id is null
                and exists (
                  select 1 from public.categories cat
                  where cat.world_slug = 'items'
                    and cat.legacy_post_category = p.category
                    and cat.slug = any(p_filter_subcategories)
                )
              )
            )
            and (
              v_search_esc is null
              or p.title ilike '%' || v_search_esc || '%' escape '\'
              or p.description ilike '%' || v_search_esc || '%' escape '\'
              or p.category ilike '%' || v_search_esc || '%' escape '\'
            )
            and (coalesce(p_followers_only, false) = false or p.owner_id = any(v_followed))
        ) q
       where (p_filter_radius_km is null or q.filter_dist is null or q.filter_dist <= p_filter_radius_km)
         and (
           case
             when p_cursor_created_at is null then true
             when v_sort = 'personalized' then
               coalesce(q.score, 0) < coalesce(p_cursor_rank_score, 1e9)
               or (coalesce(q.score, 0) = coalesce(p_cursor_rank_score, 0)
                   and (q.cat, q.pid) < (p_cursor_created_at, p_cursor_post_id))
             when v_sort = 'newest' then (q.cat, q.pid) < (p_cursor_created_at, p_cursor_post_id)
             when v_sort = 'oldest' then (q.cat, q.pid) > (p_cursor_created_at, p_cursor_post_id)
             when v_sort = 'distance' then
               coalesce(q.dist, 1e9) > coalesce(p_cursor_distance, -1)
               or (coalesce(q.dist, 1e9) = coalesce(p_cursor_distance, -1)
                   and q.cat < p_cursor_created_at)
               or (coalesce(q.dist, 1e9) = coalesce(p_cursor_distance, -1)
                   and q.cat = p_cursor_created_at
                   and q.pid > p_cursor_post_id)
             else true
           end
         )
       order by
         case when v_sort = 'personalized' then q.score end desc nulls last,
         case when v_sort = 'distance' then q.dist end asc nulls last,
         case when v_sort = 'oldest' then q.cat end asc,
         case when v_sort = 'oldest' then q.pid end asc,
         case when v_sort in ('newest', 'distance', 'personalized') then q.cat end desc,
         q.pid desc;
  end if;

  loop
    fetch v_cur into r;
    exit when not found;
    if (r.prow).post_id is null then
      select p.* into v_post
        from public.posts p
       where p.post_id = r.pid and p.status = any(v_status_set);
      continue when not found;
    else
      v_post := r.prow;
    end if;
    continue when not public.is_post_visible_to(v_post, p_viewer_id);
    -- A post that exists for a listing kept out of the main feed (0557) is not listed.
    continue when coalesce(v_post.feed_hidden, false);
    if p_viewer_id is not null then
      continue when exists (
        select 1 from public.feed_post_hides h
         where h.user_id = p_viewer_id and h.post_id = r.pid
      );
      continue when exists (
        select 1 from public.feed_mute_filters mf
         where mf.user_id = p_viewer_id
           and (
             (mf.filter_kind = 'user' and mf.filter_value = v_post.owner_id::text)
             or (mf.filter_kind in ('category', 'world') and mf.filter_value = v_post.category)
             or (mf.filter_kind = 'keyword' and (
               v_post.title ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
               or v_post.description ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
             ))
           )
      );
    end if;
    post_id := r.pid;
    distance_km := r.dist;
    rank_score := r.score;
    return next;
    v_n := v_n + 1;
    exit when v_n >= v_lim;
  end loop;
  close v_cur;
end;
$$;

revoke all on function public.feed_ranked_ids(
  uuid, text, text[], text[], text, text, double precision,
  text, text, integer, double precision, timestamptz, uuid, text, boolean, double precision,
  text[], text[]
) from public;

grant execute on function public.feed_ranked_ids(
  uuid, text, text[], text[], text, text, double precision,
  text, text, integer, double precision, timestamptz, uuid, text, boolean, double precision,
  text[], text[]
) to anon, authenticated, service_role;

commit;
