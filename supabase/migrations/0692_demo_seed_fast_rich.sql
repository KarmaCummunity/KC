-- 0692_demo_seed_fast_rich | #1964: bulk admin wipe/seed RPCs, +2 demo orgs, moderation reports, wipe reports slice.

begin;

-- ── Wipe: reports tied to seed users / their posts / chats ───────────────────
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
    when 'chats' then 'reports'
    when 'reports' then 'follows'
    when 'follows' then 'recipients'
    when 'recipients' then 'posts'
    when 'posts' then 'driver_declarations'
    when 'driver_declarations' then 'housing_conduct'
    when 'housing_conduct' then 'accounts'
    else 'accounts'
  end;
$$;

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
          join public.posts p on p.post_id = mls.listing_id
         where p.owner_id = any (p_ids)
         limit p_limit for update of mls skip locked)
      delete from public.match_listing_state mls using doomed d where mls.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.match_listing_state mls
          join public.posts p on p.post_id = mls.listing_id
         where p.owner_id = any (p_ids)) into v_left;
      end if;
    when 'giving_handoffs' then
      with doomed as (
        select ph.ctid from public.post_handoffs ph
         where ph.owner_id = any (p_ids) or ph.recipient_id = any (p_ids)
            or ph.post_id in (select p.post_id from public.posts p where p.owner_id = any (p_ids))
         limit p_limit for update skip locked)
      delete from public.post_handoffs ph using doomed d where ph.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.post_handoffs ph
          where ph.owner_id = any (p_ids) or ph.recipient_id = any (p_ids)
             or ph.post_id in (select p.post_id from public.posts p where p.owner_id = any (p_ids))) into v_left;
      end if;
    when 'listings' then
      -- Compatibility view over posts: deletions are handled in the 'posts' step.
      v_n := 0;
      v_left := false;
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
        select r.ctid from public.ride_post_details r
          join public.posts p on p.post_id = r.post_id
         where p.owner_id = any (p_ids)
         limit p_limit for update of r skip locked)
      delete from public.ride_post_details r using doomed d where r.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (select 1 from public.ride_post_details r
          join public.posts p on p.post_id = r.post_id
         where p.owner_id = any (p_ids)) into v_left;
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
    when 'reports' then
      with doomed as (
        select r.ctid from public.reports r
         where r.reporter_id = any (p_ids)
            or (r.target_type = 'user' and r.target_id = any (p_ids))
            or (r.target_type = 'post' and r.target_id in (
                  select p.post_id from public.posts p where p.owner_id = any (p_ids)))
            or (r.target_type = 'chat' and r.target_id in (
                  select c.chat_id from public.chats c
                   where c.participant_a = any (p_ids) or c.participant_b = any (p_ids)))
         limit p_limit for update skip locked)
      delete from public.reports r using doomed d where r.ctid = d.ctid;
      get diagnostics v_n = row_count;
      if v_n < p_limit then
        select exists (
          select 1 from public.reports r
           where r.reporter_id = any (p_ids)
              or (r.target_type = 'user' and r.target_id = any (p_ids))
              or (r.target_type = 'post' and r.target_id in (
                    select p.post_id from public.posts p where p.owner_id = any (p_ids)))
              or (r.target_type = 'chat' and r.target_id in (
                    select c.chat_id from public.chats c
                     where c.participant_a = any (p_ids) or c.participant_b = any (p_ids)))
        ) into v_left;
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

-- ── Five demo nonprofits with full role matrix ───────────────────────────────
create or replace function public.kc_dev_seed_phase_orgs()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_roles text[] := array['org_admin','org_manager','org_employee','org_volunteer','volunteer'];
  v_role text;
  v_i int;
  v_user uuid;
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
     'עמותת הדגמה לסביבת הפיתוח בלבד. אין לתרום כסף אמיתי.', 'Demo nonprofit for the dev environment only. Do not send real money.'),
    ('00000000-0000-0000-0000-00000000d004'::uuid, '[DEMO] גשר לעתיד', 'demo-gesher-laatid', false, true, now(), 'demo_seed',
     'עמותת הדגמה – ליווי לשוק העבודה', 'Demo nonprofit – employment mentoring',
     'עמותת הדגמה לסביבת הפיתוח בלבד.', 'Demo nonprofit for the dev environment only.'),
    ('00000000-0000-0000-0000-00000000d005'::uuid, '[DEMO] קהילה בטוחה', 'demo-kehila-betucha', false, true, now(), 'demo_seed',
     'עמותת הדגמה – מרכז תמיכה קהילתי', 'Demo nonprofit – community support hub',
     'עמותת הדגמה לסביבת הפיתוח בלבד.', 'Demo nonprofit for the dev environment only.')
  on conflict (slug) do update set
    is_verified_nonprofit = true, verification_method = excluded.verification_method,
    public_tagline_he = excluded.public_tagline_he, public_tagline_en = excluded.public_tagline_en,
    public_about_he = excluded.public_about_he, public_about_en = excluded.public_about_en;

  for v_org in
    select o.org_id from public.organizations o where o.verification_method = 'demo_seed'
  loop
    v_i := 0;
    foreach v_role in array v_roles loop
      select au.id into v_user
        from auth.users au
       where au.email like '%@seed.kc.test'
         and coalesce(au.raw_app_meta_data->>'seed', '') = 'true'
       order by md5(au.id::text || v_org::text || v_role)
       offset v_i limit 1;
      v_i := v_i + 1;
      if v_user is null then continue; end if;
      insert into public.org_memberships (org_id, user_id, role)
      values (v_org, v_user, v_role)
      on conflict on constraint org_memberships_unique do nothing;
    end loop;
  end loop;
end;
$$;

-- ── Moderation inbox fixtures (reports on users, posts, chats) ─────────────────
create or replace function public.kc_dev_seed_demo_reports()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
declare
  v_resolver uuid;
  v_now timestamptz := now();
begin
  select u.user_id into v_resolver
    from public.users u
   where not public.is_demo_seed_user(u.user_id)
   order by u.is_super_admin desc nulls last
   limit 1;

  insert into public.reports (reporter_id, target_type, target_id, reason, note, status, created_at)
  select
    r.reporter_id,
    'user',
    r.target_id,
    (array['Spam','Offensive','Misleading','Illegal','Other'])[1 + (r.g % 5)],
    'דיווח דמה על משתמש',
    'open',
    v_now - ((r.g % 14) || ' days')::interval
  from (
    select g,
      (select au.id from auth.users au
        where au.email like '%@seed.kc.test' and coalesce(au.raw_app_meta_data->>'seed','') = 'true'
        order by md5(au.id::text || g::text) offset 0 limit 1) as reporter_id,
      (select au.id from auth.users au
        where au.email like '%@seed.kc.test' and coalesce(au.raw_app_meta_data->>'seed','') = 'true'
        order by md5(au.id::text || (g + 17)::text) offset 1 limit 1) as target_id
    from generate_series(1, 35) g
  ) r
  where r.reporter_id is not null and r.target_id is not null and r.reporter_id <> r.target_id;

  insert into public.reports (reporter_id, target_type, target_id, reason, note, status, created_at)
  select
    (select au.id from auth.users au
      where au.email like '%@seed.kc.test' and coalesce(au.raw_app_meta_data->>'seed','') = 'true'
      order by md5(au.id::text || g::text) offset 0 limit 1),
    'post',
    (select p.post_id from public.posts p
      join auth.users a on a.id = p.owner_id
     where a.email like '%@seed.kc.test'
     order by md5(p.post_id::text || g::text) offset 0 limit 1),
    (array['Spam','Offensive','Misleading'])[1 + (g % 3)],
    'דיווח דמה על פוסט',
    'open',
    v_now - ((g % 10) || ' days')::interval
  from generate_series(1, 40) g
  where exists (select 1 from public.posts p join auth.users a on a.id = p.owner_id where a.email like '%@seed.kc.test');

  insert into public.reports (reporter_id, target_type, target_id, reason, note, status, created_at)
  select
    c.participant_a,
    'chat',
    c.chat_id,
    (array['Spam','Offensive','Other'])[1 + (c.g % 3)],
    'דיווח דמה על שיחה',
    'open',
    v_now - ((c.g % 7) || ' days')::interval
  from (
    select chat_id, participant_a, row_number() over (order by chat_id) as g
    from public.chats c
    where c.participant_a in (select id from auth.users where email like '%@seed.kc.test')
    limit 30
  ) c;

  insert into public.reports (reporter_id, target_type, target_id, reason, note, status, created_at)
  select
    (select au.id from auth.users au
      where au.email like '%@seed.kc.test' and coalesce(au.raw_app_meta_data->>'seed','') = 'true'
      order by md5(au.id::text || g::text) offset 0 limit 1),
    'none',
    null,
    'Other',
    'דיווח כללי (ללא יעד)',
    'open',
    v_now - ((g % 5) || ' days')::interval
  from generate_series(1, 8) g;

  if v_resolver is not null then
    update public.reports r
       set status = 'dismissed_no_violation',
           resolved_at = r.created_at + interval '2 days',
           resolved_by = v_resolver
     where r.report_id in (
       select report_id from public.reports
        where reporter_id in (select id from auth.users where email like '%@seed.kc.test')
        order by created_at
        offset 10 limit 25
     );

    update public.reports r
       set status = 'confirmed_violation',
           resolved_at = r.created_at + interval '1 day',
           resolved_by = v_resolver
     where r.report_id in (
       select report_id from public.reports
        where reporter_id in (select id from auth.users where email like '%@seed.kc.test')
        order by created_at
        offset 35 limit 15
     );
  end if;
end;
$$;

comment on function public.kc_dev_seed_demo_reports() is
  'kc-dev only: open + resolved moderation reports on seed users, posts, chats, and issue (none) targets.';

revoke all on function public.kc_dev_seed_demo_reports() from public, anon, authenticated;
grant execute on function public.kc_dev_seed_demo_reports() to service_role;

-- Hook reports after social (chats must exist first).
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
    when 'social' then
      perform public.kc_dev_seed_phase_social();
      perform public.kc_dev_seed_demo_reports();
    when 'matches' then v_match := public.kc_dev_seed_demo_match_candidates();
    when 'orgs' then perform public.kc_dev_seed_phase_orgs();
    else raise exception 'demo_seed_invalid_phase' using errcode = '22023';
  end case;
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('request.jwt.claim.sub', v_sub, true);
  return jsonb_build_object('world', v_world, 'match_candidates', v_match);
end;
$$;

-- ── KPIs: chats + reports ───────────────────────────────────────────────────
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

  select count(*) into v_legacy_rides
    from public.ride_listings r
    join auth.users a on a.id = r.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true';

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

-- ── Portal: one HTTP round-trip (server still batches internally) ────────────
create or replace function public.admin_wipe_demo_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '600s'
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if not public.can_manage_demo_data(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if public.is_demo_seed_user(v_actor) then
    raise exception 'cannot_wipe_self' using errcode = '42501';
  end if;

  update public.kc_dev_demo_operation_state
     set operation = 'idle', phase = 'idle', aux = '{}'::jsonb, updated_at = now()
   where singleton;

  v_result := public.kc_dev_wipe_demo_data();

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
  v_hash text;
  v_result jsonb;
begin
  if not public.can_manage_demo_data(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.kc_dev_demo_config) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;

  if p_password is not null and length(p_password) < 8 then
    raise exception 'password_too_short' using errcode = '22023';
  end if;

  if p_password is not null then
    v_hash := extensions.crypt(p_password, extensions.gen_salt('bf'));
    update public.kc_dev_demo_config set password_hash = v_hash where singleton;
  else
    select password_hash into v_hash from public.kc_dev_demo_config where singleton;
  end if;
  if v_hash is null then
    raise exception 'password_required' using errcode = '22023';
  end if;

  update public.kc_dev_demo_operation_state
     set operation = 'idle', phase = 'idle', aux = '{}'::jsonb, updated_at = now()
   where singleton;

  v_result := public.kc_dev_seed_demo_data(v_hash);

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_seed_demo_data', 'none', null, v_result);

  return v_result;
end;
$$;

commit;
