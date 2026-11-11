-- supabase/tests/0627_g1_owner_rpcs_lock_the_post.sql | 0627 (G1 step 6a-5c, issue #1671): the
-- owner management RPCs lock the post first, then the listing, and write the status on the record.
--   1. a post-owned ride: pause / resume / update / fulfil / delete land on the post, the listing follows;
--   2. the same RPCs accept the post id; the karma reference stays the listing id;
--   3. a listing-sourced ride: the listing is written and its mirror post follows;
--   4. a listing without a post yet (pending knowledge) is still paused and deleted;
--   5. a stranger is refused with listing_not_found, an anonymous caller with auth_required;
--   6. the lock helper takes the post's row lock (lock order: post, then listing — see 0627).
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('lock_driver')   as driver,
       kc_test.create_user('lock_mentor')   as mentor,
       kc_test.create_user('lock_stranger') as stranger;

-- Knowledge publishes only for a verified identity (worlds.requires_verification).
update public.users set verified_at = now() where user_id = (select mentor from personas);

/** A ride offer published through the create RPC (post-owned). */
create function pg_temp.create_ride(p_owner uuid, p_title text)
returns uuid
language plpgsql
as $$
begin
  perform kc_test.act_as(p_owner);
  return public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'),
    p_title   => p_title,
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(interval '3 hours'), 'seats_available', 3),
    p_city_id => 'tel-aviv');
end $$;
-- 0520: pg_temp helpers are called after act_as, so they need an explicit grant.
grant execute on function pg_temp.create_ride(uuid, text) to public;

/** The status of the post of listing p_listing (null when it has none). */
create function pg_temp.post_status(p_listing uuid)
returns text
language sql
as $$ select p.status from public.posts p where p.post_id = public.post_id_of_listing(p_listing) $$;
grant execute on function pg_temp.post_status(uuid) to public;

-- ── T1 a post-owned ride: the post is written, the listing follows ──────────────────────────
do $$
declare
  p personas;
  v uuid;
  v_post uuid;
begin
  select * into p from personas;
  v := pg_temp.create_ride(p.driver, 'Tel Aviv to Jerusalem');
  v_post := public.post_id_of_listing(v);
  perform kc_test.act_as(p.driver);

  perform public.pause_my_listing(v);
  perform kc_test.assert_eq(pg_temp.post_status(v), 'paused', 'pause pauses the post');
  perform kc_test.assert_eq(kc_test.listing_status(v), 'cancelled', 'the listing follows as cancelled');
  perform kc_test.assert_raises(format('select public.pause_my_listing(%L)', v),
    'listing_wrong_status', 'a paused ride cannot be paused again');

  perform public.resume_my_listing(v);
  perform kc_test.assert_eq(pg_temp.post_status(v), 'open', 'resume reopens the post');
  perform kc_test.assert_eq(kc_test.listing_status(v), 'open', 'the listing follows as open');

  perform public.update_my_listing(v, p_title => 'Tel Aviv to Jerusalem, 2 seats', p_availability_status => 'immediate');
  perform kc_test.assert_eq((select title from public.posts where post_id = v_post), 'Tel Aviv to Jerusalem, 2 seats', 'the edit lands on the post');
  perform kc_test.assert_eq((select title from public.listings where listing_id = v), 'Tel Aviv to Jerusalem, 2 seats', 'the listing follows the edit');
  perform kc_test.assert_eq((select availability_status from public.posts where post_id = v_post), 'immediate', 'availability reaches the post (0626)');

  perform public.fulfill_my_listing(v);
  perform kc_test.assert_eq(pg_temp.post_status(v), 'closed_delivered', 'fulfil closes the post');
  perform kc_test.assert_eq(kc_test.listing_status(v), 'closed', 'the listing follows as closed');

  perform public.delete_my_listing(v);
  perform kc_test.assert_row_count(format('select 1 from public.posts where post_id = %L', v_post), 0, 'delete removes the post');
  perform kc_test.assert_row_count(format('select 1 from public.listings where listing_id = %L', v), 0, 'and its listing with it');
end $$;

-- ── T2 the RPCs accept the post id; the karma reference stays the listing id ────────────────
do $$
declare
  p personas;
  v uuid;
  v_post uuid;
begin
  select * into p from personas;
  v := pg_temp.create_ride(p.driver, 'Haifa to Tel Aviv');
  v_post := public.post_id_of_listing(v);
  perform kc_test.act_as(p.driver);

  perform public.pause_my_listing(v_post);
  perform kc_test.assert_eq(kc_test.listing_status(v), 'cancelled', 'pause by post id pauses the ride');
  perform public.resume_my_listing(v_post);
  perform kc_test.assert_eq(pg_temp.post_status(v), 'open', 'resume by post id reopens it');
  perform public.fulfill_my_listing(v_post);
  perform kc_test.assert_eq(pg_temp.post_status(v), 'closed_delivered', 'fulfil by post id closes it');
  perform kc_test.assert_row_count(
    format($q$select 1 from public.karma_ledger
               where user_id = %L and event_type = 'listing_fulfilled' and ref_type = 'listing' and ref_id = %L$q$,
           p.driver, v),
    1, 'the fulfilment karma is keyed by the listing id');
end $$;

-- ── T3 a listing-sourced ride: the listing is written, its mirror post follows ──────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := kc_test.create_ride_offer(p.driver);
  perform kc_test.assert_true(public.post_id_of_listing(v) is not null, 'the direct listing has its mirror post');
  perform kc_test.act_as(p.driver);

  perform public.pause_my_listing(v);
  perform kc_test.assert_eq(kc_test.listing_status(v), 'cancelled', 'pause cancels the listing');
  perform kc_test.assert_eq(pg_temp.post_status(v), 'paused', 'its mirror post follows as paused');
  perform kc_test.assert_eq((select availability_status from public.listings where listing_id = v), 'ongoing', 'pause resets availability');

  perform public.resume_my_listing(v);
  perform kc_test.assert_eq(kc_test.listing_status(v), 'open', 'resume reopens the listing');
  perform kc_test.assert_eq(pg_temp.post_status(v), 'open', 'its mirror post follows as open');

  perform public.update_my_listing(v, p_title => 'Tel Aviv to Jerusalem, direct');
  perform kc_test.assert_eq((select title from public.listings where listing_id = v), 'Tel Aviv to Jerusalem, direct', 'the edit lands on the listing');

  perform public.fulfill_my_listing(v);
  perform kc_test.assert_eq(kc_test.listing_status(v), 'closed', 'fulfil closes the listing');
  perform kc_test.assert_eq(pg_temp.post_status(v), 'closed_delivered', 'its mirror post follows as closed');

  perform public.delete_my_listing(v);
  perform kc_test.assert_row_count(format('select 1 from public.listings where listing_id = %L', v), 0, 'delete removes the listing');
end $$;

-- ── T4 a listing without a post yet is still managed ────────────────────────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := kc_test.create_listing(p.mentor, 'knowledge', 'course', 'give', 'intro to sql',
    jsonb_build_object(
      'topic', 'SQL', 'level', 'beginner', 'modality', 'video', 'slots_available', 2,
      'slot_starts_at', kc_test.iso_in(interval '10 minutes'),
      'slot_ends_at', kc_test.iso_in(interval '2 hours')));
  if (select relkind from pg_class where relname = 'listings' and relnamespace = 'public'::regnamespace) = 'r' then
    perform kc_test.assert_eq(public.post_id_of_listing(v), null::uuid, 'a pending knowledge listing has no post');
  else
    perform kc_test.assert_eq(public.post_id_of_listing(v), v, 'a pending knowledge listing has its post');
  end if;
  perform kc_test.act_as(p.mentor);
  perform public.pause_my_listing(v);
  perform kc_test.assert_eq(kc_test.listing_status(v), 'cancelled', 'a listing without a post is paused on the listing');
  perform public.delete_my_listing(v);
  perform kc_test.assert_row_count(format('select 1 from public.listings where listing_id = %L', v), 0, 'and deleted');
end $$;

-- ── T5 strangers and anonymous callers are refused with the same codes ─────────────────────
do $$
declare
  p personas;
  v uuid;
  v_post uuid;
  v_id uuid;
  v_rpc text;
begin
  select * into p from personas;
  v := pg_temp.create_ride(p.driver, 'Netanya to Haifa');
  v_post := public.post_id_of_listing(v);
  foreach v_id in array array[v, v_post] loop
    foreach v_rpc in array array['pause_my_listing', 'resume_my_listing', 'fulfill_my_listing',
                                 'delete_my_listing', 'update_my_listing'] loop
      perform kc_test.act_as(p.stranger);
      perform kc_test.assert_raises(format('select public.%I(%L)', v_rpc, v_id),
        'listing_not_found', format('%s by a stranger is refused', v_rpc));
      perform kc_test.act_as_anon();
      perform kc_test.assert_raises(format('select public.%I(%L)', v_rpc, v_id),
        'auth_required', format('%s without a session is refused', v_rpc));
    end loop;
  end loop;
  perform kc_test.act_as(p.driver);
  perform kc_test.assert_raises(format('select public.pause_my_listing(%L)', gen_random_uuid()),
    'listing_not_found', 'an unknown id is not found');
  perform kc_test.assert_eq(kc_test.listing_status(v), 'open', 'the refused calls changed nothing');
end $$;

-- ── T6 the lock helper takes the post's row lock ────────────────────────────────────────────
-- The owner RPCs call post_lock_own_listing before listing_lock_own, so the post is locked first,
-- as the booking writers do (0624). Here: after the helper, this transaction holds a FOR UPDATE
-- lock on the post row, and it did not before.
--
-- The check reads the row's xmax. When this transaction is the row's only locker, xmax is the
-- current transaction id. A post created by the create RPC is not in that case: the triggers
-- that derive its listing run foreign-key checks inside exception blocks (sub-transactions),
-- which leave key-share locks on the row, so its xmax is a MultiXact. Its members, read with the
-- core function pg_get_multixact_members, then name this transaction and each lock mode.

create extension if not exists pgrowlocks;

/** The lock modes held on post p_post using pgrowlocks. */
create function pg_temp.post_locks_of_this_xact(p_post uuid)
returns text[]
language sql
as $$
  select coalesce(l.modes, '{}'::text[])
  from public.posts p
  left join lateral (
    select r.modes
    from pgrowlocks('public.posts') r
    where r.locked_row = p.ctid
  ) l on true
  where p.post_id = p_post
$$;
grant execute on function pg_temp.post_locks_of_this_xact(uuid) to public;

-- No exception block in this DO block: the helper runs in the top-level transaction.
do $$
declare
  p personas;
  v uuid;
  v_post uuid;
  po public.posts;
  v_before text[];
  v_after text[];
begin
  select * into p from personas;
  v := pg_temp.create_ride(p.driver, 'Ashdod to Rehovot');
  v_post := public.post_id_of_listing(v);
  v_before := pg_temp.post_locks_of_this_xact(v_post);
  perform kc_test.assert_true(not ('For Update' = any(v_before)),
    format('before the helper this transaction holds no FOR UPDATE lock on the post (%s)', v_before));

  perform kc_test.act_as(p.driver);
  po := public.post_lock_own_listing(v);
  perform kc_test.assert_eq(po.post_id, v_post, 'the helper resolves the listing to its post');

  v_after := pg_temp.post_locks_of_this_xact(v_post);
  perform kc_test.assert_true('For Update' = any(v_after),
    format('after the helper this transaction holds the post row FOR UPDATE (%s)', v_after));
end $$;

rollback;
\echo '✓ 0627_g1_owner_rpcs_lock_the_post.sql passed'
