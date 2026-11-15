-- 0260_matching_core | Issue #829
-- match_weights, listing_matches, match_feedback, match_runs, trust view, find_matches().

begin;

create table public.match_weights (
  weight_id   uuid primary key default gen_random_uuid(),
  world_slug  text references public.worlds(slug) on delete cascade,
  user_id     uuid references public.users(user_id) on delete cascade,
  w_vector    numeric(4, 3) not null default 0.350
    check (w_vector >= 0 and w_vector <= 1),
  w_fts       numeric(4, 3) not null default 0.250
    check (w_fts >= 0 and w_fts <= 1),
  w_geo       numeric(4, 3) not null default 0.250
    check (w_geo >= 0 and w_geo <= 1),
  w_trust     numeric(4, 3) not null default 0.150
    check (w_trust >= 0 and w_trust <= 1),
  created_at  timestamptz not null default now(),
  constraint match_weights_scope check (world_slug is not null or user_id is not null),
  constraint match_weights_sum check (
    w_vector + w_fts + w_geo + w_trust between 0.99 and 1.01
  )
);

create unique index match_weights_world_default_uidx
  on public.match_weights (world_slug) where user_id is null;

create unique index match_weights_world_user_uidx
  on public.match_weights (world_slug, user_id) where user_id is not null;

insert into public.match_weights (world_slug, user_id, w_vector, w_fts, w_geo, w_trust)
select w.slug, null, 0.350, 0.250, 0.250, 0.150
  from public.worlds w
 where not exists (
   select 1 from public.match_weights mw
    where mw.world_slug = w.slug and mw.user_id is null
 );

create table public.match_runs (
  run_id             uuid primary key default gen_random_uuid(),
  source_listing_id  uuid not null references public.listings(listing_id) on delete cascade,
  triggered_by       uuid references public.users(user_id),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  stats              jsonb not null default '{}'::jsonb
);

create table public.listing_matches (
  match_id               uuid primary key default gen_random_uuid(),
  run_id                 uuid references public.match_runs(run_id) on delete set null,
  listing_id             uuid not null references public.listings(listing_id) on delete cascade,
  candidate_listing_id   uuid not null references public.listings(listing_id) on delete cascade,
  score                  numeric(8, 5) not null,
  status                 text not null default 'suggested'
    check (status in ('suggested','operator_queue','dismissed','accepted')),
  created_at             timestamptz not null default now(),
  constraint listing_matches_ordered check (listing_id::text < candidate_listing_id::text),
  constraint listing_matches_pair_unique unique (listing_id, candidate_listing_id)
);

create index listing_matches_listing_idx on public.listing_matches (listing_id, created_at desc);
create index listing_matches_status_idx on public.listing_matches (status) where status = 'operator_queue';

create table public.match_feedback (
  feedback_id uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.listing_matches(match_id) on delete cascade,
  user_id     uuid not null references public.users(user_id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now(),
  constraint match_feedback_once unique (match_id, user_id)
);

create or replace view public.listing_owner_trust_score
with (security_invoker = true) as
select
  lo.owner_id as user_id,
  coalesce(avg(mf.rating) / 5.0, 0.5)::numeric(6, 4) as trust_score
from public.listings lo
left join public.listing_matches lm
  on lm.listing_id = lo.listing_id or lm.candidate_listing_id = lo.listing_id
left join public.match_feedback mf on mf.match_id = lm.match_id
group by lo.owner_id;

grant select on public.listing_owner_trust_score to authenticated, service_role;

alter table public.listings
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector(
      'simple',
      coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(details::text, '')
    )
  ) stored;

create index if not exists listings_search_vector_gin_idx
  on public.listings using gin (search_vector);

create or replace function public.resolve_match_weights(p_world text, p_user uuid)
returns table (w_vector numeric, w_fts numeric, w_geo numeric, w_trust numeric)
language sql
stable
set search_path = public
as $$
  select mw.w_vector, mw.w_fts, mw.w_geo, mw.w_trust
    from public.match_weights mw
   where mw.world_slug = p_world and mw.user_id = p_user
   union all
  select mw.w_vector, mw.w_fts, mw.w_geo, mw.w_trust
    from public.match_weights mw
   where mw.world_slug = p_world and mw.user_id is null
     and not exists (
       select 1 from public.match_weights u
        where u.world_slug = p_world and u.user_id = p_user
     )
   limit 1;
$$;

create or replace function public.find_matches(
  p_listing_id uuid,
  p_limit int default 20,
  p_viewer uuid default auth.uid()
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
volatile
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_src public.listings;
  v_run uuid;
  v_lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_w record;
  v_is_op boolean;
begin
  if p_viewer is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  select * into v_src from public.listings where listing_id = p_listing_id;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;

  v_is_op := public.is_listing_operator(p_viewer);
  if v_src.owner_id <> p_viewer and not v_is_op then
    raise exception 'not_listing_owner' using errcode = '42501';
  end if;

  if v_src.world_slug = 'romantic_matchmaking' then
    return;
  end if;

  if v_src.world_slug = 'rides' and v_src.legacy_ride_id is not null then
    return query
    select l.listing_id,
           1.0::numeric,
           0.5::numeric, 0.5::numeric, 0.9::numeric, 0.5::numeric,
           case when l.anonymity_level = 1 or v_src.anonymity_level = 1
                then 'operator_queue' else 'suggested' end
      from public.ride_listings_find_matches(v_src.legacy_ride_id, 12, v_lim) r
      join public.listings l on l.legacy_ride_id = r.ride_id
     where public.is_listing_visible_to(l, p_viewer)
       and ((l.anonymity_level > 1 and v_src.anonymity_level > 1) or v_is_op);
    return;
  end if;

  select * into v_w from public.resolve_match_weights(v_src.world_slug, p_viewer) limit 1;

  insert into public.match_runs (source_listing_id, triggered_by)
  values (p_listing_id, p_viewer)
  returning run_id into v_run;

  drop table if exists pg_temp._find_match_ranked;
  execute $sql$
    create temp table pg_temp._find_match_ranked on commit drop as
    with src as (select * from public.listings where listing_id = $1),
    geo_src as (select g.* from src s, lateral public.effective_geo(s, $2) g),
    candidates as (
      select c.* from public.listings c cross join src s
       where c.listing_id <> s.listing_id
         and c.world_slug = s.world_slug
         and c.direction <> s.direction
         and c.status = 'open' and c.moderation_status = 'published'
         and public.is_listing_visible_to(c, $2)
    ),
    scored as (
      select c.listing_id as cid,
        case when s.embedding is not null and c.embedding is not null
          then greatest(0, 1 - (s.embedding <=> c.embedding)) else 0.5 end as v_score,
        coalesce(ts_rank(c.search_vector, plainto_tsquery('simple', coalesce(s.title, ''))), 0) as f_score,
        coalesce((
          select case when gs.anchor_geo is null or gc.anchor_geo is null then 0.5
            when extensions.st_distance(gs.anchor_geo, gc.anchor_geo) / 1000.0
                 <= greatest(gs.radius_km, gc.radius_km, 1)
              then greatest(0, 1 - (extensions.st_distance(gs.anchor_geo, gc.anchor_geo) / 1000.0)
                / greatest(gs.radius_km, gc.radius_km, 1)) * ((gs.geo_weight + gc.geo_weight) / 2)
            else 0 end
          from geo_src gs, lateral public.effective_geo(c, $2) gc
        ), 0.5) as g_score,
        coalesce(ts.trust_score, 0.5) as t_score,
        case when c.anonymity_level = 1 or s.anonymity_level = 1 then 'operator_queue' else 'suggested' end as st
      from candidates c cross join src s
      left join public.listing_owner_trust_score ts on ts.user_id = c.owner_id
    )
    select cid,
      ($3 * v_score + $4 * f_score + $5 * g_score + $6 * t_score) as total,
      v_score, f_score, g_score, t_score, st
    from scored
  $sql$
  using p_listing_id, p_viewer,
    coalesce(v_w.w_vector, 0.350), coalesce(v_w.w_fts, 0.250),
    coalesce(v_w.w_geo, 0.250), coalesce(v_w.w_trust, 0.150);

  insert into public.listing_matches (run_id, listing_id, candidate_listing_id, score, status)
  select v_run, least(p_listing_id, cid), greatest(p_listing_id, cid), total, st
    from pg_temp._find_match_ranked
  on conflict (listing_id, candidate_listing_id) do update
    set score = excluded.score, status = excluded.status, run_id = excluded.run_id;

  update public.match_runs
     set finished_at = now(),
         stats = jsonb_build_object('stored', (select count(*) from pg_temp._find_match_ranked))
   where run_id = v_run;

  return query
  select cid, total::numeric, v_score::numeric, f_score::numeric,
         g_score::numeric, t_score::numeric, st::text
    from pg_temp._find_match_ranked
   where st = 'suggested' or v_is_op
   order by total desc
   limit v_lim;
end;
$$;

grant execute on function public.resolve_match_weights(text, uuid) to authenticated, service_role;
grant execute on function public.find_matches(uuid, int, uuid) to authenticated, service_role;

alter table public.match_weights enable row level security;
alter table public.match_runs enable row level security;
alter table public.listing_matches enable row level security;
alter table public.match_feedback enable row level security;

create policy match_weights_select on public.match_weights
  for select to authenticated using (true);

create policy match_weights_upsert_own on public.match_weights
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy match_runs_select on public.match_runs
  for select to authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.listing_id = match_runs.source_listing_id
         and (l.owner_id = auth.uid() or public.is_listing_operator(auth.uid()))
    )
  );

create policy listing_matches_select on public.listing_matches
  for select to authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.listing_id in (listing_matches.listing_id, listing_matches.candidate_listing_id)
         and (l.owner_id = auth.uid() or public.is_listing_operator(auth.uid()))
    )
  );

create policy match_feedback_select_own on public.match_feedback
  for select to authenticated using (user_id = auth.uid());

create policy match_feedback_insert_own on public.match_feedback
  for insert to authenticated with check (user_id = auth.uid());

commit;
