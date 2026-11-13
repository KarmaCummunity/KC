-- 0451 — D16 (docs/spec/07_cross_cutting_systems.md §7.13): anonymity is
-- chosen in the form and changeable both ways, also after publishing (G3).

begin;

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-000000451001';
  v_listing uuid;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (v_owner, 'anon451@test.local', now(), jsonb_build_object('full_name', 'Anon 451'),
          jsonb_build_object('provider', 'email'), 'authenticated', 'authenticated');
  update public.users set account_status = 'active', privacy_mode = 'Public' where user_id = v_owner;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  insert into public.listings (owner_id, world_slug, kind_id, direction, title, origin,
                               moderation_status, published_at, city_id, anonymity_level, details)
  select v_owner, 'items', kind_id, 'give', 'Anonymity both ways', 'native', 'published', now(),
         'tel-aviv', 1, '{"image_url":"https://example.test/a.jpg"}'::jsonb
    from public.listing_kinds where world_slug = 'items' and slug = 'give_item'
  returning listing_id into v_listing;

  -- T1: loosen after publish (1 → 3) is allowed.
  update public.listings set anonymity_level = 3 where listing_id = v_listing;
  perform pg_temp.assert((select anonymity_level from public.listings where listing_id = v_listing) = 3,
    'published listing could not loosen anonymity');

  -- T2: tighten again (3 → 1) still works.
  update public.listings set anonymity_level = 1 where listing_id = v_listing;
  perform pg_temp.assert((select anonymity_level from public.listings where listing_id = v_listing) = 1,
    'published listing could not tighten anonymity');

  -- T3: the tighten-only trigger is gone.
  perform pg_temp.assert(to_regprocedure('public.listings_anonymity_tighten_only()') is null,
    'listings_anonymity_tighten_only() still exists');
  raise notice '✓ T1-T3 listing anonymity changes both ways';
end $$;

rollback;

\echo '✓ 0451_listings_anonymity_both_ways.sql passed'
