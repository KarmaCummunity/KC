-- 0330_marketplace_search_unified | Epic #893 / #905
-- Unified marketplace search: FTS + pg_trgm (+ vector hook via existing embedding column).

begin;

create index if not exists listings_summary_trgm_idx
  on public.listings using gin (summary gin_trgm_ops)
  where summary is not null;

-- Optional query-less browse rank uses same RRF core as search_listings when q is empty.
create or replace function public.marketplace_search(
  p_query text default null,
  p_world_slug text default null,
  p_limit int default 20,
  p_viewer uuid default auth.uid()
)
returns table (
  listing_id uuid,
  rrf_score numeric,
  fts_rank int,
  trgm_rank int,
  vector_rank int,
  geo_rank int
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
begin
  if v_q is not null then
    return query
    select * from public.search_listings(v_q, p_world_slug, p_limit, p_viewer);
    return;
  end if;

  return query
  select
    l.listing_id,
    (1.0 / (1 + row_number() over (order by l.urgency_level desc, l.created_at desc)))::numeric,
    null::int,
    null::int,
    case when l.embedding is not null then 1 else null end,
    null::int
  from public.listings l
  where l.status = 'open'
    and l.moderation_status = 'published'
    and l.world_slug <> 'romantic_matchmaking'
    and (p_world_slug is null or l.world_slug = p_world_slug)
    and public.is_listing_visible_to(l, p_viewer)
  order by l.urgency_level desc, l.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke all on function public.marketplace_search(text, text, int, uuid) from public;
grant execute on function public.marketplace_search(text, text, int, uuid) to anon, authenticated, service_role;

commit;
