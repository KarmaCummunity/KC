-- 0654_demo_data_stepped_operations | FR-ADMIN-031: portal wipe/seed as short RPC steps
-- (fits the 25s client timeout). CLI seed.sql keeps one-shot kc_dev_seed_demo_data.

begin;

create table if not exists public.kc_dev_demo_operation_state (
  singleton   boolean primary key default true check (singleton),
  operation   text not null default 'idle'
    check (operation in ('idle', 'seed', 'wipe')),
  phase       text not null default 'idle',
  actor_id    uuid,
  started_at  timestamptz,
  aux         jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

insert into public.kc_dev_demo_operation_state (singleton) values (true)
on conflict (singleton) do nothing;

alter table public.kc_dev_demo_operation_state enable row level security;
revoke all on public.kc_dev_demo_operation_state from public, anon, authenticated;

-- ── Wipe helpers (split from 0653) ───────────────────────────────────────────────────────

create or replace function public.kc_dev_wipe_demo_seed_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(u.id), '{}')
    from auth.users u
   where u.email like '%@seed.kc.test'
     and coalesce(u.raw_app_meta_data->>'seed', '') = 'true';
$$;

create or replace function public.kc_dev_wipe_demo_data_content(p_seed_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
begin
  if coalesce(array_length(p_seed_ids, 1), 0) = 0 then
    return;
  end if;

  delete from public.match_candidates mc
   where mc.offer_owner_id = any (p_seed_ids) or mc.request_owner_id = any (p_seed_ids);
  delete from public.match_listing_state mls
   where mls.listing_id in (select l.listing_id from public.listings l where l.owner_id = any (p_seed_ids));
  delete from public.giving_handoffs gh
   where gh.owner_id = any (p_seed_ids) or gh.recipient_id = any (p_seed_ids)
      or gh.listing_id in (select l.listing_id from public.listings l where l.owner_id = any (p_seed_ids));
  delete from public.listings l where l.owner_id = any (p_seed_ids);
  delete from public.challenge_progress_entries cpe
   where cpe.user_id = any (p_seed_ids)
      or cpe.challenge_id in (select c.challenge_id from public.challenges c where c.creator_id = any (p_seed_ids));
  delete from public.challenge_participations cp
   where cp.user_id = any (p_seed_ids)
      or cp.challenge_id in (select c.challenge_id from public.challenges c where c.creator_id = any (p_seed_ids));
  delete from public.challenges c where c.creator_id = any (p_seed_ids);
  delete from public.saved_posts sp where sp.user_id = any (p_seed_ids);
  delete from public.ride_listings rl where rl.owner_id = any (p_seed_ids);
  delete from public.chats c
   where c.participant_a = any (p_seed_ids) or c.participant_b = any (p_seed_ids);
  delete from public.follow_edges f
   where f.follower_id = any (p_seed_ids) or f.followed_id = any (p_seed_ids);
  delete from public.recipients r
   where r.recipient_user_id = any (p_seed_ids)
      or r.post_id in (select p.post_id from public.posts p where p.owner_id = any (p_seed_ids));
  delete from public.posts p where p.owner_id = any (p_seed_ids);
  delete from public.driver_declarations d where d.user_id = any (p_seed_ids);
  delete from public.housing_conduct_acceptances h where h.user_id = any (p_seed_ids);
end;
$$;

create or replace function public.kc_dev_wipe_demo_data_accounts(p_seed_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  v_users        integer := 0;
  v_orgs_deleted integer := 0;
  v_orgs_kept    integer := 0;
  v_org_id       uuid;
  v_keep_admin   uuid;
begin
  if coalesce(array_length(p_seed_ids, 1), 0) = 0 then
    return jsonb_build_object('users_deleted', 0, 'organizations_deleted', 0, 'organizations_kept', 0);
  end if;

  select g.user_id into v_keep_admin
    from public.admin_role_grants g
   where g.revoked_at is null and g.role = 'super_admin'
     and not public.is_demo_seed_user(g.user_id)
   order by g.granted_at nulls last limit 1;

  if v_keep_admin is null then
    select u.id into v_keep_admin from auth.users u
     where not public.is_demo_seed_user(u.id) and u.email = 'karmacommunity2.0@gmail.com' limit 1;
  end if;

  if v_keep_admin is not null then
    if exists (select 1 from public.legal_document_versions where published_by = any (p_seed_ids)) then
      alter table public.legal_document_versions disable trigger legal_document_versions_immutable_trg;
      update public.legal_document_versions set published_by = v_keep_admin where published_by = any (p_seed_ids);
      alter table public.legal_document_versions enable trigger legal_document_versions_immutable_trg;
    end if;
    update public.survey_versions set published_by = v_keep_admin where published_by = any (p_seed_ids);
  elsif exists (
    select 1 from public.legal_document_versions where published_by = any (p_seed_ids)
    union all select 1 from public.survey_versions where published_by = any (p_seed_ids)
  ) then
    raise exception 'demo_wipe_blocked_publisher_refs' using errcode = '23503';
  end if;

  update public.donation_links set hidden_by = null where hidden_by = any (p_seed_ids);
  delete from auth.users u where u.id = any (p_seed_ids);
  get diagnostics v_users = row_count;

  for v_org_id in select o.org_id from public.organizations o where o.verification_method = 'demo_seed'
  loop
    begin
      delete from public.organizations where org_id = v_org_id;
      v_orgs_deleted := v_orgs_deleted + 1;
    exception when foreign_key_violation then
      v_orgs_kept := v_orgs_kept + 1;
    end;
  end loop;

  return jsonb_build_object('users_deleted', v_users,
                            'organizations_deleted', v_orgs_deleted,
                            'organizations_kept', v_orgs_kept);
end;
$$;

create or replace function public.kc_dev_wipe_demo_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '300s'
as $$
declare v_ids uuid[];
begin
  v_ids := public.kc_dev_wipe_demo_seed_ids();
  perform public.kc_dev_wipe_demo_data_content(v_ids);
  return public.kc_dev_wipe_demo_data_accounts(v_ids);
end;
$$;

-- ── Seed phase helpers (no temp tables across HTTP steps) ──────────────────────────────

create or replace function public.kc_dev_seed_phase_users(p_password_hash text)
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
begin
  drop table if exists s_first, s_last, s_city, s_users;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform setseed(0.4242);

  alter table public.listings disable trigger listings_rate_limit;
  alter table public.giving_handoffs disable trigger giving_handoffs_rate_limit;
  alter table public.follow_edges disable trigger follow_edges_rate_limit;

  create temp table s_first(n text) on commit drop;
  insert into s_first values ('נועה'),('יעל'),('תמר'),('מאיה'),('שירה'),('רוני'),('אביגיל'),('הדר'),('ליה'),('מיכל'),('דנה'),('אורית'),('רחל'),('שרה'),('אסתר'),('יוסי'),('דוד'),('משה'),('איתי'),('עומר'),('יונתן'),('אורי'),('נדב'),('אריאל'),('עידו'),('אלון'),('גיא'),('רועי'),('אמיר'),('מוחמד'),('אחמד'),('סלים'),('לילא'),('נור'),('ויקטוריה'),('אלכסנדר'),('דימה'),('אולגה'),('בנימין'),('חנה');
  create temp table s_last(n text) on commit drop;
  insert into s_last values ('כהן'),('לוי'),('מזרחי'),('פרץ'),('ביטון'),('אברהם'),('פרידמן'),('שפירא'),('אזולאי'),('דהן'),('חדד'),('אוחיון'),('גבאי'),('קפלן'),('רוזן'),('בן דוד'),('סלאמה'),('חורי'),('נסר'),('איבנוב'),('גולן'),('שלום'),('עמר'),('יוסף'),('בירנבאום');
  create temp table s_city as
    select c.city_id, c.name_he from public.cities c
     where c.city_id in ('3000','5000','4000','8300','9000','7900','7100','7400','2600','6400','70','8400','8600','6500','6600','6900','1200','7000','9700','2610','8800','7300');

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
    display_name = left(s.fn||' '||s.ln, 50), city = s.city, city_name = c.name_he,
    biography = (array['אוהב/ת לעזור לשכנים','אמא לשלושה, מוסרת הרבה בגדי ילדים','סטודנט/ית, מחפש/ת ריהוט לדירה','מתנדב/ת בבנק המזון','נהג/ת קבוע/ה לירושלים','גמלאי/ת עם הרבה זמן פנוי',null])[1+floor(random()*7)::int],
    privacy_mode = case when random()<0.15 then 'Private' else 'Public' end,
    account_status = 'active', onboarding_state = 'completed', preferred_language = 'he'
  from s_users s join s_city c on c.city_id = s.city where u.user_id = s.id;
end;
$$;

-- Items + rides (uses live seed users from auth)
create or replace function public.kc_dev_seed_phase_items()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
begin
  drop table if exists s_users, s_city, s_items, s_posts;
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
end;
$$;

create or replace function public.kc_dev_seed_phase_social()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
begin
  drop table if exists s_users, s_chats;
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

  alter table public.listings enable trigger listings_rate_limit;
  alter table public.giving_handoffs enable trigger giving_handoffs_rate_limit;
  alter table public.follow_edges enable trigger follow_edges_rate_limit;
end;
$$;

create or replace function public.kc_dev_seed_phase_orgs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organizations (
    org_id, name, slug, is_platform, is_verified_nonprofit, verified_at, verification_method,
    public_tagline_he, public_tagline_en, public_about_he, public_about_en
  ) values
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
    is_verified_nonprofit = true, verification_method = excluded.verification_method,
    public_tagline_he = excluded.public_tagline_he, public_tagline_en = excluded.public_tagline_en,
    public_about_he = excluded.public_about_he, public_about_en = excluded.public_about_en;
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
    'rides', (select count(*) from public.ride_listings r join auth.users a on a.id = r.owner_id
      where a.email like '%@seed.kc.test'),
    'organizations', (select count(*) from public.organizations where verification_method = 'demo_seed'))
    || coalesce(p_aux, '{}'::jsonb);
$$;

create or replace function public.kc_dev_seed_advance_phase(p_password_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  st record;
  v_hash text;
  v_world jsonb;
  v_match integer;
  v_aux jsonb;
  v_result jsonb;
begin
  if not exists (select 1 from public.kc_dev_demo_config) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;

  select * into st from public.kc_dev_demo_operation_state where singleton for update;

  if st.operation = 'wipe' and st.phase <> 'idle' then
    raise exception 'demo_operation_busy' using errcode = '42501';
  end if;

  if st.phase = 'idle' then
    v_hash := coalesce(p_password_hash, '');
    if v_hash = '' then
      select password_hash into v_hash from public.kc_dev_demo_config;
    end if;
    if coalesce(v_hash, '') = '' then
      raise exception 'password_required' using errcode = '22023';
    end if;
    update public.kc_dev_demo_operation_state
       set operation = 'seed', phase = 'wipe', actor_id = null, started_at = now(), aux = '{}'::jsonb, updated_at = now();
    st.phase := 'wipe';
  elsif p_password_hash is not null then
    raise exception 'demo_operation_busy' using errcode = '42501';
  end if;

  case st.phase
    when 'wipe' then
      perform public.kc_dev_wipe_demo_data();
      update public.kc_dev_demo_operation_state set phase = 'users', updated_at = now();
      return jsonb_build_object('done', false, 'phase', 'users', 'progress_key', 'wipe');

    when 'users' then
      select password_hash into v_hash from public.kc_dev_demo_config;
      perform public.kc_dev_seed_phase_users(v_hash);
      update public.kc_dev_demo_operation_state set phase = 'items', updated_at = now();
      return jsonb_build_object('done', false, 'phase', 'items', 'progress_key', 'users');

    when 'items' then
      perform public.kc_dev_seed_phase_items();
      update public.kc_dev_demo_operation_state set phase = 'worlds', updated_at = now();
      return jsonb_build_object('done', false, 'phase', 'worlds', 'progress_key', 'items');

    when 'worlds' then
      v_world := public.kc_dev_seed_demo_world_content();
      update public.kc_dev_demo_operation_state
         set phase = 'social', aux = v_world, updated_at = now();
      return jsonb_build_object('done', false, 'phase', 'social', 'progress_key', 'worlds');

    when 'social' then
      perform public.kc_dev_seed_phase_social();
      update public.kc_dev_demo_operation_state set phase = 'matches', updated_at = now();
      return jsonb_build_object('done', false, 'phase', 'matches', 'progress_key', 'social');

    when 'matches' then
      v_match := public.kc_dev_seed_demo_match_candidates();
      v_aux := coalesce(st.aux, '{}'::jsonb) || jsonb_build_object('match_candidates', v_match);
      update public.kc_dev_demo_operation_state set phase = 'orgs', aux = v_aux, updated_at = now();
      return jsonb_build_object('done', false, 'phase', 'orgs', 'progress_key', 'matches');

    when 'orgs' then
      perform public.kc_dev_seed_phase_orgs();
      v_result := public.kc_dev_seed_build_result(st.aux);
      update public.kc_dev_demo_operation_state
         set operation = 'idle', phase = 'idle', actor_id = null, aux = '{}'::jsonb, updated_at = now();
      return jsonb_build_object('done', true, 'phase', 'idle', 'progress_key', 'done', 'result', v_result);

    else
      raise exception 'demo_seed_invalid_phase' using errcode = '22023';
  end case;
end;
$$;

create or replace function public.kc_dev_wipe_advance_phase()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  st record;
  v_ids uuid[];
  v_result jsonb;
begin
  select * into st from public.kc_dev_demo_operation_state where singleton for update;

  if st.operation = 'seed' and st.phase <> 'idle' then
    raise exception 'demo_operation_busy' using errcode = '42501';
  end if;

  if st.phase = 'idle' then
    v_ids := public.kc_dev_wipe_demo_seed_ids();
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      v_result := jsonb_build_object('users_deleted', 0, 'organizations_deleted', 0, 'organizations_kept', 0);
      return jsonb_build_object('done', true, 'progress_key', 'done', 'result', v_result);
    end if;
    update public.kc_dev_demo_operation_state
       set operation = 'wipe', phase = 'content', started_at = now(),
           aux = jsonb_build_object('seed_ids', (select coalesce(jsonb_agg(x::text), '[]'::jsonb) from unnest(v_ids) x)),
           updated_at = now();
    st.phase := 'content';
  end if;

  if st.phase = 'content' then
    v_ids := array(select jsonb_array_elements_text(st.aux->'seed_ids'))::uuid[];
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      v_ids := public.kc_dev_wipe_demo_seed_ids();
    end if;
    perform public.kc_dev_wipe_demo_data_content(v_ids);
    update public.kc_dev_demo_operation_state
       set phase = 'accounts',
           aux = jsonb_build_object('seed_ids', (select coalesce(jsonb_agg(x::text), '[]'::jsonb) from unnest(v_ids) x)),
           updated_at = now();
    return jsonb_build_object('done', false, 'progress_key', 'accounts');
  end if;

  if st.phase = 'accounts' then
    v_ids := array(select jsonb_array_elements_text(st.aux->'seed_ids'))::uuid[];
    v_result := public.kc_dev_wipe_demo_data_accounts(v_ids);
    update public.kc_dev_demo_operation_state
       set operation = 'idle', phase = 'idle', aux = '{}'::jsonb, updated_at = now();
    return jsonb_build_object('done', true, 'progress_key', 'done', 'result', v_result);
  end if;

  raise exception 'demo_wipe_invalid_phase' using errcode = '22023';
end;
$$;

create or replace function public.kc_dev_seed_demo_data(p_password_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '600s'
as $$
declare
  r jsonb;
begin
  if not exists (select 1 from public.kc_dev_demo_config) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;
  if coalesce(p_password_hash, '') = '' then
    raise exception 'password_required' using errcode = '22023';
  end if;

  update public.kc_dev_demo_config set password_hash = p_password_hash;
  update public.kc_dev_demo_operation_state set operation = 'idle', phase = 'idle', aux = '{}'::jsonb;

  r := public.kc_dev_seed_advance_phase(p_password_hash);
  while coalesce(r->>'done', 'false')::boolean = false loop
    r := public.kc_dev_seed_advance_phase(null);
  end loop;
  return r->'result';
end;
$$;

create or replace function public.admin_wipe_demo_data_step()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  v_actor uuid := auth.uid();
  v_out jsonb;
begin
  if not public.can_manage_demo_data(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if public.is_demo_seed_user(v_actor) then
    raise exception 'cannot_wipe_self' using errcode = '42501';
  end if;

  v_out := public.kc_dev_wipe_advance_phase();
  if (v_out->>'done')::boolean then
    insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
    values (v_actor, 'admin_wipe_demo_data', 'none', null, v_out->'result');
  end if;
  return v_out;
end;
$$;

revoke all on function public.admin_wipe_demo_data_step() from public, anon;
grant execute on function public.admin_wipe_demo_data_step() to authenticated;

create or replace function public.admin_seed_demo_data_step(p_password text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  v_actor uuid := auth.uid();
  v_hash text;
  v_out jsonb;
begin
  if not public.can_manage_demo_data(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.kc_dev_demo_config) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;

  if p_password is not null then
    if length(p_password) < 8 then
      raise exception 'password_too_short' using errcode = '22023';
    end if;
    v_hash := extensions.crypt(p_password, extensions.gen_salt('bf'));
    update public.kc_dev_demo_config set password_hash = v_hash;
  end if;

  if (select phase from public.kc_dev_demo_operation_state where singleton) = 'idle' then
    select password_hash into v_hash from public.kc_dev_demo_config;
    if v_hash is null then
      raise exception 'password_required' using errcode = '22023';
    end if;
    v_out := public.kc_dev_seed_advance_phase(v_hash);
  else
    v_out := public.kc_dev_seed_advance_phase(null);
  end if;

  if (v_out->>'done')::boolean then
    perform set_config('request.jwt.claim.sub', v_actor::text, true);
    insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
    values (v_actor, 'admin_seed_demo_data', 'none', null, v_out->'result');
  end if;
  return v_out;
end;
$$;

revoke all on function public.admin_seed_demo_data_step(text) from public, anon;
grant execute on function public.admin_seed_demo_data_step(text) to authenticated;

create or replace function public.admin_wipe_demo_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '300s'
as $$
declare
  v_actor uuid := auth.uid();
  v_out jsonb;
  v_result jsonb;
begin
  if not public.can_manage_demo_data(v_actor) then raise exception 'forbidden' using errcode = '42501'; end if;
  if public.is_demo_seed_user(v_actor) then raise exception 'cannot_wipe_self' using errcode = '42501'; end if;

  update public.kc_dev_demo_operation_state set operation = 'idle', phase = 'idle', aux = '{}'::jsonb;
  v_out := public.kc_dev_wipe_advance_phase();
  while coalesce(v_out->>'done', 'false')::boolean = false loop
    v_out := public.kc_dev_wipe_advance_phase();
  end loop;
  v_result := v_out->'result';
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_wipe_demo_data', 'none', null, v_result);
  return v_result;
end;
$$;

create or replace function public.admin_seed_demo_data(p_password text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '600s'
as $$
declare
  v_actor uuid := auth.uid();
  v_out jsonb;
  v_result jsonb;
begin
  if not public.can_manage_demo_data(v_actor) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.kc_dev_demo_config) then raise exception 'not_dev_environment' using errcode = '42501'; end if;

  v_out := public.admin_seed_demo_data_step(p_password);
  while coalesce(v_out->>'done', 'false')::boolean = false loop
    v_out := public.admin_seed_demo_data_step(null);
  end loop;
  v_result := v_out->'result';
  return v_result;
end;
$$;

commit;
