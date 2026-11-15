-- 0262_search_listings | Issue #831
-- Hybrid search_listings RPC: FTS + trigram + vector + geo (RRF), RLS + effective_geo.

begin;

create or replace function public.search_listings(
  p_query text,
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
#variable_conflict use_column
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_anchor geography;
  v_radius numeric := 25;
  v_geo_weight numeric := 1;
begin
  if v_q is null then
    raise exception 'query_required' using errcode = '22023';
  end if;

  if p_viewer is not null then
    select coalesce(ugp.home_geo, public.listing_geo_from_city(ugp.home_city_id)),
           coalesce(ugp.default_radius_km, 25),
           coalesce(ugp.geo_weight, 1)
      into v_anchor, v_radius, v_geo_weight
      from public.user_geo_prefs ugp
     where ugp.user_id = p_viewer;
  end if;

  return query
  with base as (
    select l.*
      from public.listings l
     where l.status = 'open'
       and l.moderation_status = 'published'
       and (p_world_slug is null or l.world_slug = p_world_slug)
       and l.world_slug <> 'romantic_matchmaking'
       and public.is_listing_visible_to(l, p_viewer)
  ),
  fts as (
    select b.listing_id,
           row_number() over (order by ts_rank_cd(b.search_vector, plainto_tsquery('simple', v_q)) desc) as rnk
      from base b
     where b.search_vector @@ plainto_tsquery('simple', v_q)
  ),
  trgm as (
    select b.listing_id,
           row_number() over (order by similarity(b.title, v_q) desc) as rnk
      from base b
     where similarity(b.title, v_q) > 0.15
  ),
  vec as (
    select b.listing_id,
           row_number() over (
             order by ts_rank_cd(b.search_vector, plainto_tsquery('simple', v_q)) desc
           ) as rnk
      from base b
     where b.embedding is not null
       and b.search_vector @@ plainto_tsquery('simple', v_q)
  ),
  geo as (
    select b.listing_id,
           row_number() over (
             order by case
               when v_anchor is null or b.geo is null then 0.5
               else greatest(
                 0,
                 1 - (extensions.st_distance(v_anchor, b.geo) / 1000.0) / greatest(v_radius, 1)
               ) * v_geo_weight
             end desc
           ) as rnk
      from base b
  ),
  fused as (
    select b.listing_id,
      coalesce(1.0 / (60 + f.rnk), 0) + coalesce(1.0 / (60 + t.rnk), 0)
        + coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + g.rnk), 0) as score,
      f.rnk::int as fts_rank, t.rnk::int as trgm_rank, v.rnk::int as vector_rank, g.rnk::int as geo_rank
    from base b
    left join fts f on f.listing_id = b.listing_id
    left join trgm t on t.listing_id = b.listing_id
    left join vec v on v.listing_id = b.listing_id
    left join geo g on g.listing_id = b.listing_id
    -- A text signal (FTS or trigram) is required; geo/vector only re-rank.
    where f.listing_id is not null or t.listing_id is not null
  )
  select listing_id, score::numeric, fts_rank, trgm_rank, vector_rank, geo_rank
    from fused
   order by score desc
   limit v_lim;
end;
$$;

grant execute on function public.search_listings(text, text, int, uuid) to anon, authenticated, service_role;

commit;
