-- supabase/tests/0553_post_handoffs.sql | 0553 (G1 step 1, ADR-006, D19): every giving handoff
-- is copied to post_handoffs under the post it closes — a listing's mirror post, or the post an
-- items listing was synced from — with the same id, status, seats and timestamps; a handoff of
-- a listing that has no post yet is copied the moment the post appears; the report agrees.

begin;

create temp table personas as
select kc_test.create_user('ph_owner')     as owner,
       kc_test.create_user('ph_taker')     as taker,
       kc_test.create_user('ph_passenger') as passenger;

-- Knowledge publishes only for a verified identity (worlds.requires_verification).
update public.users set verified_at = now() where user_id = (select owner from personas);

/** The post_handoffs row with p_id (fails when there is none). */
create function pg_temp.copy_of(p_id uuid)
returns public.post_handoffs
language plpgsql
as $$
declare
  v public.post_handoffs;
begin
  select * into v from public.post_handoffs where handoff_id = p_id;
  if not found then
    perform kc_test.fail('handoff has no post_handoffs copy');
  end if;
  return v;
end $$;

/** A reserved giving handoff on p_listing to p_taker (the items / food flow, as 0543 tests do). */
create function pg_temp.reserve(p_listing uuid, p_taker uuid)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.giving_handoffs (listing_id, owner_id, recipient_id, world_slug, status, confirm_by)
  select l.listing_id, l.owner_id, p_taker, l.world_slug, 'reserved', now() + interval '1 day'
    from public.listings l where l.listing_id = p_listing
  returning handoff_id into v_id;
  return v_id;
end $$;

-- ── An items listing of the create form: the copy hangs off its mirror post ─────────
do $$
declare
  p personas;
  v_listing uuid;
  v_h uuid;
  c public.post_handoffs;
begin
  if not exists (select 1 from pg_trigger where tgname = 'giving_handoffs_post_handoffs_sync') then
    return;
  end if;
  select * into p from personas;
  v_listing := kc_test.create_listing(p.owner, 'items', 'give_item', 'give', 'a lamp',
    '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb, null);
  v_h := pg_temp.reserve(v_listing, p.taker);

  c := pg_temp.copy_of(v_h);
  perform kc_test.assert_eq(c.post_id, (select post_id from public.posts where listing_id = v_listing),
    'the copy belongs to the mirror post');
  perform kc_test.assert_eq(c.status, 'reserved', 'status is copied');
  perform kc_test.assert_eq(c.recipient_id, p.taker, 'the taker is copied');
  perform kc_test.assert_eq(c.world_slug, 'items', 'the world is copied');
  perform kc_test.assert_eq(c.seats, 1, 'one seat by default');

  update public.giving_handoffs set status = 'confirmed', confirmed_at = now() where handoff_id = v_h;
  c := pg_temp.copy_of(v_h);
  perform kc_test.assert_eq(c.status, 'confirmed', 'a confirmation is copied');
  perform kc_test.assert_true(c.confirmed_at is not null, 'the confirmation time is copied');

  update public.giving_handoffs set status = 'handed_over', handed_over_at = now() where handoff_id = v_h;
  c := pg_temp.copy_of(v_h);
  perform kc_test.assert_eq(c.status, 'handed_over', 'the handover is copied');

  delete from public.giving_handoffs where handoff_id = v_h;
  perform kc_test.assert_row_count(
    format('select 1 from public.post_handoffs where handoff_id = %L', v_h), 0,
    'deleting the handoff deletes its copy');
end $$;

-- ── A native items post: the copy hangs off the post itself ─────────────────────────
do $$
declare
  p personas;
  v_post uuid;
  v_listing uuid;
  v_h uuid;
begin
  if not exists (select 1 from pg_trigger where tgname = 'giving_handoffs_post_handoffs_sync') then
    return;
  end if;
  select * into p from personas;
  perform kc_test.act_as(p.owner);
  insert into public.posts (owner_id, type, title, category, city, street, street_number)
  values (p.owner, 'Give', 'a chair', 'Furniture', 'tel-aviv', 'Allenby', '5')
  returning post_id into v_post;
  select listing_id into v_listing from public.listings where legacy_post_id = v_post;
  perform kc_test.assert_true(v_listing is not null, 'the post engine synced an items listing');

  v_h := pg_temp.reserve(v_listing, p.taker);
  perform kc_test.assert_eq((pg_temp.copy_of(v_h)).post_id, v_post, 'the copy belongs to the native post');
end $$;

-- ── A ride booking: seats and cancellation ──────────────────────────────────────────
do $$
declare
  p personas;
  v_listing uuid;
  v_h uuid;
  c public.post_handoffs;
begin
  if not exists (select 1 from pg_trigger where tgname = 'giving_handoffs_post_handoffs_sync') then
    return;
  end if;
  select * into p from personas;
  v_listing := kc_test.create_ride_offer(p.owner, 4, interval '4 hours');
  v_h := kc_test.book_ride(p.passenger, v_listing, 2);

  c := pg_temp.copy_of(v_h);
  perform kc_test.assert_eq(c.seats, 2, 'booked seats are copied');
  perform kc_test.assert_eq(c.world_slug, 'rides', 'a booking is a rides handoff');

  perform kc_test.act_as(p.passenger);
  perform public.cancel_giving_handoff(v_h);
  c := pg_temp.copy_of(v_h);
  perform kc_test.assert_eq(c.status, 'cancelled', 'a cancellation is copied');
  perform kc_test.assert_true(c.cancelled_at is not null, 'the cancellation time is copied');
end $$;

-- ── A listing without a post yet: its handoff is copied as soon as the post appears ───────
do $$
declare
  p personas;
  v_listing uuid;
  v_h uuid;
  r jsonb;
begin
  if not exists (select 1 from pg_trigger where tgname = 'giving_handoffs_post_handoffs_sync') then
    return;
  end if;
  select * into p from personas;
  v_listing := kc_test.create_listing(p.owner, 'knowledge', 'course', 'give', 'intro to sql',
    jsonb_build_object(
      'topic', 'SQL', 'level', 'beginner', 'modality', 'video', 'slots_available', 5,
      'slot_starts_at', kc_test.iso_in(interval '1 day'),
      'slot_ends_at', kc_test.iso_in(interval '1 day 2 hours')),
    null);
  -- Knowledge listings start in pending_review (0266): no post until a moderator publishes.
  perform kc_test.assert_row_count(
    format('select 1 from public.posts where listing_id = %L', v_listing), 0,
    'a listing pending review has no post');

  v_h := pg_temp.reserve(v_listing, p.taker);
  perform kc_test.assert_row_count(
    format('select 1 from public.post_handoffs where handoff_id = %L', v_h), 0,
    'no post yet, no copy yet');
  r := public.post_unification_report();
  perform kc_test.assert_true((r ->> 'handoffs_without_post')::int >= 1, 'the report counts the handoff without a post');

  -- Publishing gives the listing its post (0557, hidden from the feed for knowledge).
  update public.listings set moderation_status = 'published' where listing_id = v_listing;
  perform kc_test.assert_eq((pg_temp.copy_of(v_h)).post_id,
    (select post_id from public.posts where listing_id = v_listing),
    'the copy appears under the new post');
end $$;

-- ── Access: participants read, nobody writes ────────────────────────────────────────
do $$
begin
  perform kc_test.assert_row_count(
    $q$select 1 from pg_policies where schemaname = 'public' and tablename = 'post_handoffs'$q$, 1,
    'exactly one policy on post_handoffs');
  perform kc_test.assert_eq(
    (select cmd::text from pg_policies where schemaname = 'public' and tablename = 'post_handoffs'),
    'SELECT', 'the only policy is a read policy');
  perform kc_test.assert_true(
    not has_table_privilege('authenticated', 'public.post_handoffs', 'insert')
    and not has_table_privilege('authenticated', 'public.post_handoffs', 'update')
    and not has_table_privilege('authenticated', 'public.post_handoffs', 'delete'),
    'authenticated cannot write post_handoffs');
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'public.post_unification_report()', 'execute'),
    'the report is not a client RPC');
end $$;

-- ── The report agrees on both sides ────────────────────────────────────────────────
do $$
declare
  r jsonb := public.post_unification_report();
begin
  if not exists (select 1 from pg_trigger where tgname = 'giving_handoffs_post_handoffs_sync') then
    return;
  end if;
  perform kc_test.assert_eq((r ->> 'handoffs_without_post')::int, 0, 'every handoff has a post now');
  perform kc_test.assert_eq((r ->> 'handoff_rows_missing')::int, 0, 'every handoff is copied');
  perform kc_test.assert_eq((r ->> 'handoff_field_mismatches')::int, 0, 'every copy agrees with its handoff');
  perform kc_test.assert_eq((r ->> 'post_handoffs_total')::int, (r ->> 'handoffs_total')::int,
    'both sides hold the same number of handoffs');
end $$;

rollback;
\echo '✓ 0553_post_handoffs.sql passed'
