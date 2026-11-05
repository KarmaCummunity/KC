-- 0633_g1_post_embeddings | G1 step 6a-6a (ADR-006, D-214, issue #1671): a post's embedding lives
-- on the post side.
--
--   1. post_embeddings (new)  one embedding per post (vector(1536), the model that made it), with
--      the HNSW cosine index listings carries (0244). Internal: RLS on, no client policy, no client
--      grant; the embed worker and the search functions reach it as service_role / definer.
--   2. backfill  a copy, not a re-embedding: the embedding of every post-owned listing (origin
--      'native' with legacy_post_id: food, rides, housing, time since 0554) moves to its post. The
--      listing keeps its column until 6d.
--   3. listing_embedding_of (new, internal)  the embedding a listing ranks on: for a post-owned
--      listing its post's when the post has one, else the listing's; for every other shape (mirrors
--      of listing-sourced listings, items, v1 rides) the listing's.
--   4. search_listings / marketplace_search (0632)  the vector signal reads 3. With embeddings only
--      on listings the output is unchanged; a post-owned listing whose post has an embedding now
--      counts in the vector lane even when the listing has none.
-- The embed worker (TD-269, a stub that never runs) still targets listings; it moves to
-- post_embeddings in a later 6a-6 step, as do the other embedding readers (matching). Bodies are
-- the latest definitions copied verbatim; changed lines carry `-- 0633`. Names, arguments, return
-- shapes and grants of the existing functions are unchanged.

begin;

-- ── 1. The table ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.post_embeddings (
  post_id         uuid primary key references public.posts(post_id) on delete cascade,
  embedding       extensions.vector(1536) not null,
  embedding_model text not null,
  updated_at      timestamptz not null default now()
);

comment on table public.post_embeddings is
  'G1 (0633): the semantic embedding of a post (the record), written by the embed worker; read through listing_embedding_of by search. Internal: service_role and definer functions only.';

create index if not exists post_embeddings_embedding_hnsw_idx
  on public.post_embeddings using hnsw (embedding extensions.vector_cosine_ops);

drop trigger if exists post_embeddings_set_updated_at on public.post_embeddings;
create trigger post_embeddings_set_updated_at
  before update on public.post_embeddings
  for each row execute function public.set_updated_at();

alter table public.post_embeddings enable row level security;
-- Explicit deny-all policy (the RLS lint wants every table to carry one): clients never read or
-- write this table; only SECURITY DEFINER functions and the service role do (as 0591).
drop policy if exists post_embeddings_deny_all on public.post_embeddings;
create policy post_embeddings_deny_all on public.post_embeddings
  for all to anon, authenticated
  using (false) with check (false);
revoke all on public.post_embeddings from public, anon, authenticated;
grant all on public.post_embeddings to service_role;

-- ── 2. Backfill: a post-owned listing's embedding moves to its post ─────────────────────────────
insert into public.post_embeddings (post_id, embedding, embedding_model, updated_at)
select l.legacy_post_id, l.embedding, coalesce(l.embedding_model, 'text-embedding-3-small'), l.updated_at
  from public.listings l
  join public.posts p on p.post_id = l.legacy_post_id
 where l.origin = 'native'
   and l.legacy_post_id is not null
   and l.embedding is not null
on conflict (post_id) do nothing;

-- ── 3. The embedding a listing ranks on ─────────────────────────────────────────────────────────
create or replace function public.listing_embedding_of(p_listing public.listings)
returns extensions.vector
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when p_listing.origin = 'native' and p_listing.legacy_post_id is not null then
      coalesce((select pe.embedding from public.post_embeddings pe where pe.post_id = p_listing.legacy_post_id),
               p_listing.embedding)
    else p_listing.embedding
  end;
$$;

comment on function public.listing_embedding_of(public.listings) is
  'G1 (0633): the embedding a listing ranks on — its post''s (post_embeddings) for a post-owned listing when the post has one, else the listing''s.';

revoke all on function public.listing_embedding_of(public.listings) from public, anon, authenticated;
grant execute on function public.listing_embedding_of(public.listings) to service_role;

-- ── 4. search_listings (0632) ───────────────────────────────────────────────────────────────────
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
           case when p.post_id is null then l.geo else p.geo end as record_geo,          -- 0632: the post's
           public.listing_embedding_of(l) as record_embedding                            -- 0633: the post's when it has one
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
     where b.record_embedding is not null -- 0633
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

-- ── 5. marketplace_search (0632) ────────────────────────────────────────────────────────────────
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
    case when public.listing_embedding_of(l) is not null then 1 else null end, -- 0633
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

commit;
