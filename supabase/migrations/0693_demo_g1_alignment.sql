-- 0693_demo_g1_alignment | #1964: align kc-dev demo seed/wipe/KPIs with G1 (posts, ride_post_details, post_handoffs).

begin;

-- Toggle bulk-seed write caps: G1 uses posts + post_handoffs; legacy listings/giving_handoffs triggers may be absent.
create or replace function public.kc_dev_seed_rate_limits(p_enable boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := case when p_enable then 'enable' else 'disable' end;
begin
  if exists (
    select 1 from pg_trigger t
     where t.tgname = 'posts_rate_limit' and t.tgrelid = 'public.posts'::regclass
  ) then
    execute format('alter table public.posts %s trigger posts_rate_limit', v_action);
  end if;
  if exists (
    select 1 from pg_trigger t
     where t.tgname = 'post_handoffs_rate_limit' and t.tgrelid = 'public.post_handoffs'::regclass
  ) then
    execute format('alter table public.post_handoffs %s trigger post_handoffs_rate_limit', v_action);
  end if;
  if exists (
    select 1 from pg_trigger t
     where t.tgname = 'follow_edges_rate_limit' and t.tgrelid = 'public.follow_edges'::regclass
  ) then
    execute format('alter table public.follow_edges %s trigger follow_edges_rate_limit', v_action);
  end if;
  -- Pre-G1 compatibility (no-op when dropped or renamed)
  if exists (
    select 1 from pg_trigger t
     where t.tgname = 'listings_rate_limit' and t.tgrelid = 'public.listings'::regclass
  ) then
    execute format('alter table public.listings %s trigger listings_rate_limit', v_action);
  end if;
  if exists (
    select 1 from pg_trigger t
     where t.tgname = 'giving_handoffs_rate_limit'
       and t.tgrelid in ('public.giving_handoffs'::regclass, 'public.post_handoffs'::regclass)
  ) then
    execute format(
      'alter table %s %s trigger giving_handoffs_rate_limit',
      (select quote_ident(ns.nspname) || '.' || quote_ident(c.relname)
         from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
        where c.oid = (
          select t.tgrelid from pg_trigger t where t.tgname = 'giving_handoffs_rate_limit' limit 1
        )),
      v_action
    );
  end if;
end;
$$;

revoke all on function public.kc_dev_seed_rate_limits(boolean) from public, anon, authenticated;
grant execute on function public.kc_dev_seed_rate_limits(boolean) to service_role;

create or replace function public.kc_dev_seed_phase_social()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
begin
  drop table if exists s_users, s_chats; -- migration-safety: allow — session temp tables from a previous step
  create temp table s_users on commit drop as
  select au.id from auth.users au
   where au.email like '%@seed.kc.test'
     and coalesce(au.raw_app_meta_data->>'seed', '') = 'true';

  insert into public.follow_edges (follower_id, followed_id, created_at)
  select distinct on (a.id,b.id) a.id, b.id, now() - (random()*90||' days')::interval
  from generate_series(1,1500) g
  cross join lateral (select id from s_users order by random()+g*0 limit 1) a
  cross join lateral (select id from s_users order by random()+g*0 limit 1) b
  where a.id<>b.id on conflict do nothing;

  insert into public.saved_posts (user_id, post_id, saved_at)
  select distinct on (u.id,p.post_id) u.id, p.post_id, now()
  from generate_series(1,400) g
  cross join lateral (select id from s_users order by random()+g*0 limit 1) u
  cross join lateral (
    select post_id from public.posts
     where owner_id in (select id from s_users) and status='open'
     order by random()+g*0 limit 1
  ) p on conflict do nothing;

  alter table public.messages disable trigger messages_rate_limit;
  create temp table s_chats on commit drop as
  select distinct on (least(p.owner_id,u.id), greatest(p.owner_id,u.id)) gen_random_uuid() chat_id,
    least(p.owner_id,u.id) a, greatest(p.owner_id,u.id) b, p.post_id, p.owner_id, u.id asker, p.title
  from generate_series(1,150) g
  cross join lateral (
    select * from public.posts where owner_id in (select id from s_users) order by random()+g*0 limit 1
  ) p
  cross join lateral (select id from s_users where id<>p.owner_id order by random()+g*0 limit 1) u;
  insert into public.chats (chat_id, participant_a, participant_b, anchor_post_id, created_at)
  select chat_id, a, b, post_id, now() - interval '3 days' from s_chats;
  insert into public.messages (chat_id, sender_id, kind, body, status, created_at, delivered_at, read_at, source_language)
  select c.chat_id, case when k%2=1 then c.asker else c.owner_id end, 'user',
    (array['היי, זה עדיין רלוונטי?','כן, עדיין זמין 🙂','מתי נוח לך לאסוף?','אפשר מחר אחרי 17:00?','מעולה, אני שולח/ת כתובת מדויקת','תודה רבה!!'])[k],
    'read', now() - ((7-k)||' hours')::interval, now() - ((7-k)||' hours')::interval,
    now() - ((7-k)||' hours')::interval + interval '1 minute', 'he'
  from s_chats c cross join generate_series(1,6) k;
  alter table public.messages enable trigger messages_rate_limit;
end;
$$;

create or replace function public.kc_dev_seed_with_caps_off(p_phase text, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_sub text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_world jsonb;
  v_match integer;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  if p_phase = 'users' then
    perform public.kc_dev_seed_rate_limits(false);
  end if;
  case p_phase
    when 'users' then
      perform public.kc_dev_seed_phase_users(p_hash);
      perform public.kc_dev_seed_demo_user_profiles();
    when 'items' then
      perform public.kc_dev_seed_phase_items();
      perform public.kc_dev_seed_demo_post_media();
    when 'worlds' then
      v_world := public.kc_dev_seed_demo_world_content();
      perform public.kc_dev_seed_demo_verification_mix();
    when 'social' then
      perform public.kc_dev_seed_phase_social();
      perform public.kc_dev_seed_demo_reports();
      perform public.kc_dev_seed_rate_limits(true);
    when 'matches' then v_match := public.kc_dev_seed_demo_match_candidates();
    when 'orgs' then perform public.kc_dev_seed_phase_orgs();
    else raise exception 'demo_seed_invalid_phase' using errcode = '22023';
  end case;
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('request.jwt.claim.sub', v_sub, true);
  return jsonb_build_object('world', v_world, 'match_candidates', v_match);
end;
$$;

-- Rides: posts + ride_post_details (posts_sync_post_details); no listings mirror after G1.
create or replace function public.kc_dev_seed_demo_rides()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  v_offer_kind uuid;
  v_request_kind uuid;
begin
  select kind_id into v_offer_kind from public.listing_kinds
   where world_slug = 'rides' and slug = 'ride_offer' and is_active limit 1;
  select kind_id into v_request_kind from public.listing_kinds
   where world_slug = 'rides' and slug = 'ride_request' and is_active limit 1;
  if v_offer_kind is null or v_request_kind is null then
    return;
  end if;

  insert into public.posts (
    post_id, owner_id, type, status, visibility, title, description, category, city,
    street, street_number, location_display_level, world_slug, direction, post_type,
    details, kind_id, moderation_status, published_at, expires_at, availability_status, geo,
    source_language
  )
  select
    gen_random_uuid(),
    u.id,
    case when m.mode = 'request' then 'Request' else 'Give' end,
    'open',
    'Public',
    case when m.mode = 'offer'
      then left('נוסע/ת מ' || o.name_he || ' ל' || d.name_he, 80)
      else left('מחפש/ת טרמפ מ' || o.name_he || ' ל' || d.name_he, 80)
    end,
    (array['יוצא/ת בבוקר, אפשר לעצור בדרך', 'חזרה בערב', 'יש מקום לתיק קטן', null])[1 + floor(random() * 4)::int],
    'Other',
    coalesce(u.city, o.city_id),
    'Marketplace', '1', 'CityOnly',
    'rides',
    case when m.mode = 'request' then 'request' else 'offer' end,
    'ride',
    jsonb_strip_nulls(jsonb_build_object(
      'origin_label', o.name_he,
      'dest_label', d.name_he,
      'origin_city_id', o.city_id,
      'dest_city_id', d.city_id,
      'origin_lat', o.lat,
      'origin_lng', o.lon,
      'dest_lat', d.lat,
      'dest_lng', d.lon,
      'departs_at', to_char(dep.v_dep at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'seats_available', case when m.mode = 'offer' then 1 + floor(random() * 4)::int end,
      'passengers', case when m.mode = 'request' then 1 end,
      'reward_model', case when m.mode = 'offer' and g % 2 = 0 then 'free'
                           when m.mode = 'offer' then 'expense_share' end
    )),
    case when m.mode = 'request' then v_request_kind else v_offer_kind end,
    'published',
    now(),
    dep.v_dep + interval '72 hours',
    'ongoing',
    public.listing_geo_from_city(o.city_id),
    'he'
  from generate_series(1, 120) g
  cross join lateral (
    select case when g % 3 = 0 then 'request' else 'offer' end as mode
  ) m
  cross join lateral (
    select now() + ((random() * 14) || ' days')::interval as v_dep
  ) dep
  cross join lateral (
    select * from (
      select au.id, pu.city, (substring(au.email from 'user([0-9]+)@'))::int as i
        from auth.users au
        join public.users pu on pu.user_id = au.id
       where au.email like '%@seed.kc.test'
         and coalesce(au.raw_app_meta_data->>'seed', '') = 'true'
    ) su
   where m.mode = 'request' or su.i % 3 = 0
   order by md5(su.id::text || g::text)
   limit 1
  ) u
  cross join lateral (
    select c.city_id, c.name_he, c.lat, c.lon from public.cities c
     where c.city_id in (
       '3000','5000','4000','8300','9000','7900','7100','7400','2600','6400','70','8400',
       '8600','6500','6600','6900','1200','7000','9700','2610','8800','7300')
   order by md5(c.city_id || g::text)
   limit 1
  ) o
  cross join lateral (
    select c.city_id, c.name_he, c.lat, c.lon from public.cities c
     where c.city_id in (
       '3000','5000','4000','8300','9000','7900','7100','7400','2600','6400','70','8400',
       '8600','6500','6600','6900','1200','7000','9700','2610','8800','7300')
       and c.city_id <> o.city_id
   order by md5(c.city_id || g::text || 'd')
   limit 1
  ) d;
end;
$$;

comment on function public.kc_dev_seed_demo_rides() is
  'kc-dev only: ~120 demo ride offers/requests on public.posts (rides world); ride_post_details via posts_sync_post_details (G1).';

create or replace function public.admin_demo_data_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_users integer;
  v_orgs  integer;
  v_ride_posts integer;
  v_item_posts integer;
  v_legacy_rides integer;
  v_org_memberships integer;
  v_post_media integer;
  v_chats integer;
  v_reports integer;
  v_open_reports integer;
  v_cfg   public.kc_dev_demo_config;
begin
  if not public.can_manage_demo_data(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_cfg from public.kc_dev_demo_config;

  select count(*) into v_users
    from auth.users u
   where u.email like '%@seed.kc.test'
     and coalesce(u.raw_app_meta_data->>'seed', '') = 'true';

  select count(*) into v_orgs
    from public.organizations o
   where o.verification_method = 'demo_seed';

  select count(*) into v_ride_posts
    from public.posts p
    join auth.users a on a.id = p.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and p.world_slug = 'rides'
     and p.post_type = 'ride';

  select count(*) into v_item_posts
    from public.posts p
    join auth.users a on a.id = p.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and coalesce(p.world_slug, '') <> 'rides';

  -- G1: ride posts missing ride_post_details (should be 0 after a full seed on current schema).
  select count(*) into v_legacy_rides
    from public.posts p
    join auth.users a on a.id = p.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and p.world_slug = 'rides'
     and p.post_type = 'ride'
     and not exists (
       select 1 from public.ride_post_details r where r.post_id = p.post_id);

  select count(*) into v_org_memberships
    from public.org_memberships m
    join public.organizations o on o.org_id = m.org_id
   where o.verification_method = 'demo_seed';

  select count(*) into v_post_media
    from public.media_assets ma
    join public.posts p on p.post_id = ma.post_id
    join auth.users a on a.id = p.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and ma.path like 'demo/kc-dev/%';

  select count(*) into v_chats
    from public.chats c
   where c.participant_a in (
           select id from auth.users where email like '%@seed.kc.test'
             and coalesce(raw_app_meta_data->>'seed', '') = 'true')
      or c.participant_b in (
           select id from auth.users where email like '%@seed.kc.test'
             and coalesce(raw_app_meta_data->>'seed', '') = 'true');

  select count(*) into v_reports
    from public.reports r
   where r.reporter_id in (
           select id from auth.users where email like '%@seed.kc.test'
             and coalesce(raw_app_meta_data->>'seed', '') = 'true')
      or (r.target_type = 'user' and r.target_id in (
           select id from auth.users where email like '%@seed.kc.test'
             and coalesce(raw_app_meta_data->>'seed', '') = 'true'));

  select count(*) into v_open_reports
    from public.reports r
   where r.status = 'open'
     and (
       r.reporter_id in (select id from auth.users where email like '%@seed.kc.test'
                           and coalesce(raw_app_meta_data->>'seed', '') = 'true')
       or (r.target_type = 'user' and r.target_id in (
             select id from auth.users where email like '%@seed.kc.test'
               and coalesce(raw_app_meta_data->>'seed', '') = 'true'))
     );

  return jsonb_build_object(
    'demo_users', v_users,
    'demo_organizations', v_orgs,
    'demo_ride_posts', v_ride_posts,
    'demo_item_posts', v_item_posts,
    'demo_legacy_ride_listings', v_legacy_rides,
    'demo_org_memberships', v_org_memberships,
    'demo_post_media', v_post_media,
    'demo_chats', v_chats,
    'demo_reports', v_reports,
    'demo_open_reports', v_open_reports,
    'can_seed', v_cfg.singleton is not null,
    'has_saved_password', v_cfg.password_hash is not null);
end;
$$;

comment on function public.admin_demo_data_status() is
  'FR-ADMIN-031: demo inventory on G1 schema (posts, ride_post_details gaps, post handoffs, moderation). Super admin or platform org admin only.';

commit;
