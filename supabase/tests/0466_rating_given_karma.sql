-- 0466 (KC#1306) — spec 07 §7.6 "Rating given — 2": a handoff rating awards its rater 2 karma
-- once; editing the rating or its note does not award again; the ratee gets nothing for it.

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
  update public.users
     set share_handle = p_handle, account_status = 'active', onboarding_state = 'completed'
   where user_id = v_id;
  return v_id;
end $$;

create or replace function pg_temp.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
end $$;

create or replace function pg_temp.karma(p_user uuid)
returns int language sql as $$
  select karma_points from public.users where user_id = p_user;
$$;

do $$
declare
  v_giver    uuid := pg_temp.mk_user('k466_giver');
  v_taker    uuid := pg_temp.mk_user('k466_taker');
  v_listing  uuid;
  v_handoff  uuid;
  v_before   int;
  v_giver0   int;
begin
  -- A completed items handoff (created directly; the handoff flow itself is covered elsewhere).
  perform pg_temp.act_as(v_giver);
  v_listing := public.create_marketplace_listing(
    p_kind_id => (select kind_id from public.listing_kinds where world_slug = 'items' and slug = 'give_item'),
    p_title   => 'Desk lamp',
    p_details => '{"item_condition":"good","image_url":"https://example.test/i.jpg"}'::jsonb,
    p_lat     => 32.0853,
    p_lng     => 34.7818
  );
  insert into public.giving_handoffs (listing_id, owner_id, recipient_id, world_slug, status, handed_over_at)
  values (v_listing, v_giver, v_taker, 'items', 'handed_over', now())
  returning handoff_id into v_handoff;

  -- T1: the first rating awards the rater 2 karma and the ratee nothing.
  v_before := pg_temp.karma(v_taker);
  v_giver0 := pg_temp.karma(v_giver);
  perform pg_temp.act_as(v_taker);
  perform public.rate_giving_handoff(v_handoff, 5::smallint, 'Thank you!');
  perform pg_temp.assert(pg_temp.karma(v_taker) = v_before + 2,
    format('rating should add 2 karma, got %s -> %s', v_before, pg_temp.karma(v_taker)));
  perform pg_temp.assert(pg_temp.karma(v_giver) = v_giver0, 'the ratee must not earn karma from being rated');
  perform pg_temp.assert(exists (
    select 1 from public.karma_ledger
     where user_id = v_taker and event_type = 'rating_given' and ref_id = v_handoff::text and points_delta = 2),
    'no rating_given ledger row');

  -- T2: editing the rating or the note does not award again.
  perform public.rate_giving_handoff(v_handoff, 4::smallint, 'Thanks again');
  perform pg_temp.assert(pg_temp.karma(v_taker) = v_before + 2, 'editing the rating awarded karma again');
  perform pg_temp.assert((select count(*) from public.karma_ledger
                           where user_id = v_taker and event_type = 'rating_given') = 1,
    'more than one rating_given row for one handoff');

  -- T3: the other side rating the same handoff earns its own 2 karma.
  perform pg_temp.act_as(v_giver);
  perform public.rate_giving_handoff(v_handoff, 5::smallint, null);
  perform pg_temp.assert(pg_temp.karma(v_giver) = v_giver0 + 2, 'the giver did not earn karma for rating');

  raise notice '✓ T1-T3 rating given awards 2 karma once per handoff and rater';
end $$;

rollback;

\echo '✓ 0466_rating_given_karma.sql passed'
