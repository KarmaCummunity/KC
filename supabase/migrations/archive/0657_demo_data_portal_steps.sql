-- 0657_demo_data_portal_steps | FR-ADMIN-031
-- Portal wipe/seed failed on kc-dev for two reasons:
-- 1. safeupdate rejects UPDATE without a WHERE (singleton config/state rows).
-- 2. ALTER TABLE ... DISABLE TRIGGER takes an exclusive lock and hits lock_timeout,
--    and one-shot deletes of match_candidates did the same under live traffic.
-- Each portal call now deletes one short batch (skip locked) and write caps are
-- skipped by clearing JWT claims for the insert, without locking the table.

begin;

create or replace function public.legal_document_versions_block_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and current_setting('kc.allow_publisher_reassign', true) = 'on'
     and new.published_by is distinct from old.published_by
     and (to_jsonb(new) - 'published_by') = (to_jsonb(old) - 'published_by')
  then
    return new;
  end if;
  raise exception 'legal_document_versions is append-only';
end;
$$;

create or replace function public.trg_messages_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
begin
  if v_claims = '' or pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.kind = 'user' and new.sender_id is not null then
    perform public.enforce_rate_limit('messages:' || new.sender_id::text, 10, 1);
  end if;
  return new;
end;
$$;

create or replace function public.kc_dev_wipe_next_step(p_step text)
returns text
language sql
immutable
as $$
  select case p_step
    when 'match_candidates' then 'match_listing_state'
    when 'match_listing_state' then 'giving_handoffs'
    when 'giving_handoffs' then 'listings'
    when 'listings' then 'challenge_progress'
    when 'challenge_progress' then 'challenge_participations'
    when 'challenge_participations' then 'challenges'
    when 'challenges' then 'saved_posts'
    when 'saved_posts' then 'rides'
    when 'rides' then 'messages'
    when 'messages' then 'chats'
    when 'chats' then 'follows'
    when 'follows' then 'recipients'
    when 'recipients' then 'posts'
    when 'posts' then 'driver_declarations'
    when 'driver_declarations' then 'housing_conduct'
    when 'housing_conduct' then 'accounts'
    else 'accounts'
  end;
$$;

-- Deletes up to p_limit rows for one wipe step. Locked rows are skipped.
-- remaining=true means call this step again (more rows, or all of them were locked).
create or replace function public.kc_dev_wipe_delete_limited(p_step text, p_ids uuid[], p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
  v_left boolean := false;
begin
  perform set_config('lock_timeout', '2s', true);

  case p_step
    when 'match_candidates' then
      with doomed as (
        select mc.ctid from public.match_candidates mc
         where mc.offer_owner_id = any (p_ids) or mc.request_owner_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.match_candidates mc using doomed d where mc.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.match_candidates mc
          where mc.offer_owner_id = any (p_ids) or mc.request_owner_id = any (p_ids)) into v_left;
      end if;
    when 'match_listing_state' then
      with doomed as (
        select mls.ctid from public.match_listing_state mls
          join public.listings l on l.listing_id = mls.listing_id
         where l.owner_id = any (p_ids)
         limit p_limit for update of mls skip locked)
      delete from public.match_listing_state mls using doomed d where mls.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.match_listing_state mls
          join public.listings l on l.listing_id = mls.listing_id
         where l.owner_id = any (p_ids)) into v_left;
      end if;
    when 'giving_handoffs' then
      with doomed as (
        select gh.ctid from public.giving_handoffs gh
         where gh.owner_id = any (p_ids) or gh.recipient_id = any (p_ids)
            or gh.listing_id in (select l.listing_id from public.listings l where l.owner_id = any (p_ids))
         limit p_limit for update skip locked)
      delete from public.giving_handoffs gh using doomed d where gh.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.giving_handoffs gh
          where gh.owner_id = any (p_ids) or gh.recipient_id = any (p_ids)
             or gh.listing_id in (select l.listing_id from public.listings l where l.owner_id = any (p_ids))) into v_left;
      end if;
    when 'listings' then
      with doomed as (
        select l.ctid from public.listings l where l.owner_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.listings l using doomed d where l.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.listings l where l.owner_id = any (p_ids)) into v_left;
      end if;
    when 'challenge_progress' then
      with doomed as (
        select cpe.ctid from public.challenge_progress_entries cpe
         where cpe.user_id = any (p_ids)
            or cpe.challenge_id in (select c.challenge_id from public.challenges c where c.creator_id = any (p_ids))
         limit p_limit for update skip locked)
      delete from public.challenge_progress_entries cpe using doomed d where cpe.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.challenge_progress_entries cpe
          where cpe.user_id = any (p_ids)
             or cpe.challenge_id in (select c.challenge_id from public.challenges c where c.creator_id = any (p_ids))) into v_left;
      end if;
    when 'challenge_participations' then
      with doomed as (
        select cp.ctid from public.challenge_participations cp
         where cp.user_id = any (p_ids)
            or cp.challenge_id in (select c.challenge_id from public.challenges c where c.creator_id = any (p_ids))
         limit p_limit for update skip locked)
      delete from public.challenge_participations cp using doomed d where cp.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.challenge_participations cp
          where cp.user_id = any (p_ids)
             or cp.challenge_id in (select c.challenge_id from public.challenges c where c.creator_id = any (p_ids))) into v_left;
      end if;
    when 'challenges' then
      with doomed as (
        select c.ctid from public.challenges c where c.creator_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.challenges c using doomed d where c.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.challenges c where c.creator_id = any (p_ids)) into v_left;
      end if;
    when 'saved_posts' then
      with doomed as (
        select sp.ctid from public.saved_posts sp where sp.user_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.saved_posts sp using doomed d where sp.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.saved_posts sp where sp.user_id = any (p_ids)) into v_left;
      end if;
    when 'rides' then
      with doomed as (
        select rl.ctid from public.ride_listings rl where rl.owner_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.ride_listings rl using doomed d where rl.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.ride_listings rl where rl.owner_id = any (p_ids)) into v_left;
      end if;
    when 'messages' then
      with doomed as (
        select m.ctid from public.messages m
         where m.sender_id = any (p_ids)
            or m.chat_id in (
              select c.chat_id from public.chats c
               where c.participant_a = any (p_ids) or c.participant_b = any (p_ids))
         limit p_limit for update skip locked)
      delete from public.messages m using doomed d where m.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.messages m
          where m.sender_id = any (p_ids)
             or m.chat_id in (
               select c.chat_id from public.chats c
                where c.participant_a = any (p_ids) or c.participant_b = any (p_ids))) into v_left;
      end if;
    when 'chats' then
      with doomed as (
        select c.ctid from public.chats c
         where c.participant_a = any (p_ids) or c.participant_b = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.chats c using doomed d where c.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.chats c
          where c.participant_a = any (p_ids) or c.participant_b = any (p_ids)) into v_left;
      end if;
    when 'follows' then
      with doomed as (
        select f.ctid from public.follow_edges f
         where f.follower_id = any (p_ids) or f.followed_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.follow_edges f using doomed d where f.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.follow_edges f
          where f.follower_id = any (p_ids) or f.followed_id = any (p_ids)) into v_left;
      end if;
    when 'recipients' then
      with doomed as (
        select r.ctid from public.recipients r
         where r.recipient_user_id = any (p_ids)
            or r.post_id in (select p.post_id from public.posts p where p.owner_id = any (p_ids))
         limit p_limit for update skip locked)
      delete from public.recipients r using doomed d where r.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.recipients r
          where r.recipient_user_id = any (p_ids)
             or r.post_id in (select p.post_id from public.posts p where p.owner_id = any (p_ids))) into v_left;
      end if;
    when 'posts' then
      with doomed as (
        select p.ctid from public.posts p where p.owner_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.posts p using doomed d where p.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.posts p where p.owner_id = any (p_ids)) into v_left;
      end if;
    when 'driver_declarations' then
      with doomed as (
        select d.ctid from public.driver_declarations d where d.user_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.driver_declarations d using doomed d2 where d.ctid = d2.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.driver_declarations d where d.user_id = any (p_ids)) into v_left;
      end if;
    when 'housing_conduct' then
      with doomed as (
        select h.ctid from public.housing_conduct_acceptances h where h.user_id = any (p_ids)
         limit p_limit for update skip locked)
      delete from public.housing_conduct_acceptances h using doomed d where h.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.housing_conduct_acceptances h where h.user_id = any (p_ids)) into v_left;
      end if;
    else
      raise exception 'demo_wipe_invalid_phase' using errcode = '22023';
  end case;

  if v_n >= p_limit then
    v_left := true;
  end if;
  return jsonb_build_object('deleted', v_n, 'remaining', coalesce(v_left, false));
end;
$$;

-- One portal call: walk empty steps, delete at most 500 rows, then return.
create or replace function public.kc_dev_wipe_content_slice(p_ids uuid[], p_step text)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '40s'
as $$
declare
  v_step text := coalesce(nullif(p_step, ''), 'match_candidates');
  v_total int := 0;
  v_one jsonb;
  v_del int;
  v_hop int;
begin
  if v_step = 'accounts' or coalesce(array_length(p_ids, 1), 0) = 0 then
    return jsonb_build_object('step', 'accounts', 'content_done', true, 'deleted', 0, 'retry', false);
  end if;

  for v_hop in 1..24 loop
    v_one := public.kc_dev_wipe_delete_limited(v_step, p_ids, greatest(1, 500 - v_total));
    v_del := coalesce((v_one->>'deleted')::int, 0);
    v_total := v_total + v_del;
    if coalesce((v_one->>'remaining')::boolean, false) then
      return jsonb_build_object(
        'step', v_step, 'content_done', false, 'deleted', v_total, 'retry', v_del = 0);
    end if;
    v_step := public.kc_dev_wipe_next_step(v_step);
    if v_step = 'accounts' or v_total >= 500 then
      return jsonb_build_object(
        'step', v_step, 'content_done', v_step = 'accounts', 'deleted', v_total, 'retry', false);
    end if;
  end loop;

  return jsonb_build_object(
    'step', v_step, 'content_done', v_step = 'accounts', 'deleted', v_total, 'retry', false);
end;
$$;

create or replace function public.kc_dev_wipe_demo_data_content(p_seed_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '300s'
as $$
declare
  v_step text := 'match_candidates';
  v_batch jsonb;
  v_guard int := 0;
  v_spins int := 0;
begin
  if coalesce(array_length(p_seed_ids, 1), 0) = 0 then
    return;
  end if;
  while v_guard < 400 and v_step <> 'accounts' loop
    v_guard := v_guard + 1;
    v_batch := public.kc_dev_wipe_content_slice(p_seed_ids, v_step);
    if coalesce((v_batch->>'content_done')::boolean, false) then
      return;
    end if;
    if coalesce((v_batch->>'deleted')::int, 0) = 0 and v_batch->>'step' = v_step then
      v_spins := v_spins + 1;
      if v_spins > 20 then
        raise exception 'demo_wipe_lock_timeout' using errcode = '55P03';
      end if;
      perform pg_sleep(0.05);
    else
      v_spins := 0;
    end if;
    v_step := coalesce(v_batch->>'step', 'accounts');
  end loop;
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
  if coalesce(array_length(p_seed_ids, 1), 0) > 0 then
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
      perform set_config('kc.allow_publisher_reassign', 'on', true);
      update public.legal_document_versions
         set published_by = v_keep_admin
       where published_by = any (p_seed_ids);
      update public.survey_versions
         set published_by = v_keep_admin
       where published_by = any (p_seed_ids);
    elsif exists (
      select 1 from public.legal_document_versions where published_by = any (p_seed_ids)
      union all select 1 from public.survey_versions where published_by = any (p_seed_ids)
    ) then
      raise exception 'demo_wipe_blocked_publisher_refs' using errcode = '23503';
    end if;

    update public.donation_links set hidden_by = null where hidden_by = any (p_seed_ids);
    delete from auth.users u where u.id = any (p_seed_ids);
    get diagnostics v_users = row_count;
  end if;

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
declare
  v_ids uuid[] := public.kc_dev_wipe_demo_seed_ids();
begin
  perform public.kc_dev_wipe_demo_data_content(v_ids);
  return public.kc_dev_wipe_demo_data_accounts(v_ids);
end;
$$;

-- Drop the exclusive lock. Callers clear JWT claims around this function so write caps no-op.
create or replace function public.kc_dev_seed_phase_users(p_password_hash text)
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
begin
  drop table if exists s_first, s_last, s_city, s_users; -- migration-safety: allow — session temp tables from a previous step
  perform setseed(0.4242);

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
    when 'users' then perform public.kc_dev_seed_phase_users(p_hash);
    when 'items' then perform public.kc_dev_seed_phase_items();
    when 'worlds' then v_world := public.kc_dev_seed_demo_world_content();
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

create or replace function public.kc_dev_seed_advance_phase(p_password_hash text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  v_op text;
  v_phase text;
  v_aux jsonb;
  v_updated timestamptz;
  v_hash text;
  v_ids uuid[];
  v_step text;
  v_batch jsonb;
  v_wrapped jsonb;
  v_result jsonb;
begin
  if not exists (select 1 from public.kc_dev_demo_config) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;

  select operation, phase, aux, updated_at
    into v_op, v_phase, v_aux, v_updated
    from public.kc_dev_demo_operation_state
   where singleton
   for update;

  if v_phase <> 'idle' and v_updated < now() - interval '3 minutes' then
    update public.kc_dev_demo_operation_state
       set operation = 'idle', phase = 'idle', aux = '{}'::jsonb, actor_id = null, updated_at = now()
     where singleton;
    v_op := 'idle';
    v_phase := 'idle';
    v_aux := '{}'::jsonb;
  end if;

  if v_op = 'wipe' and v_phase <> 'idle' then
    raise exception 'demo_operation_busy' using errcode = '42501';
  end if;

  if v_phase = 'idle' then
    v_hash := coalesce(p_password_hash, '');
    if v_hash = '' then
      select password_hash into v_hash from public.kc_dev_demo_config where singleton;
    end if;
    if coalesce(v_hash, '') = '' then
      raise exception 'password_required' using errcode = '22023';
    end if;
    v_aux := jsonb_build_object('wipe_step', 'match_candidates');
    update public.kc_dev_demo_operation_state
       set operation = 'seed', phase = 'wipe', actor_id = null, started_at = now(),
           aux = v_aux, updated_at = now()
     where singleton;
    v_phase := 'wipe';
  elsif p_password_hash is not null then
    raise exception 'demo_operation_busy' using errcode = '42501';
  end if;

  if v_phase = 'wipe' then
    v_ids := public.kc_dev_wipe_demo_seed_ids();
    v_step := coalesce(v_aux->>'wipe_step', 'match_candidates');
    if v_step = 'accounts' then
      perform public.kc_dev_wipe_demo_data_accounts(v_ids);
      update public.kc_dev_demo_operation_state
         set phase = 'users', aux = '{}'::jsonb, updated_at = now()
       where singleton;
      return jsonb_build_object('done', false, 'phase', 'users', 'progress_key', 'wipe', 'retry', false);
    end if;
    v_batch := public.kc_dev_wipe_content_slice(v_ids, v_step);
    if coalesce((v_batch->>'content_done')::boolean, false) then
      update public.kc_dev_demo_operation_state
         set aux = jsonb_build_object('wipe_step', 'accounts'), updated_at = now()
       where singleton;
      return jsonb_build_object('done', false, 'phase', 'wipe', 'progress_key', 'wipe', 'retry', false);
    end if;
    update public.kc_dev_demo_operation_state
       set aux = jsonb_build_object('wipe_step', v_batch->>'step'), updated_at = now()
     where singleton;
    return jsonb_build_object(
      'done', false, 'phase', 'wipe', 'progress_key', 'wipe',
      'retry', coalesce((v_batch->>'retry')::boolean, false));
  end if;

  if v_phase = 'users' then
    select password_hash into v_hash from public.kc_dev_demo_config where singleton;
    perform public.kc_dev_seed_with_caps_off('users', v_hash);
    update public.kc_dev_demo_operation_state set phase = 'items', updated_at = now() where singleton;
    return jsonb_build_object('done', false, 'phase', 'items', 'progress_key', 'users', 'retry', false);
  elsif v_phase = 'items' then
    perform public.kc_dev_seed_with_caps_off('items', null);
    update public.kc_dev_demo_operation_state set phase = 'worlds', updated_at = now() where singleton;
    return jsonb_build_object('done', false, 'phase', 'worlds', 'progress_key', 'items', 'retry', false);
  elsif v_phase = 'worlds' then
    v_wrapped := public.kc_dev_seed_with_caps_off('worlds', null);
    update public.kc_dev_demo_operation_state
       set phase = 'social', aux = coalesce(v_wrapped->'world', '{}'::jsonb), updated_at = now()
     where singleton;
    return jsonb_build_object('done', false, 'phase', 'social', 'progress_key', 'worlds', 'retry', false);
  elsif v_phase = 'social' then
    perform public.kc_dev_seed_with_caps_off('social', null);
    update public.kc_dev_demo_operation_state set phase = 'matches', updated_at = now() where singleton;
    return jsonb_build_object('done', false, 'phase', 'matches', 'progress_key', 'social', 'retry', false);
  elsif v_phase = 'matches' then
    v_wrapped := public.kc_dev_seed_with_caps_off('matches', null);
    v_aux := coalesce(v_aux, '{}'::jsonb) || jsonb_build_object('match_candidates', v_wrapped->'match_candidates');
    update public.kc_dev_demo_operation_state set phase = 'orgs', aux = v_aux, updated_at = now() where singleton;
    return jsonb_build_object('done', false, 'phase', 'orgs', 'progress_key', 'matches', 'retry', false);
  elsif v_phase = 'orgs' then
    perform public.kc_dev_seed_with_caps_off('orgs', null);
    v_result := public.kc_dev_seed_build_result(v_aux);
    update public.kc_dev_demo_operation_state
       set operation = 'idle', phase = 'idle', actor_id = null, aux = '{}'::jsonb, updated_at = now()
     where singleton;
    return jsonb_build_object('done', true, 'phase', 'idle', 'progress_key', 'done', 'retry', false, 'result', v_result);
  end if;

  raise exception 'demo_seed_invalid_phase' using errcode = '22023';
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
  v_op text;
  v_phase text;
  v_aux jsonb;
  v_updated timestamptz;
  v_ids uuid[];
  v_step text;
  v_batch jsonb;
  v_result jsonb;
begin
  select operation, phase, aux, updated_at
    into v_op, v_phase, v_aux, v_updated
    from public.kc_dev_demo_operation_state
   where singleton
   for update;

  if v_phase <> 'idle' and v_updated < now() - interval '3 minutes' then
    update public.kc_dev_demo_operation_state
       set operation = 'idle', phase = 'idle', aux = '{}'::jsonb, updated_at = now()
     where singleton;
    v_op := 'idle';
    v_phase := 'idle';
  end if;

  if v_op = 'seed' and v_phase <> 'idle' then
    raise exception 'demo_operation_busy' using errcode = '42501';
  end if;

  if v_phase = 'idle' then
    v_aux := jsonb_build_object('wipe_step', 'match_candidates');
    update public.kc_dev_demo_operation_state
       set operation = 'wipe', phase = 'content', started_at = now(), aux = v_aux, updated_at = now()
     where singleton;
    v_phase := 'content';
  end if;

  v_ids := public.kc_dev_wipe_demo_seed_ids();

  if v_phase = 'content' then
    v_step := coalesce(v_aux->>'wipe_step', 'match_candidates');
    v_batch := public.kc_dev_wipe_content_slice(v_ids, v_step);
    if coalesce((v_batch->>'content_done')::boolean, false) then
      update public.kc_dev_demo_operation_state
         set phase = 'accounts', aux = '{}'::jsonb, updated_at = now()
       where singleton;
      return jsonb_build_object('done', false, 'progress_key', 'accounts', 'retry', false);
    end if;
    update public.kc_dev_demo_operation_state
       set aux = jsonb_build_object('wipe_step', v_batch->>'step'), updated_at = now()
     where singleton;
    return jsonb_build_object(
      'done', false, 'progress_key', 'content',
      'retry', coalesce((v_batch->>'retry')::boolean, false));
  end if;

  if v_phase = 'accounts' then
    v_result := public.kc_dev_wipe_demo_data_accounts(v_ids);
    update public.kc_dev_demo_operation_state
       set operation = 'idle', phase = 'idle', aux = '{}'::jsonb, updated_at = now()
     where singleton;
    return jsonb_build_object('done', true, 'progress_key', 'done', 'retry', false, 'result', v_result);
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
  v_guard int := 0;
begin
  if not exists (select 1 from public.kc_dev_demo_config) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;
  if coalesce(p_password_hash, '') = '' then
    raise exception 'password_required' using errcode = '22023';
  end if;

  update public.kc_dev_demo_config set password_hash = p_password_hash where singleton;
  update public.kc_dev_demo_operation_state
     set operation = 'idle', phase = 'idle', aux = '{}'::jsonb, updated_at = now()
   where singleton;

  r := public.kc_dev_seed_advance_phase(p_password_hash);
  while coalesce(r->>'done', 'false')::boolean = false and v_guard < 400 loop
    v_guard := v_guard + 1;
    if coalesce((r->>'retry')::boolean, false) then
      perform pg_sleep(0.05);
    end if;
    r := public.kc_dev_seed_advance_phase(null);
  end loop;
  if coalesce(r->>'done', 'false')::boolean = false then
    raise exception 'demo_seed_incomplete' using errcode = '57014';
  end if;
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
    update public.kc_dev_demo_config set password_hash = v_hash where singleton;
  end if;

  if (select phase from public.kc_dev_demo_operation_state where singleton) = 'idle' then
    select password_hash into v_hash from public.kc_dev_demo_config where singleton;
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

  update public.kc_dev_demo_operation_state
     set operation = 'idle', phase = 'idle', aux = '{}'::jsonb, updated_at = now()
   where singleton;
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

revoke all on function public.kc_dev_wipe_next_step(text) from public, anon, authenticated;
revoke all on function public.kc_dev_wipe_delete_limited(text, uuid[], int) from public, anon, authenticated;
revoke all on function public.kc_dev_wipe_content_slice(uuid[], text) from public, anon, authenticated;
revoke all on function public.kc_dev_seed_with_caps_off(text, text) from public, anon, authenticated;

commit;
