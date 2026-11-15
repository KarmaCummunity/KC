-- 0336_similar_listings | same-world recommendations on detail screen.

begin;

create or replace function public.similar_listings(
  p_listing_id uuid,
  p_limit int default 6
)
returns table (listing_id uuid, title text, world_slug text, kind_slug text)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select l.world_slug, l.kind_id, l.search_vector
      from public.listings l
     where l.listing_id = p_listing_id
       and l.status = 'open'
       and l.moderation_status = 'published'
  )
  select
    l.listing_id,
    l.title,
    l.world_slug,
    lk.slug as kind_slug
  from public.listings l
  join public.listing_kinds lk on lk.kind_id = l.kind_id
  cross join base b
  where l.listing_id <> p_listing_id
    and l.status = 'open'
    and l.moderation_status = 'published'
    and l.world_slug = b.world_slug
    and public.is_listing_visible_to(l, auth.uid())
  order by
    case when l.kind_id = b.kind_id then 0 else 1 end,
    l.published_at desc nulls last
  limit least(greatest(coalesce(p_limit, 6), 1), 12);
$$;

revoke all on function public.similar_listings(uuid, int) from public;
grant execute on function public.similar_listings(uuid, int) to anon, authenticated;

commit;
