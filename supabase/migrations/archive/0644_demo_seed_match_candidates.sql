-- 0644_demo_seed_match_candidates | kc-dev demo seed: synthetic matching-v2 pairs for the
-- "מומלצים בשבילך" hub + feed strips (FR-ADMIN-031 demo data).
--
-- Called from kc_dev_seed_demo_data after posts exist. Also run once on migrate when the fake
-- seed is already present (no full re-seed required).

begin;

-- ── 1. kc_dev_seed_demo_match_candidates (internal) ──────────────────────────────────────
create or replace function public.kc_dev_seed_demo_match_candidates()
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

  -- Ensure every open demo post owns a listing (items world sync).
  perform public.listing_upsert_from_post(p)
    from public.posts p
    join auth.users a on a.id = p.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and p.status = 'open'
     and not exists (select 1 from public.listings l where l.legacy_post_id = p.post_id);

  create temp table s_demo_give on commit drop as
  select l.listing_id,
         l.owner_id,
         l.category_id,
         row_number() over (partition by l.owner_id order by l.published_at desc nulls last, l.listing_id) as rn
    from public.listings l
    join auth.users a on a.id = l.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and l.world_slug = 'items'
     and l.direction = 'give'
     and l.status = 'open'
     and l.moderation_status = 'published';

  create temp table s_demo_request on commit drop as
  select l.listing_id,
         l.owner_id,
         l.category_id,
         row_number() over (partition by l.owner_id order by l.published_at desc nulls last, l.listing_id) as rn
    from public.listings l
    join auth.users a on a.id = l.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and l.world_slug = 'items'
     and l.direction = 'request'
     and l.status = 'open'
     and l.moderation_status = 'published';

  if not exists (select 1 from s_demo_give) or not exists (select 1 from s_demo_request) then
    return 0;
  end if;

  with pairs as (
    select g.listing_id as offer_listing_id,
           r.listing_id as request_listing_id,
           g.owner_id   as offer_owner_id,
           r.owner_id   as request_owner_id,
           g.category_id,
           row_number() over (
             partition by g.owner_id
             order by md5(g.listing_id::text || r.listing_id::text)
           ) as pair_rank,
           abs(hashtext(g.listing_id::text || r.listing_id::text)) as h
      from s_demo_give g
      join lateral (
        select r.*
          from s_demo_request r
         where r.owner_id <> g.owner_id
           and (g.category_id is not distinct from r.category_id)
         order by md5(r.listing_id::text || g.listing_id::text)
         limit 6
      ) r on true
     where g.rn = 1
  ),
  ins as (
    insert into public.match_candidates (
      offer_listing_id,
      request_listing_id,
      offer_owner_id,
      request_owner_id,
      world_slug,
      score,
      components,
      distance_km,
      status,
      offer_response,
      request_response,
      notified_offer_at,
      notified_request_at,
      llm_reason,
      computed_at
    )
    select p.offer_listing_id,
           p.request_listing_id,
           p.offer_owner_id,
           p.request_owner_id,
           'items',
           least(0.97, 0.48 + (p.h % 49)::numeric / 100),
           jsonb_build_object(
             'category', 0.70 + (p.h % 25)::numeric / 100,
             'geo',      0.45 + (p.h % 40)::numeric / 100,
             'text',     0.35 + (p.h % 30)::numeric / 100,
             'demo_seed', true
           ),
           round(((p.h % 180) + 5)::numeric / 10, 1),
           case when p.h % 17 = 0 then 'accepted' else 'suggested' end,
           case when p.h % 11 = 0 then 'accepted' when p.h % 23 = 0 then 'declined' end,
           case when p.h % 13 = 0 then 'accepted' when p.h % 29 = 0 then 'declined' end,
           now() - ((p.h % 72) || ' hours')::interval,
           now() - ((p.h % 72) || ' hours')::interval,
           case when p.h % 5 = 0
             then (array[
               'אותה קטגוריה ואזור דומה — נראה מתאים לדמו',
               'בקשה ותרומה באותו עולם פריטים',
               'התאמה לדוגמה בסביבת הפיתוח'
             ])[1 + (p.h % 3)]
           end,
           now() - ((p.h % 96) || ' hours')::interval
      from pairs p
     where p.pair_rank <= 5
    on conflict on constraint match_candidates_pair_unique do nothing
    returning 1
  )
  select count(*)::int into v_n from ins;

  -- Users who only post requests: pair their request with others' gives (up to 5 each).
  with pairs as (
    select r.listing_id as request_listing_id,
           g.listing_id as offer_listing_id,
           g.owner_id   as offer_owner_id,
           r.owner_id   as request_owner_id,
           abs(hashtext(r.listing_id::text || g.listing_id::text)) as h,
           row_number() over (
             partition by r.owner_id
             order by md5(r.listing_id::text || g.listing_id::text)
           ) as pair_rank
      from s_demo_request r
      join lateral (
        select g.*
          from s_demo_give g
         where g.owner_id <> r.owner_id
           and (g.category_id is not distinct from r.category_id)
         order by md5(g.listing_id::text || r.listing_id::text)
         limit 6
      ) g on true
     where r.rn = 1
       and not exists (
         select 1
           from public.match_candidates m
          where m.request_owner_id = r.owner_id
            and m.offer_listing_id = g.listing_id
       )
  ),
  ins2 as (
    insert into public.match_candidates (
      offer_listing_id,
      request_listing_id,
      offer_owner_id,
      request_owner_id,
      world_slug,
      score,
      components,
      distance_km,
      status,
      notified_offer_at,
      notified_request_at,
      llm_reason,
      computed_at
    )
    select p.offer_listing_id,
           p.request_listing_id,
           p.offer_owner_id,
           p.request_owner_id,
           'items',
           least(0.95, 0.50 + (p.h % 45)::numeric / 100),
           jsonb_build_object('category', 0.65, 'geo', 0.50, 'demo_seed', true),
           round(((p.h % 120) + 8)::numeric / 10, 1),
           'suggested',
           now() - interval '6 hours',
           now() - interval '6 hours',
           'התאמת דמו — מבקש/ת פוגש/ת תורם/ת',
           now() - interval '12 hours'
      from pairs p
     where p.pair_rank <= 5
    on conflict on constraint match_candidates_pair_unique do nothing
    returning 1
  )
  select v_n + count(*)::int into v_n from ins2;

  return v_n;
end;
$fn$;

comment on function public.kc_dev_seed_demo_match_candidates() is
  'kc-dev only: inserts open items-world match_candidates between @seed.kc.test users for UI demos. Idempotent on pair unique constraint.';

revoke all on function public.kc_dev_seed_demo_match_candidates() from public, anon, authenticated;
grant execute on function public.kc_dev_seed_demo_match_candidates() to service_role;

-- ── 2. Hook into kc_dev_seed_demo_data ───────────────────────────────────────────────────
create or replace function public.kc_dev_seed_demo_data(p_password_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '300s'
as $fn$
declare
  v_result jsonb;
  v_match_count integer;
begin
  if not exists (select 1 from public.kc_dev_demo_config) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;
  if coalesce(p_password_hash, '') = '' then
    raise exception 'password_required' using errcode = '22023';
  end if;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  perform setseed(0.4242);

  alter table public.listings disable trigger listings_rate_limit;
  alter table public.giving_handoffs disable trigger giving_handoffs_rate_limit;
  alter table public.follow_edges disable trigger follow_edges_rate_limit;

  perform public.kc_dev_wipe_demo_data();

  create temp table s_first(n text) on commit drop;
  insert into s_first values ('נועה'),('יעל'),('תמר'),('מאיה'),('שירה'),('רוני'),('אביגיל'),('הדר'),('ליה'),('מיכל'),('דנה'),('אורית'),('רחל'),('שרה'),('אסתר'),('יוסי'),('דוד'),('משה'),('איתי'),('עומר'),('יונתן'),('אורי'),('נדב'),('אריאל'),('עידו'),('אלון'),('גיא'),('רועי'),('אמיר'),('מוחמד'),('אחמד'),('סלים'),('לילא'),('נור'),('ויקטוריה'),('אלכסנדר'),('דימה'),('אולגה'),('בנימין'),('חנה');
  create temp table s_last(n text) on commit drop;
  insert into s_last values ('כהן'),('לוי'),('מזרחי'),('פרץ'),('ביטון'),('אברהם'),('פרידמן'),('שפירא'),('אזולאי'),('דהן'),('חדד'),('אוחיון'),('גבאי'),('קפלן'),('רוזן'),('בן דוד'),('סלאמה'),('חורי'),('נסר'),('איבנוב'),('גולן'),('שלום'),('עמר'),('יוסף'),('בירנבאום');
  create temp table s_city as
    select c.city_id, c.name_he, row_number() over () rn
    from public.cities c where c.city_id in ('3000','5000','4000','8300','9000','7900','7100','7400','2600','6400','70','8400','8600','6500','6600','6900','1200','7000','9700','2610','8800','7300');

  create temp table s_users on commit drop as
  select gen_random_uuid() id, g i,
    (select n from s_first order by random()+g*0 limit 1) fn,
    (select n from s_last order by random()+g*0 limit 1) ln,
    (select city_id from s_city order by random()+g*0 limit 1) city
  from generate_series(1,200) g;

  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated','authenticated',
    'user'||i||'@seed.kc.test', p_password_hash, now(),
    jsonb_build_object('provider','email','providers',array['email'],'seed',true),
    jsonb_build_object('full_name', fn||' '||ln, 'seed', true),
    now() - (random()*200||' days')::interval, now(), '', '', '', ''
  from s_users;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), id, id::text, jsonb_build_object('sub',id::text,'email','user'||i||'@seed.kc.test','email_verified',true), 'email', now(), now(), now()
  from s_users;

  update public.users u set
    display_name = left(s.fn||' '||s.ln, 50),
    city = s.city, city_name = c.name_he,
    biography = (array['אוהב/ת לעזור לשכנים','אמא לשלושה, מוסרת הרבה בגדי ילדים','סטודנט/ית, מחפש/ת ריהוט לדירה','מתנדב/ת בבנק המזון','נהג/ת קבוע/ה לירושלים','גמלאי/ת עם הרבה זמן פנוי',null])[1+floor(random()*7)::int],
    privacy_mode = case when random()<0.15 then 'Private' else 'Public' end,
    account_status = 'active', onboarding_state = 'completed',
    preferred_language = 'he'
  from s_users s join s_city c on c.city_id = s.city
  where u.user_id = s.id;

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

  insert into public.ride_listings (owner_id, mode, origin_city_id, dest_city_id, departs_at, seats_available, title, description, status, visibility, origin_street, dest_street, payment_model, payment_amount_ils, cargo_enabled, food_shipping_enabled, req_gender)
  select u.id, m.mode, o.city_id, d.city_id,
    now() + ((random()*14)||' days')::interval,
    case when m.mode='offer' then 1+floor(random()*4)::int end,
    case when m.mode='offer' then 'נוסע/ת מ'||o.name_he||' ל'||d.name_he else 'מחפש/ת טרמפ מ'||o.name_he||' ל'||d.name_he end,
    (array['יוצא/ת בבוקר, אפשר לעצור בדרך','חזרה בערב','יש מקום לתיק קטן',null])[1+floor(random()*4)::int],
    'open','Public','תחנה מרכזית','מרכז העיר',
    case when g%2=0 then 'free' else 'expense_share' end,
    case when g%2=0 then null else 10+floor(random()*40)::int end,
    false,false,'any'
  from generate_series(1,120) g
  cross join lateral (select case when g%3=0 then 'request' else 'offer' end mode) m
  cross join lateral (select * from s_users where (m.mode='request' or i%3=0) order by random()+g*0 limit 1) u
  cross join lateral (select * from s_city order by random()+g*0 limit 1) o
  cross join lateral (select * from s_city where city_id<>o.city_id order by random()+g*0 limit 1) d;

  insert into public.follow_edges (follower_id, followed_id, created_at)
  select distinct on (a.id,b.id) a.id, b.id, now() - (random()*90||' days')::interval
  from generate_series(1,1500) g
  cross join lateral (select id from s_users order by random()+g*0 limit 1) a
  cross join lateral (select id from s_users order by random()+g*0 limit 1) b
  where a.id<>b.id
  on conflict do nothing;

  insert into public.saved_posts (user_id, post_id, saved_at)
  select distinct on (u.id,p.post_id) u.id, p.post_id, now()
  from generate_series(1,400) g
  cross join lateral (select id from s_users order by random()+g*0 limit 1) u
  cross join lateral (select post_id from public.posts where owner_id in (select id from s_users) and status='open' order by random()+g*0 limit 1) p
  on conflict do nothing;

  alter table public.messages disable trigger messages_rate_limit;
  create temp table s_chats on commit drop as
  select distinct on (least(p.owner_id,u.id), greatest(p.owner_id,u.id)) gen_random_uuid() chat_id,
    least(p.owner_id,u.id) a, greatest(p.owner_id,u.id) b, p.post_id, p.owner_id, u.id asker, p.title
  from generate_series(1,150) g
  cross join lateral (select * from public.posts where owner_id in (select id from s_users) order by random()+g*0 limit 1) p
  cross join lateral (select id from s_users where id<>p.owner_id order by random()+g*0 limit 1) u;
  insert into public.chats (chat_id, participant_a, participant_b, anchor_post_id, created_at)
  select chat_id, a, b, post_id, now() - interval '3 days' from s_chats;
  insert into public.messages (chat_id, sender_id, kind, body, status, created_at, delivered_at, read_at, source_language)
  select c.chat_id, case when k%2=1 then c.asker else c.owner_id end, 'user',
    (array['היי, זה עדיין רלוונטי?','כן, עדיין זמין 🙂','מתי נוח לך לאסוף?','אפשר מחר אחרי 17:00?','מעולה, אני שולח/ת כתובת מדויקת','תודה רבה!!'])[k],
    'read', now() - ((7-k)||' hours')::interval, now() - ((7-k)||' hours')::interval, now() - ((7-k)||' hours')::interval + interval '1 minute', 'he'
  from s_chats c cross join generate_series(1,6) k;
  alter table public.messages enable trigger messages_rate_limit;
  alter table public.listings enable trigger listings_rate_limit;
  alter table public.giving_handoffs enable trigger giving_handoffs_rate_limit;
  alter table public.follow_edges enable trigger follow_edges_rate_limit;

  v_match_count := public.kc_dev_seed_demo_match_candidates();

  insert into public.organizations (
    org_id, name, slug, is_platform, is_verified_nonprofit, verified_at, verification_method,
    public_tagline_he, public_tagline_en, public_about_he, public_about_en
  )
  values
    ('00000000-0000-0000-0000-00000000d001'::uuid, '[DEMO] קרן לב חם', 'demo-lev-cham', false, true, now(), 'demo_seed',
     'עמותת הדגמה – סל מזון לחגים', 'Demo nonprofit – holiday food baskets',
     'עמותת הדגמה לסביבת הפיתוח בלבד. אין לתרום כסף אמיתי.', 'Demo nonprofit for the dev environment only. Do not send real money.'),
    ('00000000-0000-0000-0000-00000000d002'::uuid, '[DEMO] ידיים פתוחות', 'demo-yadayim-ptuchot', false, true, now(), 'demo_seed',
     'עמותת הדגמה – ציוד לימודי לילדים', 'Demo nonprofit – school supplies for kids',
     'עמותת הדגמה לסביבת הפיתוח בלבד. אין לתרום כסף אמיתי.', 'Demo nonprofit for the dev environment only. Do not send real money.'),
    ('00000000-0000-0000-0000-00000000d003'::uuid, '[DEMO] בית לכל חיה', 'demo-bayit-lechol-chaya', false, true, now(), 'demo_seed',
     'עמותת הדגמה – אימוץ וטיפול בבעלי חיים', 'Demo nonprofit – animal adoption and care',
     'עמותת הדגמה לסביבת הפיתוח בלבד. אין לתרום כסף אמיתי.', 'Demo nonprofit for the dev environment only. Do not send real money.')
  on conflict (slug) do update set
    is_verified_nonprofit = true,
    verification_method   = excluded.verification_method,
    public_tagline_he     = excluded.public_tagline_he,
    public_tagline_en     = excluded.public_tagline_en,
    public_about_he       = excluded.public_about_he,
    public_about_en       = excluded.public_about_en;

  select jsonb_build_object(
    'users',         (select count(*) from public.users where user_id in (select id from auth.users where email like '%@seed.kc.test')),
    'posts',         (select count(*) from public.posts p join auth.users a on a.id = p.owner_id where a.email like '%@seed.kc.test'),
    'rides',         (select count(*) from public.ride_listings r join auth.users a on a.id = r.owner_id where a.email like '%@seed.kc.test'),
    'follows',       (select count(*) from public.follow_edges f join auth.users a on a.id = f.follower_id where a.email like '%@seed.kc.test'),
    'messages',      (select count(*) from public.messages m join auth.users a on a.id = m.sender_id where a.email like '%@seed.kc.test'),
    'match_candidates', v_match_count,
    'organizations', (select count(*) from public.organizations where verification_method = 'demo_seed'))
    into v_result;
  return v_result;
end;
$fn$;

comment on function public.kc_dev_seed_demo_data(text) is
  'kc-dev only: wipes then creates the fake demo data (seed users, content, match suggestions, [DEMO] nonprofits). Refuses without the kc_dev_demo_config marker. Internal; called by seed.sql and admin_seed_demo_data.';

-- Backfill matches when the dev seed already exists (no full re-seed).
do $backfill$
declare
  v_seed_users integer;
  v_added integer;
begin
  select count(*) into v_seed_users
    from auth.users u
   where u.email like '%@seed.kc.test'
     and coalesce(u.raw_app_meta_data->>'seed', '') = 'true';

  if v_seed_users < 100 then
    raise notice '0644: no kc-dev seed detected (% users) — skipping match backfill', v_seed_users;
    return;
  end if;

  v_added := public.kc_dev_seed_demo_match_candidates();
  raise notice '0644: demo match_candidates backfill inserted % row(s)', v_added;
end $backfill$;

commit;
