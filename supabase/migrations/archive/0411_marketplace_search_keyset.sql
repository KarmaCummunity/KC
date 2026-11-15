-- 0411_marketplace_search_keyset | perf: candidate-first hybrid search + keyset cursor.
--
-- search_listings (0262) built `base` from EVERY open listing, ran
-- is_listing_visible_to() on all of them and ranked geo over the whole table on
-- each keystroke (~110 ms on 726 listings on kc-dev). Now:
--   * candidates come from the GIN indexes first (search_vector @@ / title %),
--     so only text matches are visibility-checked and geo-ranked;
--   * results page with a (rrf_score, listing_id) keyset cursor; rrf_score is
--     rounded to 12 decimals so it survives a JSON round trip exactly.
-- Also: search_all (0284) referenced similarity() with search_path = public while
-- pg_trgm lives in `extensions`, so any call that included 'people' failed with
-- "function similarity(text, text) does not exist". Fixed via search_path.

begin;

drop function if exists public.marketplace_search(text, text, int, uuid);
drop function if exists public.search_listings(text, text, int, uuid);

create or replace function public.search_listings(
  p_query text,
  p_world_slug text default null,
  p_limit int default 20,
  p_viewer uuid default auth.uid(),
  p_cursor_score numeric default null,
  p_cursor_id uuid default null
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
  v_tsq tsquery;
  v_anchor geography;
  v_radius numeric := 25;
  v_geo_weight numeric := 1;
begin
  if v_q is null then
    raise exception 'query_required' using errcode = '22023';
  end if;
  v_tsq := plainto_tsquery('simple', v_q);
  perform set_config('pg_trgm.similarity_threshold', '0.15', true);

  if p_viewer is not null then
    select coalesce(ugp.home_geo, public.listing_geo_from_city(ugp.home_city_id)),
           coalesce(ugp.default_radius_km, 25),
           coalesce(ugp.geo_weight, 1)
      into v_anchor, v_radius, v_geo_weight
      from public.user_geo_prefs ugp
     where ugp.user_id = p_viewer;
  end if;

  return query
  with cand as (
    -- Index-backed text candidates (listings_search_vector_gin_idx, listings_title_trgm_idx).
    select l.listing_id
      from public.listings l
     where l.status = 'open'
       and l.moderation_status = 'published'
       and (p_world_slug is null or l.world_slug = p_world_slug)
       and l.world_slug <> 'romantic_matchmaking'
       and (l.search_vector @@ v_tsq or l.title % v_q)
  ),
  base as (
    select l.*
      from cand c
      join public.listings l on l.listing_id = c.listing_id
     where public.is_listing_visible_to(l, p_viewer)
  ),
  fts as (
    select b.listing_id,
           row_number() over (order by ts_rank_cd(b.search_vector, v_tsq) desc, b.listing_id) as rnk
      from base b
     where b.search_vector @@ v_tsq
  ),
  trgm as (
    select b.listing_id,
           row_number() over (order by similarity(b.title, v_q) desc, b.listing_id) as rnk
      from base b
     where similarity(b.title, v_q) > 0.15
  ),
  vec as (
    select b.listing_id,
           row_number() over (order by ts_rank_cd(b.search_vector, v_tsq) desc, b.listing_id) as rnk
      from base b
     where b.embedding is not null
       and b.search_vector @@ v_tsq
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
             end desc, b.listing_id
           ) as rnk
      from base b
  ),
  fused as (
    select b.listing_id,
      round(
        coalesce(1.0 / (60 + f.rnk), 0) + coalesce(1.0 / (60 + t.rnk), 0)
          + coalesce(1.0 / (60 + v.rnk), 0) + coalesce(1.0 / (60 + g.rnk), 0),
        12
      ) as score,
      f.rnk::int as fts_rank, t.rnk::int as trgm_rank, v.rnk::int as vector_rank, g.rnk::int as geo_rank
    from base b
    left join fts f on f.listing_id = b.listing_id
    left join trgm t on t.listing_id = b.listing_id
    left join vec v on v.listing_id = b.listing_id
    left join geo g on g.listing_id = b.listing_id
    -- A text signal (FTS or trigram) is required; geo/vector only re-rank.
    where f.listing_id is not null or t.listing_id is not null
  )
  select fu.listing_id, fu.score, fu.fts_rank, fu.trgm_rank, fu.vector_rank, fu.geo_rank
    from fused fu
   where p_cursor_id is null
      or (fu.score, fu.listing_id) < (p_cursor_score, p_cursor_id)
   order by fu.score desc, fu.listing_id desc
   limit v_lim;
end;
$$;

revoke all on function public.search_listings(text, text, int, uuid, numeric, uuid) from public;
grant execute on function public.search_listings(text, text, int, uuid, numeric, uuid)
  to anon, authenticated, service_role;

create or replace function public.marketplace_search(
  p_query text default null,
  p_world_slug text default null,
  p_limit int default 20,
  p_viewer uuid default auth.uid(),
  p_cursor_score numeric default null,
  p_cursor_id uuid default null
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
    select * from public.search_listings(v_q, p_world_slug, p_limit, p_viewer, p_cursor_score, p_cursor_id);
    return;
  end if;

  -- Query-less: same shape as 0330 (clients browse with browse_listings instead).
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

revoke all on function public.marketplace_search(text, text, int, uuid, numeric, uuid) from public;
grant execute on function public.marketplace_search(text, text, int, uuid, numeric, uuid)
  to anon, authenticated, service_role;

alter function public.search_all(text, text[], integer) set search_path = public, extensions;

commit;
