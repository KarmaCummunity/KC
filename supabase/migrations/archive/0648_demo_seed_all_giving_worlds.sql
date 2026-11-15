-- 0648_demo_seed_all_giving_worlds | FR-ADMIN-031: demo listings + challenge posts in every
-- giving world (D100). Portal worlds rely on curated links (0595) and demo nonprofits (money).
-- Feed worlds get native Hebrew give/request listings; challenges get open community challenges.

begin;

-- ── 1. kc_dev_seed_demo_world_content (internal) ────────────────────────────────────────
create or replace function public.kc_dev_seed_demo_world_content()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_food_give int := 0;
  v_food_req int := 0;
  v_time int := 0;
  v_housing int := 0;
  v_animals int := 0;
  v_knowledge int := 0;
  v_challenges int := 0;
  v_housing_json jsonb := jsonb_build_object(
    'place_type', 'private_room', 'capacity', 2, 'exclusive', false,
    'min_nights', 1, 'max_nights', 7,
    'check_in_from', '16:00', 'check_in_until', '22:00', 'check_out_by', '10:00',
    'guest_policy', 'any', 'children_ok', true, 'pets_ok', false, 'smoking', 'no',
    'availability', jsonb_build_object('mode', 'ongoing')
  );
  v_stay_req jsonb := jsonb_build_object(
    'stay_purpose', 'trail_walk', 'adults', 2, 'minors', 0,
    'check_in_date', (public.housing_today() + 5)::text,
    'check_out_date', (public.housing_today() + 6)::text
  );
  v_i int;
  v_cid uuid;
  v_pid uuid;
  v_ch_user uuid;
  v_ch_city text;
  v_ch_title text;
  v_ch_scope text;
  v_ch_measurement text;
  v_ch_cadence text;
  v_ch_goal_value numeric;
  v_ch_goal_direction text;
begin
  if not exists (select 1 from public.kc_dev_demo_config) then
    return '{}'::jsonb;
  end if;

  update public.users u
     set verified_at = coalesce(u.verified_at, now()),
         verification_method = coalesce(u.verification_method, 'manual')
    from auth.users a
   where a.id = u.user_id
     and a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true';

  insert into public.housing_conduct_acceptances (user_id, version)
  select u.user_id, public.housing_conduct_version()
    from public.users u
    join auth.users a on a.id = u.user_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
  on conflict do nothing;

  -- Food (give + request)
  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, summary, city_id,
    status, visibility, anonymity_level, origin, moderation_status, published_at, expires_at, details
  )
  select u.id, 'food', k.kind_id, t.dir, t.title, t.summary, u.city,
         'open', 'Public', public.visibility_to_anonymity_level('Public'),
         'native', 'published', now() - (g % 14 || ' days')::interval,
         case when t.dir = 'give' then exp.v_exp end,
         case
           when t.dir = 'give' then
             t.details || jsonb_build_object(
               'expires_at',
               to_char(exp.v_exp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
           else t.details
         end
    from generate_series(1, 36) g
    cross join lateral (
      select now() + ((g % 5 + 1) || ' days')::interval as v_exp
    ) exp
    cross join lateral (
      select case when g % 3 = 0 then 'request' else 'give' end as dir
    ) tdir
    cross join lateral (
      select v.dir, v.title, v.summary, v.details from (values
        ('give', 'מנות מרוקאיות לשתי מנות', 'בישלתי יותר מדי, אוספים מהשכונה',
         jsonb_build_object('food_type', 'packaged', 'kosher', 'mehadrin')),
        ('give', 'ירקות מהגינה', 'עגבניות ומלפפונים, טריים מהבוקר',
         jsonb_build_object('food_type', 'fresh')),
        ('give', 'לחם ומאפים מאתמול', 'מאפייה מקומית, עדיין טוב לאכול היום',
         jsonb_build_object('food_type', 'dry')),
        ('request', 'מחפש/ת מזון לשבת', 'משפחה בת 4, כל עזרה תודה',
         jsonb_build_object('household_size', 4, 'dietary_needs', 'ללא גלוטן אם אפשר'))
      ) v(dir, title, summary, details)
      where v.dir = tdir.dir
      order by md5(g::text || v.title)
      limit 1
    ) t
    cross join lateral (
      select pu.user_id as id, pu.city
        from auth.users au
        join public.users pu on pu.user_id = au.id
       where au.email like '%@seed.kc.test'
         and coalesce(au.raw_app_meta_data->>'seed', '') = 'true'
       order by md5(au.id::text || g::text)
       limit 1
    ) u
    cross join lateral (
      select kind_id from public.listing_kinds
       where world_slug = 'food' and slug = case t.dir when 'give' then 'give_food' else 'request_food' end
    ) k;

  select count(*) filter (where l.direction = 'give')::int,
         count(*) filter (where l.direction = 'request')::int
    into v_food_give, v_food_req
    from public.listings l
    join auth.users a on a.id = l.owner_id
   where l.world_slug = 'food' and a.email like '%@seed.kc.test';

  -- Time
  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, city_id,
    status, visibility, anonymity_level, origin, moderation_status, published_at, details
  )
  select u.id, 'time', k.kind_id, t.dir, t.title, u.city,
         'open', case when t.dir = 'give' and g % 4 = 0 then 'FollowersOnly' else 'Public' end,
         public.visibility_to_anonymity_level(
           case when t.dir = 'give' and g % 4 = 0 then 'FollowersOnly' else 'Public' end),
         'native', 'published', now() - (g % 20 || ' days')::interval, '{}'::jsonb
    from generate_series(1, 24) g
    cross join lateral (
      select * from (values
        ('give', 'שעתיים של ליווי לקשיש/ה'),
        ('give', 'עזרה בשיעורי בית באנגלית'),
        ('request', 'מחפש/ת חברות לטיול קצר'),
        ('request', 'סיוע בקניות לשבוע')
      ) v(dir, title)
      order by md5(g::text || v.title)
      limit 1
    ) t
    cross join lateral (
      select kind_id from public.listing_kinds
       where world_slug = 'time' and slug = case t.dir when 'give' then 'volunteer_shift' else 'support_request' end
    ) k
    cross join lateral (
      select pu.user_id as id, pu.city from auth.users au
      join public.users pu on pu.user_id = au.id
       where au.email like '%@seed.kc.test'
         and coalesce(au.raw_app_meta_data->>'seed', '') = 'true'
       order by md5(au.id::text || g::text)
       limit 1
    ) u;

  get diagnostics v_time = row_count;

  -- Housing
  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, city_id,
    status, visibility, anonymity_level, origin, moderation_status, published_at, details
  )
  select u.id, 'housing', k.kind_id, t.dir, t.title, u.city,
         'open', 'Public', public.visibility_to_anonymity_level('Public'),
         'native', 'published', now() - (g % 10 || ' days')::interval,
         case when t.dir = 'give' then v_housing_json else v_stay_req end
    from generate_series(1, 18) g
    cross join lateral (
      select * from (values
        ('give', 'חדר אירוח ללילה או שניים'),
        ('request', 'מיטה לשני מטיילים בטיול')
      ) v(dir, title)
      where (g % 2 = 0) = (v.dir = 'request')
      limit 1
    ) t
    cross join lateral (
      select kind_id from public.listing_kinds
       where world_slug = 'housing' and slug = case t.dir when 'give' then 'host_offer' else 'stay_request' end
    ) k
    cross join lateral (
      select pu.user_id as id, pu.city from auth.users au
      join public.users pu on pu.user_id = au.id
       where au.email like '%@seed.kc.test'
         and coalesce(au.raw_app_meta_data->>'seed', '') = 'true'
       order by md5(au.id::text || g::text)
       limit 1
    ) u;

  get diagnostics v_housing = row_count;

  -- Animals
  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, city_id,
    status, visibility, anonymity_level, origin, moderation_status, published_at, details
  )
  select u.id, 'animals', k.kind_id, t.dir, t.title, u.city,
         'open', 'Public', public.visibility_to_anonymity_level('Public'),
         'native', 'published', now() - (g % 12 || ' days')::interval, t.details
    from generate_series(1, 28) g
    cross join lateral (
      select * from (values
        ('give', 'adoption_offer', 'גור כלב למסירה לאוהבים', '{"species":"dog","age_group":"young","vaccinated":true,"good_with":["children"]}'::jsonb),
        ('give', 'foster_offer', 'שמירה על חתול בשבוע הבא', '{"species":"cat","care_mode":"part_time","location_mode":"my_home"}'::jsonb),
        ('request', 'adoption_request', 'מחפשים חתול בוגר רגוע', '{"species":"cat","age_group":"adult","size":"small"}'::jsonb),
        ('request', 'foster_request', 'פנסיון לכלב לשבועיים',
         jsonb_build_object(
           'species', 'dog', 'care_mode', 'full_boarding',
           'starts_on', (current_date + 14)::text, 'ends_on', (current_date + 28)::text))
      ) v(dir, kind_slug, title, details)
      order by md5(g::text || v.kind_slug)
      limit 1
    ) t
    cross join lateral (
      select kind_id from public.listing_kinds where world_slug = 'animals' and slug = t.kind_slug
    ) k
    cross join lateral (
      select pu.user_id as id, pu.city from auth.users au
      join public.users pu on pu.user_id = au.id
       where au.email like '%@seed.kc.test'
         and coalesce(au.raw_app_meta_data->>'seed', '') = 'true'
       order by md5(au.id::text || g::text)
       limit 1
    ) u;

  get diagnostics v_animals = row_count;

  -- Knowledge (pending on insert → published for demos)
  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, city_id,
    status, visibility, anonymity_level, origin, moderation_status, published_at, details
  )
  select u.id, 'knowledge', k.kind_id, t.dir, t.title, u.city,
         'open', 'Public', public.visibility_to_anonymity_level('Public'),
         'native', 'pending_review', now() - (g % 8 || ' days')::interval, t.details
    from generate_series(1, 14) g
    cross join lateral (
      select * from (values
        ('give', 'private_lesson', 'שיעור פרטי באנגלית', jsonb_build_object(
          'topic', 'אנגלית', 'modality', 'video', 'slots_available', 2,
          'slot_starts_at', to_char((now() + interval '2 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'slot_ends_at', to_char((now() + interval '2 days 1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
        ('give', 'course', 'מבוא לפייתון למתחילים', jsonb_build_object(
          'topic', 'פייתון', 'modality', 'video', 'slots_available', 8,
          'slot_starts_at', to_char((now() + interval '4 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'slot_ends_at', to_char((now() + interval '4 days 2 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
        ('request', 'mentorship_request', 'חונכות לראיון עבודה בהייטק', '{"topic":"קריירה","preferred_modality":"video"}'::jsonb)
      ) v(dir, kind_slug, title, details)
      order by md5(g::text || v.kind_slug)
      limit 1
    ) t
    cross join lateral (
      select kind_id from public.listing_kinds where world_slug = 'knowledge' and slug = t.kind_slug
    ) k
    cross join lateral (
      select pu.user_id as id, pu.city from auth.users au
      join public.users pu on pu.user_id = au.id
       where au.email like '%@seed.kc.test'
         and coalesce(au.raw_app_meta_data->>'seed', '') = 'true'
       order by md5(au.id::text || g::text)
       limit 1
    ) u;

  update public.listings l
     set moderation_status = 'published'
    from auth.users a
   where a.id = l.owner_id
     and l.world_slug = 'knowledge'
     and l.moderation_status = 'pending_review'
     and a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true';

  select count(*)::int into v_knowledge
    from public.listings l
    join auth.users a on a.id = l.owner_id
   where l.world_slug = 'knowledge' and a.email like '%@seed.kc.test';

  -- Challenges (challenge posts in the challenges world)
  for v_i in 1..8 loop
    select pu.user_id, pu.city into v_ch_user, v_ch_city
      from auth.users au
      join public.users pu on pu.user_id = au.id
     where au.email like '%@seed.kc.test'
       and coalesce(au.raw_app_meta_data->>'seed', '') = 'true'
     order by md5(pu.user_id::text)
     offset (v_i - 1) limit 1;

    select t.title, t.scope, t.measurement, t.cadence, t.goal_value, t.goal_direction
      into v_ch_title, v_ch_scope, v_ch_measurement, v_ch_cadence, v_ch_goal_value, v_ch_goal_direction
      from (
        select *, row_number() over () as rn from (values
          ('שתיית מים – 8 כוסות ביום', 'community', 'count', 'daily', 8::numeric, 'at_least'::text),
          ('10,000 צעדים ביום', 'personal', 'yes_no', 'daily', null::numeric, null::text),
          ('דקות הודיה לפני השינה', 'personal', 'duration_minutes', 'daily', 5::numeric, 'at_least'),
          ('ללא מסכים שעה לפני השינה', 'community', 'yes_no', 'daily', null::numeric, null::text),
          ('קריאת עמוד ביום', 'community', 'count', 'daily', 1::numeric, 'at_least'),
          ('התנדבות פעם בשבוע', 'community', 'yes_no', 'weekly', null::numeric, null::text),
          ('ארוחת בוקר בבית', 'personal', 'count', 'weekly', 5::numeric, 'at_least'),
          ('סירוס / ניקוי חדר', 'personal', 'duration_minutes', 'flexible', 20::numeric, 'at_least')
        ) v(title, scope, measurement, cadence, goal_value, goal_direction)
      ) t
     where t.rn = v_i;

    v_cid := gen_random_uuid();
    insert into public.challenges (
      challenge_id, creator_id, title, scope, measurement, cadence, goal_value, goal_direction,
      difficulty, ends_at, status
    ) values (
      v_cid, v_ch_user, v_ch_title, v_ch_scope, v_ch_measurement, v_ch_cadence,
      v_ch_goal_value, v_ch_goal_direction, 'medium', now() + interval '30 days', 'active'
    );
    insert into public.challenge_participations (challenge_id, user_id)
    values (v_cid, v_ch_user);
    insert into public.posts (
      owner_id, type, status, visibility, title, category,
      city, street, street_number, location_display_level,
      world_slug, listing_world_slug, post_type, details
    ) values (
      v_ch_user, 'Give', 'open',
      case when v_ch_scope = 'personal' then 'OnlyMe' else 'Public' end,
      left(v_ch_title, 80), 'Other',
      coalesce(v_ch_city, (select city_id from public.cities order by city_id limit 1)),
      'Marketplace', '1', 'CityOnly',
      'challenges', 'challenges', 'challenge',
      jsonb_build_object('challenge_id', v_cid, 'scope', v_ch_scope)
    );
    select p.post_id into v_pid
      from public.posts p
     where p.owner_id = v_ch_user
       and p.post_type = 'challenge'
       and p.details ->> 'challenge_id' = v_cid::text
     order by p.created_at desc
     limit 1;
    update public.challenges set post_id = v_pid where challenge_id = v_cid;
  end loop;

  select count(*)::int into v_challenges
    from public.posts p
    join auth.users a on a.id = p.owner_id
   where p.post_type = 'challenge' and a.email like '%@seed.kc.test';

  return jsonb_build_object(
    'world_listings_food', v_food_give,
    'world_listings_food_requests', v_food_req,
    'world_listings_time', v_time,
    'world_listings_housing', v_housing,
    'world_listings_animals', v_animals,
    'world_listings_knowledge', v_knowledge,
    'challenge_posts', v_challenges
  );
end;
$fn$;

comment on function public.kc_dev_seed_demo_world_content() is
  'kc-dev only: Hebrew demo listings (food, time, housing, animals, knowledge) and challenge posts for @seed.kc.test users.';

revoke all on function public.kc_dev_seed_demo_world_content() from public, anon, authenticated;
grant execute on function public.kc_dev_seed_demo_world_content() to service_role;

-- ── 2. Hook into kc_dev_seed_demo_data (body from 0644 + world content) ──────────────────
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
  v_world jsonb;
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

  v_world := public.kc_dev_seed_demo_world_content();

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
    || coalesce(v_world, '{}'::jsonb)
    into v_result;
  return v_result;
end;
$fn$;

comment on function public.kc_dev_seed_demo_data(text) is
  'kc-dev only: wipes then creates the fake demo data (seed users, all worlds, match suggestions, [DEMO] nonprofits). Refuses without the kc_dev_demo_config marker. Internal; called by seed.sql and admin_seed_demo_data.';

-- Backfill world content when the dev seed already exists (no full re-seed).
do $backfill$
declare
  v_seed_users integer;
  v_food integer;
  v_added jsonb;
begin
  select count(*) into v_seed_users
    from auth.users u
   where u.email like '%@seed.kc.test'
     and coalesce(u.raw_app_meta_data->>'seed', '') = 'true';

  if v_seed_users < 100 then
    raise notice '0648: no kc-dev seed detected (% users) — skipping world backfill', v_seed_users;
    return;
  end if;

  select count(*)::int into v_food
    from public.listings l
    join auth.users a on a.id = l.owner_id
   where l.world_slug = 'food' and a.email like '%@seed.kc.test';

  if v_food > 0 then
    raise notice '0648: demo world listings already present (% food) — skipping backfill', v_food;
    return;
  end if;

  v_added := public.kc_dev_seed_demo_world_content();
  raise notice '0648: demo world backfill: %', v_added;
end $backfill$;

commit;
