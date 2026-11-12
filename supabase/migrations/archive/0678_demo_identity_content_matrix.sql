-- 0678_demo_identity_content_matrix | #1964: demo profile fields, verification 0..2 spread, item visibility mix.

begin;

create or replace function public.kc_dev_seed_demo_user_profiles()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users u
     set profile_street = coalesce(nullif(btrim(u.profile_street), ''), 'הרצל'),
         profile_street_number = coalesce(nullif(btrim(u.profile_street_number), ''),
           lpad(((substring(a.email from 'user([0-9]+)@'))::int % 199 + 1)::text, 3, '0')),
         contact_phone = coalesce(nullif(btrim(u.contact_phone), ''),
           '050' || lpad(((substring(a.email from 'user([0-9]+)@'))::int % 9000000 + 1000000)::text, 7, '0')),
         date_of_birth = coalesce(u.date_of_birth,
           (current_date - ((18 + ((substring(a.email from 'user([0-9]+)@'))::int % 45))::int * interval '1 year'))::date),
         avatar_url = coalesce(nullif(btrim(u.avatar_url), ''),
           'demo/kc-dev/avatars/' || (((substring(a.email from 'user([0-9]+)@'))::int % 12) + 1)::text || '.jpg')
    from auth.users a
   where a.id = u.user_id
     and a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true';
end;
$$;

comment on function public.kc_dev_seed_demo_user_profiles() is
  'kc-dev only: fills FR-VERIFY profile fields on seed users (synthetic phone/DOB 18+, demo avatar paths).';

revoke all on function public.kc_dev_seed_demo_user_profiles() from public, anon, authenticated;
grant execute on function public.kc_dev_seed_demo_user_profiles() to service_role;

create or replace function public.kc_dev_seed_demo_verification_mix()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.kc_dev_seed_demo_user_profiles();

  update public.users u
     set avatar_url = null,
         date_of_birth = null,
         contact_phone = null,
         profile_street = null,
         profile_street_number = null,
         verified_at = null,
         verification_method = null
    from auth.users a
   where a.id = u.user_id
     and a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and (substring(a.email from 'user([0-9]+)@'))::int % 4 = 0;

  update public.users u
     set verified_at = null,
         verification_method = null
    from auth.users a
   where a.id = u.user_id
     and a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and (substring(a.email from 'user([0-9]+)@'))::int % 4 = 1;

  update public.users u
     set verified_at = coalesce(u.verified_at, now()),
         verification_method = 'manual'
    from auth.users a
   where a.id = u.user_id
     and a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and (substring(a.email from 'user([0-9]+)@'))::int % 4 = 2;

  update public.users u
     set verified_at = coalesce(u.verified_at, now()),
         verification_method = 'provider'
    from auth.users a
   where a.id = u.user_id
     and a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and (substring(a.email from 'user([0-9]+)@'))::int % 4 = 3;
end;
$$;

comment on function public.kc_dev_seed_demo_verification_mix() is
  'kc-dev only: spreads seed users across verification levels 0..2 after worlds seed (overrides blanket verify).';

revoke all on function public.kc_dev_seed_demo_verification_mix() from public, anon, authenticated;
grant execute on function public.kc_dev_seed_demo_verification_mix() to service_role;

-- Item posts: add OnlyMe slice alongside existing FollowersOnly (FR-POST visibility matrix).
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
    case
      when g % 17 = 0 then 'OnlyMe'
      when g % 10 = 0 then 'FollowersOnly'
      else 'Public'
    end,
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
    when 'social' then perform public.kc_dev_seed_phase_social();
    when 'matches' then v_match := public.kc_dev_seed_demo_match_candidates();
    when 'orgs' then perform public.kc_dev_seed_phase_orgs();
    else raise exception 'demo_seed_invalid_phase' using errcode = '22023';
  end case;
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('request.jwt.claim.sub', v_sub, true);
  return jsonb_build_object('world', v_world, 'match_candidates', v_match);
end;
$$;

commit;
