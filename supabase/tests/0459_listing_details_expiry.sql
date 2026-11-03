-- supabase/tests/0459_listing_details_expiry.sql | 0459 (KC#1294): a listing's expires_at follows
-- the expiry the giver set in details — on create through the RPC, when the detail changes, not
-- when other fields change — and an unparseable value is rejected instead of defaulting.

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', onboarding_state = 'completed'
   where user_id = p_id;
end $$;

create or replace function pg_temp.as_user(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
end $$;

create or replace function pg_temp.as_system()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

/** A give_food listing created through the app's RPC, expiring at p_expires. */
create or replace function pg_temp.create_food(p_owner uuid, p_expires timestamptz)
returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_user(p_owner);
  v := public.create_marketplace_listing(
    p_kind_id  => (select kind_id from public.listing_kinds where world_slug = 'food' and slug = 'give_food'),
    p_title    => 'Fresh soup',
    p_details  => jsonb_build_object('food_type', 'cooked', 'expires_at', to_char(p_expires at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    p_lat      => 32.0853,
    p_lng      => 34.7818
  );
  perform pg_temp.as_system();
  return v;
end $$;

do $$
begin
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000045900a1', 'expiry_giver');
end $$;

-- ── create: the giver's expiry, not the 168 h food default ─────────────────
do $$
declare
  v_expires timestamptz := date_trunc('second', now() + interval '3 hours');
  v_listing uuid := pg_temp.create_food('00000000-0000-0000-0000-0000045900a1', v_expires);
  v_stored  timestamptz := (select expires_at from public.listings where listing_id = v_listing);
begin
  if v_stored is distinct from v_expires then
    raise exception 'ASSERT FAILED: expires_at must be the giver''s % but is %', v_expires, v_stored;
  end if;
  -- Food expiring within hours is urgent on the 1–3 scale (0383 returned 5, outside the check).
  if (select urgency_level from public.listings where listing_id = v_listing) <> 3 then
    raise exception 'ASSERT FAILED: food expiring in 3 h must be urgent (3)';
  end if;

  -- Changing the detail moves the expiry.
  update public.listings
     set details = details || jsonb_build_object('expires_at', to_char((v_expires + interval '2 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
   where listing_id = v_listing;
  if (select expires_at from public.listings where listing_id = v_listing) <> v_expires + interval '2 hours' then
    raise exception 'ASSERT FAILED: an edited details.expires_at must move expires_at';
  end if;

  -- Another field changing leaves an expiry set some other way alone.
  update public.listings set expires_at = v_expires + interval '1 hour' where listing_id = v_listing;
  update public.listings set title = 'Fresh lentil soup' where listing_id = v_listing;
  if (select expires_at from public.listings where listing_id = v_listing) <> v_expires + interval '1 hour' then
    raise exception 'ASSERT FAILED: an unrelated update must not reset expires_at';
  end if;
end $$;

-- ── a past expiry on create is expired straight away (0266 block, now reachable) ─
do $$
declare
  v_listing uuid := pg_temp.create_food('00000000-0000-0000-0000-0000045900a1', now() - interval '1 minute');
begin
  if (select status from public.listings where listing_id = v_listing) <> 'expired' then
    raise exception 'ASSERT FAILED: food created past its expiry must be expired';
  end if;
end $$;

-- ── urgency stays on the column's scale for every horizon ──────────────────
do $$
begin
  if public.food_listing_urgency_level(now() + interval '1 hour') <> 3
     or public.food_listing_urgency_level(now() + interval '48 hours') <> 3
     or public.food_listing_urgency_level(now() + interval '5 days') <> 2
     or public.food_listing_urgency_level(null) <> 2 then
    raise exception 'ASSERT FAILED: food urgency must map to 3 within 72 h and 2 otherwise';
  end if;
end $$;

-- ── an unparseable expiry is rejected, not replaced by the default ─────────
do $$
begin
  perform public.listing_details_expires_at('{"expires_at":"next tuesday-ish"}'::jsonb);
  raise exception 'ASSERT FAILED: an unparseable expiry must be rejected';
exception when check_violation then
  if sqlerrm <> 'details_expires_at_invalid' then
    raise exception 'ASSERT FAILED: unexpected error %', sqlerrm;
  end if;
end $$;

do $$
begin
  if public.listing_details_expires_at('{}'::jsonb) is not null
     or public.listing_details_expires_at('{"expires_at":"  "}'::jsonb) is not null then
    raise exception 'ASSERT FAILED: a missing expiry must parse to null';
  end if;
  if has_function_privilege('authenticated', 'public.listing_details_expires_at(jsonb)', 'execute') then
    raise exception 'ASSERT FAILED: the parser is internal';
  end if;
end $$;

rollback;

\echo '✓ 0459_listing_details_expiry.sql passed'
