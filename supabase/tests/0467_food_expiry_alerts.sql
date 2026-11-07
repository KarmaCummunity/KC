-- 0467 (KC#1316) — spec 05 §5.1 / S4: the giver is told once when a food offer has 24 hours or
-- less left and once when it expires; unclaimed expired food becomes `expired`, not `closed`.

begin;

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;

create or replace function pg_temp.mk_user(p_handle text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (v_id, p_handle || '@test.local', now(), jsonb_build_object('full_name', p_handle),
          jsonb_build_object('provider', 'email'), 'authenticated', 'authenticated');
  update public.users set share_handle = p_handle, account_status = 'active', onboarding_state = 'completed'
   where user_id = v_id;
  return v_id;
end $$;

/** An open native food offer expiring at `p_expires_at` (must be in the future at insert). */
create or replace function pg_temp.mk_food(p_owner uuid, p_title text, p_expires_at timestamptz)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.listings (owner_id, world_slug, kind_id, direction, title, origin, moderation_status,
                               details, expires_at)
  select p_owner, 'food', kind_id, 'give', p_title, 'native', 'published',
         jsonb_build_object('food_type', 'cooked', 'expires_at', to_char(p_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
         p_expires_at
    from public.listing_kinds where world_slug = 'food' and slug = 'give_food'
  returning listing_id into v_id;
  return v_id;
end $$;

create or replace function pg_temp.notices(p_user uuid, p_kind text, p_listing uuid)
returns int language sql as $$
  select count(*)::int from public.notifications_outbox
   where user_id = p_user and kind = p_kind and data -> 'params' ->> 'listingId' = p_listing::text;
$$;

do $$
declare
  v_giver   uuid := pg_temp.mk_user('f467_giver');
  v_taker   uuid := pg_temp.mk_user('f467_taker');
  v_soon    uuid := pg_temp.mk_food(v_giver, 'Fresh bread', now() + interval '3 hours');
  v_later   uuid := pg_temp.mk_food(v_giver, 'Rice', now() + interval '3 days');
  v_stale   uuid := pg_temp.mk_food(v_giver, 'Salad', now() + interval '1 hour');
  v_handoff uuid;
begin
  -- T1: 24 hours or less left → one notice that opens the listing's post (G1 step 4c, 0562);
  -- a later run adds none.
  perform public.notifications_food_expiry_check();
  perform public.notifications_food_expiry_check();
  perform pg_temp.assert(pg_temp.notices(v_giver, 'listing_expiring', v_soon) = 1,
    'expected exactly one expiring notice for food with 3 hours left');
  perform pg_temp.assert(pg_temp.notices(v_giver, 'listing_expiring', v_later) = 0,
    'food with 3 days left must not be announced yet');
  perform pg_temp.assert((select data ->> 'route' from public.notifications_outbox
                           where kind = 'listing_expiring' and data -> 'params' ->> 'listingId' = v_soon::text)
                         = '/post/[id]', 'the notice does not open the listing''s post');
  perform pg_temp.assert((select data #>> '{params,postId}' from public.notifications_outbox
                           where kind = 'listing_expiring' and data -> 'params' ->> 'listingId' = v_soon::text)
                         = public.post_id_of_listing(v_soon)::text, 'the notice does not name the listing''s post');

  -- T2: an unclaimed offer past its expiry becomes `expired` (not `closed`), its open handoff is
  -- cancelled and the giver is told once. The expiry block trigger is paused so the row can
  -- pass its expiry inside this test transaction, as it would with time.
  insert into public.giving_handoffs (listing_id, owner_id, recipient_id, world_slug, status)
  values (v_stale, v_giver, v_taker, 'food', 'reserved')
  returning handoff_id into v_handoff;
  alter table public.listings disable trigger listings_food_expiry_block;
  update public.listings set expires_at = now() - interval '1 minute' where listing_id = v_stale;
  alter table public.listings enable trigger listings_food_expiry_block;

  perform public.food_expired_listings_sweep();
  perform public.food_expired_listings_sweep();
  perform pg_temp.assert((select status from public.listings where listing_id = v_stale) = 'expired',
    format('expired food must be expired, got %s', (select status from public.listings where listing_id = v_stale)));
  perform pg_temp.assert((select status from public.giving_handoffs where handoff_id = v_handoff) = 'cancelled',
    'the open handoff on expired food was not cancelled');
  perform pg_temp.assert(pg_temp.notices(v_giver, 'listing_expired', v_stale) = 1,
    'expected exactly one expired notice');
  perform pg_temp.assert((select status from public.listings where listing_id = v_soon) = 'open',
    'food that has not expired yet was closed');

  raise notice '✓ T1-T2 food expiry notices once, expired food is expired';
end $$;

rollback;

\echo '✓ 0467_food_expiry_alerts.sql passed'
