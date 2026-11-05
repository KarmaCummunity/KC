-- 0632_g1_search_on_posts | G1 step 6a-5g (ADR-006, D-214, issue #1671): search and the similar
-- listings read the post of a post-owned listing.
--
-- Same rule as 0629–0631: a post-owned listing (origin 'native' with legacy_post_id: food, rides,
-- housing, time since 0554) is checked with post_listing_visible_to (0628) and takes the fields
-- both syncs keep equal from its post; every other shape keeps reading the listing.
--   1. search_listings (0411)  the index-backed candidates (search_vector @@, title %) and their
--      status / moderation / world filters stay on the listing; visibility and the geo signal of
--      the ranking come from the post
--   2. marketplace_search (0411)  the query-less branch checks visibility on the post; its order
--      stays the listing's (urgency, created_at), the index it walks, and equals the post's by sync;
--      with a query it delegates to 1 as before
--   3. similar_listings (0336)  the kind that ranks a candidate, its world, publication time and
--      visibility come from the post; the world filter stays on the listing
-- The text that is searched and ranked (search_vector, title) stays the listing's, as title and
-- summary do (see 0630 on posts made post-owned by the 0554 backfill), so no index changes. The
-- embedding stays on the listing and the vector signal with it, until 6a-6 moves the embed worker.
-- Output is byte-identical to the pre-0632 bodies, which the test uses as oracles. Names,
-- arguments, return shapes and grants are unchanged; changed lines carry `-- 0632`.

begin;

-- ── 1. search_listings (0411) ───────────────────────────────────────────────────────────────────
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
    select l.*,
           case when p.post_id is null then l.geo else p.geo end as record_geo           -- 0632: the post's
      from cand c
      join public.listings l on l.listing_id = c.listing_id
      -- 0632: the post of a post-owned listing (food, rides, housing, time; 0554), the record.
      left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native'    -- 0632
     where (case when p.post_id is null then public.is_listing_visible_to(l, p_viewer)    -- 0632
                 else public.post_listing_visible_to(p, p_viewer) end)                   -- 0632
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
               when v_anchor is null or b.record_geo is null then 0.5 -- 0632
               else greatest(
                 0,
                 1 - (extensions.st_distance(v_anchor, b.record_geo) / 1000.0) / greatest(v_radius, 1) -- 0632
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

-- ── 2. marketplace_search (0411) ────────────────────────────────────────────────────────────────
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
  -- 0632: the post of a post-owned listing (food, rides, housing, time; 0554), the record.
  left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native'        -- 0632
  where l.status = 'open'
    and l.moderation_status = 'published'
    and l.world_slug <> 'romantic_matchmaking'
    and (p_world_slug is null or l.world_slug = p_world_slug)
    and (case when p.post_id is null then public.is_listing_visible_to(l, p_viewer)        -- 0632
              else public.post_listing_visible_to(p, p_viewer) end)                       -- 0632
  order by l.urgency_level desc, l.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke all on function public.marketplace_search(text, text, int, uuid, numeric, uuid) from public;
grant execute on function public.marketplace_search(text, text, int, uuid, numeric, uuid)
  to anon, authenticated, service_role;

-- ── 3. similar_listings (0336) ──────────────────────────────────────────────────────────────────
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
    select l.world_slug, coalesce(p.kind_id, l.kind_id) as kind_id, l.search_vector -- 0632: the post's kind
      from public.listings l
      left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native' -- 0632
     where l.listing_id = p_listing_id
       and l.status = 'open'
       and l.moderation_status = 'published'
  )
  select
    l.listing_id,
    l.title,
    case when p.post_id is null then l.world_slug else p.world_slug end,                  -- 0632
    lk.slug as kind_slug
  from public.listings l
  -- 0632: the post of a post-owned listing (food, rides, housing, time; 0554), the record.
  left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native'        -- 0632
  join public.listing_kinds lk on lk.kind_id = coalesce(p.kind_id, l.kind_id)            -- 0632
  cross join base b
  where l.listing_id <> p_listing_id
    and l.status = 'open'
    and l.moderation_status = 'published'
    and l.world_slug = b.world_slug
    and (case when p.post_id is null then public.is_listing_visible_to(l, auth.uid())     -- 0632
              else public.post_listing_visible_to(p, auth.uid()) end)                     -- 0632
  order by
    case when coalesce(p.kind_id, l.kind_id) = b.kind_id then 0 else 1 end,              -- 0632
    case when p.post_id is null then l.published_at else p.published_at end desc nulls last -- 0632
  limit least(greatest(coalesce(p_limit, 6), 1), 12);
$$;

revoke all on function public.similar_listings(uuid, int) from public;
grant execute on function public.similar_listings(uuid, int) to anon, authenticated;

commit;
