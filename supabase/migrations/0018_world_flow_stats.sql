-- Statistics · the platform flow funnel and a member's givings by world (FR-STATS-007,
-- FR-STATS-008, D106, G43)
--
-- Both read the post and handoff records; neither identifies a member to anyone else.

-- ── FR-STATS-007: the flow funnel per world and direction, for the team ─────────────────────
--
-- A cohort: the posts published in the last p_days (1..365), followed through their handoffs
-- whenever those happened. Every stage counts posts, so the stages nest
-- (published ≥ booked ≥ confirmed ≥ completed):
--   published                  posts published in the window
--   booked                     ... with at least one handoff
--   confirmed                  ... with a handoff that was confirmed or handed over
--   completed                  ... with a handoff handed over
--   cancelled                  booked posts whose every handoff ended cancelled or no-show
--   closed                     posts closed (delivered, or closed without a recipient)
--   median_hours_to_booking    published → first handoff, over booked posts
--   median_hours_to_completion published → first handover, over completed posts
-- `direction` is 'give' for an offer and 'request' for a request. The handoff columns are
-- null for the money world, whose posts are donations and never hand off (AC3 "not
-- tracked"). The north star, givings closed in the window, is the sum of `closed`
-- (docs/spec/16_kpis.md). Moderators and above. Errors: unauthenticated / forbidden (42501).
create function public.admin_world_flow_funnel(p_days integer default 30)
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
set search_path = ''
as $$
declare
  v_days constant integer := least(greatest(coalesce(p_days, 30), 1), 365);
  -- Worlds whose posts never go through post_handoffs.
  v_untracked constant text[] := array['money'];
begin
  perform kc_private.require_admin_role('moderator');

  return query
  with stages as (
    select p.world_slug as slug,
           case p.direction when 'request' then 'request' else 'give' end as dir,
           p.status, p.published_at,
           min(h.created_at) as first_booked_at,
           bool_or(h.confirmed_at is not null or h.handed_over_at is not null) as reached_confirmed,
           min(h.handed_over_at) as first_handed_over_at,
           count(h.id) > 0 and bool_and(h.status in ('cancelled', 'no_show')) as all_cancelled
      from public.posts p
      left join public.post_handoffs h on h.post_id = p.id
     where p.published_at > now() - make_interval(days => v_days)
     group by p.id
  ),
  per_world as (
    select s.slug, s.dir,
           count(*)::integer as n_published,
           (count(*) filter (where s.first_booked_at is not null))::integer as n_booked,
           (count(*) filter (where s.reached_confirmed))::integer as n_confirmed,
           (count(*) filter (where s.first_handed_over_at is not null))::integer as n_completed,
           (count(*) filter (where s.all_cancelled))::integer as n_cancelled,
           (count(*) filter (where s.status in ('closed_delivered', 'deleted_no_recipient')))::integer as n_closed,
           percentile_cont(0.5) within group (order by extract(epoch from s.first_booked_at - s.published_at) / 3600)
             filter (where s.first_booked_at is not null) as hours_to_booking,
           percentile_cont(0.5) within group (order by extract(epoch from s.first_handed_over_at - s.published_at) / 3600)
             filter (where s.first_handed_over_at is not null) as hours_to_completion
      from stages s
     group by s.slug, s.dir
  )
  select w.slug, wl.label_he, wl.label_en, w.dir, w.n_published,
         case when w.slug <> all (v_untracked) then w.n_booked end,
         case when w.slug <> all (v_untracked) then w.n_confirmed end,
         case when w.slug <> all (v_untracked) then w.n_completed end,
         case when w.slug <> all (v_untracked) then w.n_cancelled end,
         w.n_closed,
         case when w.slug <> all (v_untracked) then round(w.hours_to_booking::numeric, 1) end,
         case when w.slug <> all (v_untracked) then round(w.hours_to_completion::numeric, 1) end
    from per_world w
    join public.worlds wl on wl.slug = w.slug
   order by w.n_published desc, w.slug, w.dir;
end;
$$;
comment on function public.admin_world_flow_funnel(integer) is
  'FR-STATS-007: per world and direction, the posts published in the last p_days through booked, confirmed, handed over, cancelled and closed. Moderators and above.';
grant execute on function public.admin_world_flow_funnel(integer) to authenticated;

-- ── FR-STATS-008: the caller's own givings by world ─────────────────────────────────────────
--
--   given     handoffs on the caller's posts that were handed over
--   received  handoffs the caller received that were handed over
--   closed    the caller's own posts closed (delivered, or closed without a recipient)
-- Worlds with none of the three are left out; busiest first. Owner only: it reads the session
-- and takes no member id (FR-STATS-006 AC1).
create function public.my_world_givings()
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
  with me as (select (select auth.uid()) as id),
  mine as (
    select p.world_slug,
           (count(*) filter (where h.owner_id = me.id))::integer as given,
           (count(*) filter (where h.recipient_id = me.id))::integer as received,
           0 as closed
      from me
      join public.post_handoffs h on h.status = 'handed_over' and (h.owner_id = me.id or h.recipient_id = me.id)
      join public.posts p on p.id = h.post_id
     group by p.world_slug
    union all
    select p.world_slug, 0, 0, count(*)::integer
      from me
      join public.posts p on p.owner_id = me.id and p.status in ('closed_delivered', 'deleted_no_recipient')
     group by p.world_slug
  )
  select m.world_slug, w.label_he, w.label_en,
         sum(m.given)::integer, sum(m.received)::integer, sum(m.closed)::integer
    from mine m
    join public.worlds w on w.slug = m.world_slug
   group by m.world_slug, w.label_he, w.label_en
   order by sum(m.given) + sum(m.received) + sum(m.closed) desc, m.world_slug;
$$;
comment on function public.my_world_givings() is
  'FR-STATS-008: the caller''s own handed-over givings (given / received) and closed posts, per world.';
grant execute on function public.my_world_givings() to authenticated;
