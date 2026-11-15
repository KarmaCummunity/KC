-- 0677_demo_seed_media_org_team | #1964: demo item photos (media_assets) and org team rows.

begin;

create or replace function public.kc_dev_seed_demo_post_media()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.media_assets (post_id, ordinal, path, mime_type, size_bytes, bucket)
  select p.post_id, 0,
         'demo/kc-dev/items/' || ((abs(hashtext(p.post_id::text)) % 12) + 1)::text || '.jpg',
         'image/jpeg', 180000, 'post-images'
    from public.posts p
    join auth.users a on a.id = p.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and p.type = 'Give'
     and p.listing_id is null
     and p.post_type = 'standard'
     and p.status = 'open'
     and abs(hashtext(p.post_id::text)) % 3 = 0
  on conflict (post_id, ordinal) do nothing;
end;
$$;

comment on function public.kc_dev_seed_demo_post_media() is
  'kc-dev only: attaches deterministic demo post-images paths to ~⅓ of open item Give posts.';

revoke all on function public.kc_dev_seed_demo_post_media() from public, anon, authenticated;
grant execute on function public.kc_dev_seed_demo_post_media() to service_role;

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
     'עמותת הדגמה לסביבת הפיתוח בלבד. אין לתרום כסף אמיתי.', 'Demo nonprofit for the dev environment only. Do not send real money.')
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
    when 'items' then
      perform public.kc_dev_seed_phase_items();
      perform public.kc_dev_seed_demo_post_media();
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

commit;
