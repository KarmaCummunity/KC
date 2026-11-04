-- 0547_my_world_givings | FR-STATS-008 (statistics by audience, PM decision 2026-11-03): the
-- signed-in member's own givings per world on their statistics screen, beside the existing
-- counters. Owner only, like every personal statistic (FR-STATS-006 AC1): the function reads
-- auth.uid() and takes no user id, so it can never describe another member.
--   given     handoffs on the member's listings that were handed over (they gave)
--   received  handoffs where the member was the recipient and that were handed over
--   closed    the member's own listings closed in that world (handed over or marked fulfilled)
-- Worlds without any of the three are left out. Read-only; no schema change.

begin;

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
      from public.giving_handoffs h
     where h.status = 'handed_over'
       and (h.owner_id = auth.uid() or h.recipient_id = auth.uid())
     group by h.world_slug
    union all
    select l.world_slug, 0, 0, count(*)::integer
      from public.listings l
     where l.owner_id = auth.uid()
       and l.status = 'closed'
     group by l.world_slug
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
  'FR-STATS-008: the caller''s own handed-over givings (given / received) and closed listings, per world.';

revoke all on function public.my_world_givings() from public, anon;
grant execute on function public.my_world_givings() to authenticated;

commit;
