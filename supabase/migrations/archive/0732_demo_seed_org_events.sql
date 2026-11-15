-- 0732_demo_seed_org_events | kc-dev demo data: organization events (G18, PM 2026-11-10)
--
-- The demo seed's `orgs` phase created three demo organizations with seed members (0677) but no
-- events, so the event flow had nothing to show. It now also:
--
-- 1. makes the admin who runs the seed an `org_admin` of each demo organization, so they can
--    publish its events and manage its members from Settings → הארגונים שלי;
-- 2. publishes two upcoming events per demo organization through the real create path
--    (`create_marketplace_listing`, acting as the organization's seed admin): an open event with
--    automatic registration and a small one that needs the organizer's approval;
-- 3. registers seed members through `register_for_event`, so the roster, the waitlist and the
--    requests are populated.
--
-- kc-dev only: every function returns at once without `kc_dev_demo_config` (same gate as 0614).
-- The demo wipe removes the events with the seed users' posts (0651).

-- ── 1–3. Demo events ───────────────────────────────────────────────────────────
-- Acts as `p_user` for the calls that follow (clears with p_user = null).
create or replace function kc_private.kc_dev_seed_act_as(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.set_config(
    'request.jwt.claims',
    case when p_user is null then ''
         else pg_catalog.jsonb_build_object('sub', p_user, 'role', 'authenticated')::text end,
    true);
$$;

revoke all on function kc_private.kc_dev_seed_act_as(uuid) from public, anon, authenticated;

create or replace function public.kc_dev_seed_demo_org_events(p_caller uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     record;
  v_admin   uuid;
  v_kind    uuid;
  v_city    text;
  v_listing uuid;
  v_post    uuid;
  v_events  integer := 0;
  v_member  uuid;
  v_day     date;
  v_spec    record;
begin
  if not exists (select 1 from public.kc_dev_demo_config) then
    return 0;
  end if;

  select k.kind_id into v_kind from public.listing_kinds k where k.world_slug = 'time' and k.slug = 'org_event';
  select c.city_id into v_city from public.cities c order by (c.city_id = 'tel-aviv') desc, c.city_id limit 1;
  if v_kind is null or v_city is null then
    return 0;
  end if;

  for v_org in
    select o.org_id, o.name from public.organizations o where o.verification_method = 'demo_seed' order by o.slug
  loop
    -- 1. The admin running the seed manages each demo organization (one row per member).
    if p_caller is not null then
      delete from public.org_memberships where org_id = v_org.org_id and user_id = p_caller;
      insert into public.org_memberships (org_id, user_id, role) values (v_org.org_id, p_caller, 'org_admin');
    end if;

    -- Re-running the phase adds no second set while the first is still upcoming.
    continue when exists (
      select 1 from public.event_post_details e where e.org_id = v_org.org_id and e.starts_at > now());

    select m.user_id into v_admin
      from public.org_memberships m
      join auth.users au on au.id = m.user_id
     where m.org_id = v_org.org_id and m.role = 'org_admin' and au.email like '%@seed.kc.test'
     limit 1;
    continue when v_admin is null;

    -- 2. Two events: an open one in 3 days, a small approval-only one in 8 days (Israel time).
    for v_spec in
      select * from (values
        (3, '[DEMO] יום התנדבות פתוח',  'automatic', 20),
        (8, '[DEMO] סדנה בהרשמה מראש', 'manual',    3)
      ) s(days_ahead, title, policy, capacity)
    loop
      v_day := (now() at time zone 'Asia/Jerusalem')::date + v_spec.days_ahead;
      perform kc_private.kc_dev_seed_act_as(v_admin);
      v_listing := public.create_marketplace_listing(
        p_kind_id => v_kind,
        p_title   => v_spec.title,
        p_details => jsonb_build_object(
          'org_id', v_org.org_id::text,
          'registration_policy', v_spec.policy,
          'capacity', v_spec.capacity,
          'starts_at', to_char((v_day + time '10:00') at time zone 'Asia/Jerusalem' at time zone 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'ends_at',   to_char((v_day + time '13:00') at time zone 'Asia/Jerusalem' at time zone 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'address', 'מרכז הקהילה, ' || v_org.name),
        p_city_id => v_city);
      v_post := public.post_id_of_listing(v_listing);
      v_events := v_events + 1;

      -- 3. Seed members register: four to the open event, four to the small one (three requests,
      -- one on the waitlist).
      for v_member in
        select au.id
          from auth.users au
         where au.email like '%@seed.kc.test'
           and coalesce(au.raw_app_meta_data ->> 'seed', '') = 'true'
           and au.id <> v_admin
         order by md5(au.id::text || v_post::text)
         limit 4
      loop
        perform kc_private.kc_dev_seed_act_as(v_member);
        begin
          perform public.register_for_event(v_post);
        exception when others then
          -- A seed member the event refuses (verification, a block) is skipped.
          null;
        end;
      end loop;
    end loop;
  end loop;

  perform kc_private.kc_dev_seed_act_as(null);
  return v_events;
end;
$$;

comment on function public.kc_dev_seed_demo_org_events(uuid) is
  'kc-dev only (0732): makes the seeding admin an org_admin of each demo organization and publishes two upcoming events per organization with seed registrations.';

revoke all on function public.kc_dev_seed_demo_org_events(uuid) from public, anon, authenticated;
grant execute on function public.kc_dev_seed_demo_org_events(uuid) to service_role;

-- ── The `orgs` phase runs it, for the admin who started the seed ───────────────
-- Same body as 0678, plus the caller captured before the claims are cleared.
create or replace function public.kc_dev_seed_with_caps_off(p_phase text, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_sub text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_world jsonb;
  v_match integer;
  v_events integer;
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
    when 'orgs' then
      perform public.kc_dev_seed_phase_orgs();
      v_events := public.kc_dev_seed_demo_org_events(v_caller);
    else raise exception 'demo_seed_invalid_phase' using errcode = '22023';
  end case;
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('request.jwt.claim.sub', v_sub, true);
  return jsonb_build_object('world', v_world, 'match_candidates', v_match, 'org_events', v_events);
end;
$$;
