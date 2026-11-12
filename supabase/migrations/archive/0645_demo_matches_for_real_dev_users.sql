-- 0645_demo_matches_for_real_dev_users | kc-dev: attach seed↔real-user match_candidates so
-- developers signed in as themselves (not @seed.kc.test) still see "מומלצים בשבילך".

begin;

create or replace function public.kc_dev_attach_demo_matches_for_active_users(p_per_user int default 8)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_n integer := 0;
begin
  if not exists (select 1 from public.kc_dev_demo_config) then
    return 0;
  end if;

  create temp table s_seed_give on commit drop as
  select l.listing_id, l.owner_id, l.category_id
    from public.listings l
   where public.is_demo_seed_user(l.owner_id)
     and l.world_slug = 'items' and l.direction = 'give'
     and l.status = 'open' and l.moderation_status = 'published';

  create temp table s_seed_request on commit drop as
  select l.listing_id, l.owner_id, l.category_id
    from public.listings l
   where public.is_demo_seed_user(l.owner_id)
     and l.world_slug = 'items' and l.direction = 'request'
     and l.status = 'open' and l.moderation_status = 'published';

  if not exists (select 1 from s_seed_give) or not exists (select 1 from s_seed_request) then
    return 0;
  end if;

  create temp table s_real on commit drop as
  select l.listing_id, l.owner_id, l.direction, l.category_id,
         row_number() over (partition by l.owner_id order by l.published_at desc nulls last, l.listing_id) as rn
    from public.listings l
   where not public.is_demo_seed_user(l.owner_id)
     and l.world_slug = 'items'
     and l.direction in ('give', 'request')
     and l.status = 'open'
     and l.moderation_status = 'published';

  with pairs as (
    select d.owner_id as dev_owner_id,
           case when d.direction = 'give' then d.listing_id else g.listing_id end as offer_listing_id,
           case when d.direction = 'give' then r.listing_id else d.listing_id end as request_listing_id,
           case when d.direction = 'give' then d.owner_id else g.owner_id end as offer_owner_id,
           case when d.direction = 'give' then r.owner_id else d.owner_id end as request_owner_id,
           abs(hashtext(d.listing_id::text || coalesce(g.listing_id, r.listing_id)::text)) as h,
           row_number() over (
             partition by d.owner_id
             order by md5(d.listing_id::text || coalesce(g.listing_id, r.listing_id)::text)
           ) as pair_rank
      from s_real d
      left join lateral (
        select r.*
          from s_seed_request r
         where d.direction = 'give' and r.owner_id <> d.owner_id
           and (d.category_id is not distinct from r.category_id)
         order by md5(r.listing_id::text || d.listing_id::text)
         limit p_per_user
      ) r on d.direction = 'give'
      left join lateral (
        select g.*
          from s_seed_give g
         where d.direction = 'request' and g.owner_id <> d.owner_id
           and (d.category_id is not distinct from g.category_id)
         order by md5(g.listing_id::text || d.listing_id::text)
         limit p_per_user
      ) g on d.direction = 'request'
     where d.rn <= 2
       and (
         (d.direction = 'give' and r.listing_id is not null)
         or (d.direction = 'request' and g.listing_id is not null)
       )
  ),
  ins as (
    insert into public.match_candidates (
      offer_listing_id, request_listing_id, offer_owner_id, request_owner_id,
      world_slug, score, components, distance_km, status,
      notified_offer_at, notified_request_at, llm_reason, computed_at
    )
    select p.offer_listing_id,
           p.request_listing_id,
           p.offer_owner_id,
           p.request_owner_id,
           'items',
           least(0.94, 0.52 + (p.h % 42)::numeric / 100),
           jsonb_build_object('category', 0.72, 'geo', 0.48, 'demo_seed', true, 'demo_dev_bridge', true),
           round(((p.h % 90) + 12)::numeric / 10, 1),
           'suggested',
           now() - interval '4 hours',
           now() - interval '4 hours',
           'התאמת דמו בין חשבון הפיתוח שלך למשתמשי הזרע',
           now() - interval '8 hours'
      from pairs p
     where p.pair_rank <= greatest(1, least(p_per_user, 12))
    on conflict on constraint match_candidates_pair_unique do nothing
    returning 1
  )
  select count(*)::int into v_n from ins;

  return v_n;
end;
$fn$;

comment on function public.kc_dev_attach_demo_matches_for_active_users(int) is
  'kc-dev only: pairs real (non-seed) users'' open items listings with opposite seed listings for match UI demos.';

revoke all on function public.kc_dev_attach_demo_matches_for_active_users(int) from public, anon, authenticated;
grant execute on function public.kc_dev_attach_demo_matches_for_active_users(int) to service_role;

-- Extend the seed match routine: always bridge real dev accounts when seed data exists.
create or replace function public.kc_dev_seed_demo_match_candidates()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_n integer := 0;
  v_bridge integer := 0;
begin
  if not exists (select 1 from public.kc_dev_demo_config) then
    return 0;
  end if;

  perform public.listing_upsert_from_post(p)
    from public.posts p
    join auth.users a on a.id = p.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and p.status = 'open'
     and not exists (select 1 from public.listings l where l.legacy_post_id = p.post_id);

  create temp table s_demo_give on commit drop as
  select l.listing_id, l.owner_id, l.category_id,
         row_number() over (partition by l.owner_id order by l.published_at desc nulls last, l.listing_id) as rn
    from public.listings l
    join auth.users a on a.id = l.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and l.world_slug = 'items' and l.direction = 'give'
     and l.status = 'open' and l.moderation_status = 'published';

  create temp table s_demo_request on commit drop as
  select l.listing_id, l.owner_id, l.category_id,
         row_number() over (partition by l.owner_id order by l.published_at desc nulls last, l.listing_id) as rn
    from public.listings l
    join auth.users a on a.id = l.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and l.world_slug = 'items' and l.direction = 'request'
     and l.status = 'open' and l.moderation_status = 'published';

  if exists (select 1 from s_demo_give) and exists (select 1 from s_demo_request) then
    with pairs as (
      select g.listing_id as offer_listing_id, r.listing_id as request_listing_id,
             g.owner_id as offer_owner_id, r.owner_id as request_owner_id,
             row_number() over (partition by g.owner_id order by md5(g.listing_id::text || r.listing_id::text)) as pair_rank,
             abs(hashtext(g.listing_id::text || r.listing_id::text)) as h
        from s_demo_give g
        join lateral (
          select r.* from s_demo_request r
           where r.owner_id <> g.owner_id and (g.category_id is not distinct from r.category_id)
           order by md5(r.listing_id::text || g.listing_id::text) limit 6
        ) r on true
       where g.rn = 1
    ),
    ins as (
      insert into public.match_candidates (
        offer_listing_id, request_listing_id, offer_owner_id, request_owner_id,
        world_slug, score, components, distance_km, status,
        offer_response, request_response, notified_offer_at, notified_request_at, llm_reason, computed_at
      )
      select p.offer_listing_id, p.request_listing_id, p.offer_owner_id, p.request_owner_id,
             'items', least(0.97, 0.48 + (p.h % 49)::numeric / 100),
             jsonb_build_object('category', 0.70, 'geo', 0.45, 'demo_seed', true),
             round(((p.h % 180) + 5)::numeric / 10, 1),
             case when p.h % 17 = 0 then 'accepted' else 'suggested' end,
             case when p.h % 11 = 0 then 'accepted' when p.h % 23 = 0 then 'declined' end,
             case when p.h % 13 = 0 then 'accepted' when p.h % 29 = 0 then 'declined' end,
             now() - ((p.h % 72) || ' hours')::interval, now() - ((p.h % 72) || ' hours')::interval,
             case when p.h % 5 = 0 then 'אותה קטגוריה ואזור דומה — נראה מתאים לדמו' end,
             now() - ((p.h % 96) || ' hours')::interval
        from pairs p where p.pair_rank <= 5
      on conflict on constraint match_candidates_pair_unique do nothing returning 1
    )
    select count(*)::int into v_n from ins;

    with pairs as (
      select r.listing_id as request_listing_id, g.listing_id as offer_listing_id,
             g.owner_id as offer_owner_id, r.owner_id as request_owner_id,
             abs(hashtext(r.listing_id::text || g.listing_id::text)) as h,
             row_number() over (partition by r.owner_id order by md5(r.listing_id::text || g.listing_id::text)) as pair_rank
        from s_demo_request r
        join lateral (
          select g.* from s_demo_give g
           where g.owner_id <> r.owner_id and (g.category_id is not distinct from r.category_id)
           order by md5(g.listing_id::text || r.listing_id::text) limit 6
        ) g on true
       where r.rn = 1
    ),
    ins2 as (
      insert into public.match_candidates (
        offer_listing_id, request_listing_id, offer_owner_id, request_owner_id,
        world_slug, score, components, distance_km, status,
        notified_offer_at, notified_request_at, llm_reason, computed_at
      )
      select p.offer_listing_id, p.request_listing_id, p.offer_owner_id, p.request_owner_id,
             'items', least(0.95, 0.50 + (p.h % 45)::numeric / 100),
             jsonb_build_object('category', 0.65, 'geo', 0.50, 'demo_seed', true),
             round(((p.h % 120) + 8)::numeric / 10, 1), 'suggested',
             now() - interval '6 hours', now() - interval '6 hours',
             'התאמת דמו — מבקש/ת פוגש/ת תורם/ת', now() - interval '12 hours'
        from pairs p where p.pair_rank <= 5
      on conflict on constraint match_candidates_pair_unique do nothing returning 1
    )
    select v_n + count(*)::int into v_n from ins2;
  end if;

  v_bridge := public.kc_dev_attach_demo_matches_for_active_users(8);
  return v_n + v_bridge;
end;
$fn$;

do $backfill$
declare v_added int;
begin
  if exists (select 1 from public.kc_dev_demo_config) then
    v_added := public.kc_dev_attach_demo_matches_for_active_users(8);
    raise notice '0645: dev-user demo matches attached: %', v_added;
  end if;
end $backfill$;

commit;
