-- 0515_rides_feed | The rides feed: offers and requests together, by departure
-- (docs/spec/05_giving_worlds.md §5.3 "Feed", D75; gap G49).
--
-- list_rides_feed(limit) — every open, published ride the caller may see whose departure is
-- still ahead (departed rides are hidden), soonest first. An offer carries the seats still
-- free (offered minus waiting, approved and completed bookings); a request carries its
-- passengers. The app groups the rows into today / tomorrow / later in local time.

begin;

create or replace function public.list_rides_feed(p_limit int default 100)
returns table (
  listing_id     uuid,
  direction      text,
  title          text,
  departs_at     timestamptz,
  origin_label   text,
  dest_label     text,
  meeting_points int,
  seats_left     int,
  passengers     int
)
language sql
stable
security definer
set search_path = public
as $$
  select l.listing_id,
         l.direction,
         l.title,
         (l.details->>'departs_at')::timestamptz,
         l.details->>'origin_label',
         l.details->>'dest_label',
         coalesce(jsonb_array_length(case jsonb_typeof(l.details->'meeting_points')
                                       when 'array' then l.details->'meeting_points' end), 0),
         case when l.direction = 'give' then greatest(0,
           coalesce((l.details->>'seats_available')::int, 1)
           - coalesce((select sum(h.seats)::int from public.giving_handoffs h
                        where h.listing_id = l.listing_id
                          and h.status in ('reserved', 'confirmed', 'handed_over')), 0))
         end,
         case when l.direction = 'request' then (l.details->>'passengers')::int end
    from public.listings l
   where l.world_slug = 'rides'
     and l.status = 'open'
     and l.moderation_status = 'published'
     and jsonb_typeof(l.details->'departs_at') = 'string'
     and (l.details->>'departs_at')::timestamptz > now()
     and public.is_listing_visible_to(l, auth.uid())
   order by (l.details->>'departs_at')::timestamptz, l.listing_id
   limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

comment on function public.list_rides_feed(int) is
  'Rides feed: open ride offers and requests not yet departed, soonest first, with free seats (D75).';

revoke all on function public.list_rides_feed(int) from public;
grant execute on function public.list_rides_feed(int) to anon, authenticated;

commit;
