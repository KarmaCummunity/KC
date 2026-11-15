-- 0304_api_bot_contract | Issue #846
-- MCP-facing api_* wrappers: search, matches, ER dedupe, admin review list/resolve.

begin;

create or replace function public.api_bot_admin_review_list(
  p_limit int default 50
)
returns table (
  review_id uuid,
  extraction_id uuid,
  listing_id uuid,
  reason text,
  status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.review_id, r.extraction_id, r.listing_id, r.reason, r.status, r.created_at
    from public.bot_admin_review_items r
   where r.status = 'pending'
   order by r.created_at asc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.api_bot_admin_review_resolve(
  p_review_id uuid,
  p_status text,
  p_reviewer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if not public.is_listing_operator(p_reviewer_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.bot_admin_review_items
     set status = p_status,
         reviewer_id = p_reviewer_id,
         resolved_at = now()
   where review_id = p_review_id and status = 'pending';

  if not found then
    raise exception 'review_not_found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.api_bot_find_matches(
  p_owner_id uuid,
  p_listing_id uuid,
  p_limit int default 20
)
returns table (
  candidate_listing_id uuid,
  score numeric,
  vector_score numeric,
  fts_score numeric,
  geo_score numeric,
  trust_score numeric,
  match_status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_owner_id is null then
    raise exception 'owner_id_required' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.listings l
     where l.listing_id = p_listing_id and l.owner_id = p_owner_id
  ) then
    raise exception 'not_listing_owner' using errcode = '42501';
  end if;

  return query
  select * from public.find_matches(p_listing_id, p_limit, p_owner_id);
end;
$$;

create or replace function public.api_bot_search_listings(
  p_owner_id uuid,
  p_query text,
  p_world_slug text default null,
  p_limit int default 20
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
set search_path = public
as $$
begin
  if p_owner_id is null then
    raise exception 'owner_id_required' using errcode = '22023';
  end if;

  return query
  select * from public.search_listings(p_query, p_world_slug, p_limit, p_owner_id);
end;
$$;

create or replace function public.api_bot_find_duplicate_listings(
  p_title text,
  p_world_slug text,
  p_min_similarity numeric default 0.55,
  p_limit int default 5
)
returns table (
  listing_id uuid,
  similarity_score numeric,
  title text,
  owner_id uuid
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select l.listing_id,
         similarity(l.title, p_title)::numeric as similarity_score,
         l.title,
         l.owner_id
    from public.listings l
   where l.world_slug = p_world_slug
     and l.status = 'open'
     and l.moderation_status in ('published', 'pending_review')
     and similarity(l.title, p_title) >= coalesce(p_min_similarity, 0.55)
   order by similarity(l.title, p_title) desc
   limit least(greatest(coalesce(p_limit, 5), 1), 20);
$$;

create or replace function public.api_bot_register_er_candidate(
  p_listing_id_a uuid,
  p_listing_id_b uuid,
  p_score numeric,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_a uuid;
  v_actor_b uuid;
  v_cand uuid;
  v_tmp uuid;
begin
  if p_listing_id_a = p_listing_id_b then
    raise exception 'same_listing' using errcode = '22023';
  end if;

  select actor_id into v_actor_a from public.marketplace_actors where listing_id = p_listing_id_a limit 1;
  if v_actor_a is null then
    insert into public.marketplace_actors (actor_type, display_name, listing_id)
    select 'person', l.title, l.listing_id from public.listings l where l.listing_id = p_listing_id_a
    returning actor_id into v_actor_a;
  end if;

  select actor_id into v_actor_b from public.marketplace_actors where listing_id = p_listing_id_b limit 1;
  if v_actor_b is null then
    insert into public.marketplace_actors (actor_type, display_name, listing_id)
    select 'person', l.title, l.listing_id from public.listings l where l.listing_id = p_listing_id_b
    returning actor_id into v_actor_b;
  end if;

  if v_actor_a is null or v_actor_b is null then
    raise exception 'actor_missing' using errcode = 'P0002';
  end if;

  if v_actor_a::text > v_actor_b::text then
    v_tmp := v_actor_a;
    v_actor_a := v_actor_b;
    v_actor_b := v_tmp;
  end if;

  insert into public.er_candidates (actor_a, actor_b, score, reason)
  values (v_actor_a, v_actor_b, p_score, coalesce(p_reason, 'bot_dedupe'))
  returning candidate_id into v_cand;

  return v_cand;
end;
$$;

comment on function public.api_whatsapp_ingest_inbound is 'Bot contract (#846): idempotent WhatsApp inbound → raw_records';
comment on function public.api_bot_publish_listing is 'Bot contract (#846): publish listing from confirmed session';
comment on function public.api_bot_find_matches is 'Bot contract (#846): find_matches wrapper for service bot';
comment on function public.api_bot_search_listings is 'Bot contract (#846): search_listings wrapper for service bot';

grant execute on function public.api_bot_admin_review_list(int) to service_role;
grant execute on function public.api_bot_admin_review_resolve(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.api_bot_find_matches(uuid, uuid, int) to service_role;
grant execute on function public.api_bot_search_listings(uuid, text, text, int) to service_role;
grant execute on function public.api_bot_find_duplicate_listings(text, text, numeric, int) to service_role;
grant execute on function public.api_bot_register_er_candidate(uuid, uuid, numeric, text) to service_role;

commit;
