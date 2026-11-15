-- 0542_admin_world_flow_funnel | G43 (docs/architecture/target.md §5.2): per-world flow funnel
-- for the team (super admin + moderator), over the listings published in the last p_days.
--
-- The funnel is a cohort: it follows the listings published in the window through their
-- giving handoffs (0380 / 0390), whenever those happened. No client event is needed. Every
-- stage counts listings, so the stages nest (published ≥ booked ≥ confirmed ≥ completed):
--   published                  listings published in the window (listings.published_at)
--   booked                     ... with at least one handoff (reserved, booked or claimed)
--   confirmed                  ... with a handoff that reached confirmation (confirmed_at, or
--                              handed over without a separate confirm step)
--   completed                  ... with a handoff handed over
--   cancelled                  booked listings whose every handoff ended cancelled or no-show
--   closed                     listings closed (listings.status = 'closed'), in every world
--   median_hours_to_booking    published → first handoff, over booked listings
--   median_hours_to_completion published → first handover, over completed listings
-- One row per (world, direction): requests in the handoff worlds are rarely booked, so mixing
-- them with offers would hide the offer funnel. The handoff columns are null for worlds that do
-- not hand off through giving_handoffs. Feeds the KPI north star, "closed givings per week"
-- (docs/spec/16_kpis.md). Read-only; no schema change.

begin;

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
  -- Mirrors giving_handoffs_world_slug_check (0390).
  v_handoff_worlds constant text[] := array['items', 'food', 'rides', 'knowledge'];
begin
  perform public.admin_assert_role(v_actor, array['super_admin', 'moderator']);
  return query
  with cohort as (
    select l.listing_id, l.world_slug, l.direction, l.status, l.published_at
      from public.listings l
     where l.published_at > now() - make_interval(days => v_days)
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
      left join public.giving_handoffs h on h.listing_id = c.listing_id
     group by c.listing_id, c.world_slug, c.direction, c.status, c.published_at
  ),
  per_world as (
    select s.world_slug as slug,
           s.direction as dir,
           count(*)::integer as n_published,
           (count(*) filter (where s.first_booked_at is not null))::integer as n_booked,
           (count(*) filter (where s.reached_confirmed))::integer as n_confirmed,
           (count(*) filter (where s.first_handed_over_at is not null))::integer as n_completed,
           (count(*) filter (where s.all_cancelled))::integer as n_cancelled,
           (count(*) filter (where s.status = 'closed'))::integer as n_closed,
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
  'G43: per-world flow funnel (published → booked → confirmed → completed / cancelled, closed, median hours) over listings published in the last p_days (1..365). Super admin / moderator only.';

revoke all on function public.admin_world_flow_funnel(integer) from public, anon;
grant execute on function public.admin_world_flow_funnel(integer) to authenticated;

commit;
