-- 0676_demo_seed_rides_on_posts | #1964 / #1699 (TD-272): demo rides on public.posts + listings
-- (feed-visible after G1 step 6c), not the legacy ride_listings table. Wipe/restore unchanged in scope.

begin;

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
  -- migration-safety: allow — dev-only seed helper; missing kinds means nothing to insert
    return;
  end if;

  insert into public.posts (
    post_id, owner_id, type, status, visibility, title, description, category, city,
    street, street_number, location_display_level, world_slug, direction, post_type,
    details, kind_id, moderation_status, published_at, expires_at, availability_status, geo,
    listing_world_slug, source_language
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
    jsonb_build_object(
      'origin_place_kind', 'city', 'origin_place_id', o.city_id, 'origin_label', o.name_he,
      'dest_place_kind', 'city', 'dest_place_id', d.city_id, 'dest_label', d.name_he,
      'dest_city_id', d.city_id,
      'departs_at', to_char(dep.v_dep at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'seats_available', case when m.mode = 'offer' then 1 + floor(random() * 4)::int end,
      'passengers', case when m.mode = 'request' then 1 end,
      'reward_model', case when g % 2 = 0 then 'free' else 'expense_share' end
    ),
    case when m.mode = 'request' then v_request_kind else v_offer_kind end,
    'published',
    now(),
    dep.v_dep + interval '72 hours',
    'ongoing',
    public.listing_geo_from_city(o.city_id),
    'rides',
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
    select c.city_id, c.name_he from public.cities c
     where c.city_id in (
       '3000','5000','4000','8300','9000','7900','7100','7400','2600','6400','70','8400',
       '8600','6500','6600','6900','1200','7000','9700','2610','8800','7300')
   order by md5(c.city_id || g::text)
   limit 1
  ) o
  cross join lateral (
    select c.city_id, c.name_he from public.cities c
     where c.city_id in (
       '3000','5000','4000','8300','9000','7900','7100','7400','2600','6400','70','8400',
       '8600','6500','6600','6900','1200','7000','9700','2610','8800','7300')
       and c.city_id <> o.city_id
   order by md5(c.city_id || g::text || 'd')
   limit 1
  ) d;

  insert into public.listings (
    listing_id, owner_id, world_slug, kind_id, direction, title, summary, details,
    city_id, geo, status, visibility, anonymity_level, origin, moderation_status,
    published_at, expires_at, legacy_post_id
  )
  select
    gen_random_uuid(),
    p.owner_id,
    'rides',
    p.kind_id,
    case when p.direction = 'request' then 'request' else 'give' end,
    p.title,
    left(coalesce(p.description, ''), 200),
    p.details,
    p.city,
    p.geo,
    'open',
    'Public',
    public.visibility_to_anonymity_level('Public'),
    'native',
    'published',
    p.published_at,
    p.expires_at,
    p.post_id
  from public.posts p
  join auth.users a on a.id = p.owner_id
 where p.world_slug = 'rides'
   and p.post_type = 'ride'
   and a.email like '%@seed.kc.test'
   and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
   and not exists (
     select 1 from public.listings l where l.legacy_post_id = p.post_id
   );

  update public.posts p
     set legacy_listing_id = l.listing_id,
         listing_id = l.listing_id,
         listing_world_slug = 'rides'
    from public.listings l
   where l.legacy_post_id = p.post_id
     and p.world_slug = 'rides'
     and p.legacy_listing_id is null;
end;
$$;

comment on function public.kc_dev_seed_demo_rides() is
  'kc-dev only: ~120 demo ride offers/requests as public.posts (rides world) plus matching listings for matching v2.';

revoke all on function public.kc_dev_seed_demo_rides() from public, anon, authenticated;
grant execute on function public.kc_dev_seed_demo_rides() to service_role;

-- Items + rides (uses live seed users from auth)
create or replace function public.kc_dev_seed_phase_items()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
begin
  drop table if exists s_users, s_city, s_items, s_posts; -- migration-safety: allow — session temp tables from a previous step
  create temp table s_users on commit drop as
  select au.id,
         (substring(au.email from 'user([0-9]+)@'))::int as i,
         pu.city
    from auth.users au
    join public.users pu on pu.user_id = au.id
   where au.email like '%@seed.kc.test'
     and coalesce(au.raw_app_meta_data->>'seed', '') = 'true';

  create temp table s_city as
    select c.city_id, c.name_he from public.cities c
     where c.city_id in ('3000','5000','4000','8300','9000','7900','7100','7400','2600','6400','70','8400','8600','6500','6600','6900','1200','7000','9700','2610','8800','7300');

  create temp table s_items(cat text, title text, descr text) on commit drop;
  insert into s_items values
  ('Furniture','ספה תלת מושבית','ספה אפורה במצב טוב, צריך להגיע עם עוד מישהו להרים'),
  ('Furniture','שולחן אוכל עם 4 כיסאות','עץ מלא, קצת שריטות'),
  ('Furniture','ארון בגדים 3 דלתות','מפורק ומוכן לאיסוף'),
  ('Clothing','שקית בגדי תינוק 0-6 חודשים','נקי ומקופל, בנים'),
  ('Clothing','מעיל חורף מידה L','כמעט לא נלבש'),
  ('Books','ספרי לימוד לכיתה ה','סט מלא, מחברות לא כלולות'),
  ('Books','ספרי קריאה לילדים','כ-30 ספרים בעברית'),
  ('Toys','לגו מעורב','קופסה גדולה של לגו'),
  ('BabyGear','עגלת תינוק','עגלה מתקפלת, נקייה'),
  ('BabyGear','מיטת תינוק','כולל מזרן'),
  ('Kitchen','סט סירים','5 סירים נירוסטה'),
  ('Kitchen','מיקרוגל','עובד מצוין'),
  ('Sports','אופני ילדים 20 אינץ','צריך לנפח גלגלים'),
  ('Electronics','מסך מחשב 24 אינץ','חיבור HDMI'),
  ('Electronics','מקרר קטן','מתאים למשרד או לחדר סטודנט'),
  ('Tools','מקדחה חשמלית','עם סט מקדחים'),
  ('Other','עציצים וצמחי בית','כמה עציצים קטנים');

  create temp table s_posts on commit drop as
  select gen_random_uuid() post_id, u.id owner_id,
    case when random()<0.7 then 'Give' else 'Request' end type,
    it.cat, it.title, it.descr, u.city,
    (select name_he from public.streets st where st.city_id=u.city order by random()+g*0 limit 1) street,
    (1+floor(random()*120))::int::text street_number,
    now() - (random()*60||' days')::interval created_at, g
  from generate_series(1,600) g
  cross join lateral (select * from s_users order by random()+g*0 limit 1) u
  cross join lateral (select * from s_items order by random()+g*0 limit 1) it;

  insert into public.posts (post_id, owner_id, type, status, visibility, title, description, category, city, street, street_number, location_display_level, item_condition, urgency, created_at, source_language)
  select post_id, owner_id, type,
    case when g % 7 = 0 then 'closed_delivered' else 'open' end,
    case when g % 10 = 0 then 'FollowersOnly' else 'Public' end,
    case when type='Request' then 'מחפש/ת: '||title else title end, descr, cat, city, coalesce(street,'הרצל'), street_number,
    'CityAndStreet',
    case when type='Give' then (array['New','LikeNew','Good','Fair'])[1+floor(random()*4)::int] end,
    case when type='Request' and random()<0.3 then 'דחוף, עד סוף השבוע' end,
    created_at, 'he'
  from s_posts p
  where (select count(*) from s_posts p2 where p2.owner_id=p.owner_id and p2.g<=p.g) <= 15;

  insert into public.recipients (post_id, recipient_user_id, marked_at)
  select p.post_id, (select id from s_users where id<>p.owner_id order by random()+p.g*0 limit 1), p.created_at + interval '2 days'
  from s_posts p join public.posts x on x.post_id=p.post_id where x.status='closed_delivered';

  insert into public.driver_declarations (user_id, declared_at, license_declared, insurance_declared, no_profit_acknowledged)
  select id, now(), true, true, true from s_users where i % 3 = 0;

  perform public.kc_dev_seed_demo_rides();
end;
$$;

create or replace function public.kc_dev_seed_build_result(p_aux jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'users', (select count(*) from public.users where user_id in (
      select id from auth.users where email like '%@seed.kc.test')),
    'posts', (select count(*) from public.posts p join auth.users a on a.id = p.owner_id
      where a.email like '%@seed.kc.test'),
    'rides', (select count(*) from public.posts p join auth.users a on a.id = p.owner_id
      where p.world_slug = 'rides' and a.email like '%@seed.kc.test'),
    'organizations', (select count(*) from public.organizations where verification_method = 'demo_seed'))
    || coalesce(p_aux, '{}'::jsonb);
$$;

commit;
