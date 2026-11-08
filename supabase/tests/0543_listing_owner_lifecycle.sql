-- supabase/tests/0543_listing_owner_lifecycle.sql | 0543: what a listing's owner may do in
-- each status (docs/spec/07 §7.1 "Owner management"): pause / resume / fulfil / delete guards,
-- a paused listing hidden from everyone but its owner (listing and feed mirror), a closed
-- listing whose fields are locked but which accepts more photos, and the photo cap.

begin;

create temp table personas as
select kc_test.create_user('lifecycle_owner') as owner,
       kc_test.create_user('lifecycle_taker') as taker,
       kc_test.create_user('lifecycle_stranger') as stranger;

-- An open items offer owned by the persona `owner`.
create function pg_temp.offer(p_title text)
returns uuid language plpgsql as $$
begin
  return kc_test.create_listing((select owner from personas), 'items', 'give_item', 'give', p_title,
    '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb, now() + interval '30 days');
end $$;

-- A handoff on `p_listing` to the persona `taker`, in `p_status`.
create function pg_temp.handoff(p_listing uuid, p_status text)
returns void language plpgsql as $$
begin
  if to_regclass('public.giving_handoffs') is not null then
    insert into public.giving_handoffs (listing_id, owner_id, recipient_id, world_slug, status,
                                        confirmed_at, handed_over_at)
    select l.listing_id, l.owner_id, (select taker from personas), l.world_slug, p_status,
           case when p_status in ('confirmed', 'handed_over') then now() end,
           case when p_status = 'handed_over' then now() end
      from public.listings l where l.listing_id = p_listing;
  end if;

  insert into public.post_handoffs (post_id, owner_id, recipient_id, world_slug, status,
                                    confirmed_at, handed_over_at)
  select coalesce(l.legacy_post_id, l.listing_id), l.owner_id, (select taker from personas), l.world_slug, p_status,
         case when p_status in ('confirmed', 'handed_over') then now() end,
         case when p_status = 'handed_over' then now() end
    from public.listings l where l.listing_id = p_listing;
end $$;

-- The listing as a non-owner sees it: through the visibility predicate and the feed mirror.
create function pg_temp.visible_to(p_listing uuid, p_viewer uuid)
returns boolean language sql as $$
  select public.is_listing_visible_to(l, p_viewer) from public.listings l where l.listing_id = p_listing;
$$;

create function pg_temp.mirror_status(p_listing uuid)
returns text language sql as $$
  select p.status from public.posts p where p.listing_id = p_listing;
$$;

-- ── pause hides, resume restores; wrong statuses are refused ────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := pg_temp.offer('lamp');
  perform kc_test.assert_true(pg_temp.visible_to(v, p.stranger), 'an open offer is visible to others');

  perform kc_test.act_as(p.owner);
  perform public.pause_my_listing(v);
  perform kc_test.assert_eq(kc_test.listing_status(v), 'cancelled', 'pause sets the paused status');
  perform kc_test.assert_true(not pg_temp.visible_to(v, p.stranger), 'a paused offer is hidden from others');
  perform kc_test.assert_true(pg_temp.visible_to(v, p.owner), 'a paused offer stays visible to its owner');
  perform kc_test.assert_true(pg_temp.mirror_status(v) is distinct from 'open', 'its feed post leaves the feed');
  perform kc_test.assert_raises(format('select public.pause_my_listing(%L)', v),
    'listing_wrong_status', 'a paused offer cannot be paused again');
  perform kc_test.assert_raises(format('select public.fulfill_my_listing(%L)', v),
    'listing_wrong_status', 'a paused offer cannot be marked fulfilled');

  perform public.resume_my_listing(v);
  perform kc_test.assert_eq(kc_test.listing_status(v), 'open', 'resume reopens it');
  perform kc_test.assert_eq(pg_temp.mirror_status(v), 'open', 'its feed post is back');
  perform kc_test.assert_raises(format('select public.resume_my_listing(%L)', v),
    'listing_wrong_status', 'an open offer cannot be resumed');
end $$;

-- ── a paused offer past its expiry cannot be resumed ────────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := pg_temp.offer('expired while paused');
  perform kc_test.act_as(p.owner);
  perform public.pause_my_listing(v);
  update public.listings set expires_at = now() - interval '1 hour' where listing_id = v;
  update public.posts set expires_at = now() - interval '1 hour' where listing_id = v or post_id in (select legacy_post_id from public.listings where listing_id = v);
  perform kc_test.assert_raises(format('select public.resume_my_listing(%L)', v),
    'listing_expired', 'resume is refused once the expiry has passed');
end $$;

-- ── an active handoff blocks pause, fulfil and delete ───────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := pg_temp.offer('reserved chair');
  perform pg_temp.handoff(v, 'reserved');
  perform kc_test.act_as(p.owner);
  perform kc_test.assert_raises(format('select public.pause_my_listing(%L)', v),
    'listing_has_active_handoff', 'no pause over a reservation');
  perform kc_test.assert_raises(format('select public.fulfill_my_listing(%L)', v),
    'listing_has_active_handoff', 'no hand-marked fulfilment over a reservation');
  perform kc_test.assert_raises(format('select public.delete_my_listing(%L)', v),
    'listing_has_active_handoff', 'no delete over a reservation');
  perform kc_test.assert_eq(kc_test.listing_status(v), 'open', 'the reserved offer is untouched');

  -- Once the handoff is cancelled the owner may act again.
  update public.giving_handoffs set status = 'cancelled', cancelled_at = now() where listing_id = v;
  update public.post_handoffs set status = 'cancelled', cancelled_at = now() where post_id in (select coalesce(legacy_post_id, listing_id) from public.listings where listing_id = v);
  perform public.pause_my_listing(v);
  perform kc_test.assert_eq(kc_test.listing_status(v), 'cancelled', 'pause works after the cancel');
end $$;

-- ── closed: fields locked, photos added (never replaced), delete rules ──────
do $$
declare
  p personas;
  v uuid;
  v_done uuid;
  v_paths text[];
begin
  select * into p from personas;
  v := pg_temp.offer('given table');
  perform kc_test.act_as(p.owner);
  perform public.fulfill_my_listing(v);
  perform kc_test.assert_eq(kc_test.listing_status(v), 'closed', 'fulfil closes the offer');
  perform kc_test.assert_raises(format('select public.update_my_listing(%L, %L)', v, 'new title'),
    'listing_not_editable', 'a closed offer''s fields are locked');

  perform kc_test.assert_eq(
    public.add_my_listing_media(v, array[p.owner::text || '/a.jpg', p.owner::text || '/b.jpg']), 2,
    'two photos are added to the closed offer');
  perform kc_test.assert_eq(
    public.add_my_listing_media(v, array[p.owner::text || '/a.jpg', p.owner::text || '/c.jpg']), 1,
    'a photo already on the offer is not added twice');
  select array_agg(storage_path order by sort_order) into v_paths from public.listing_media where listing_id = v;
  perform kc_test.assert_eq(v_paths,
    array[p.owner::text || '/a.jpg', p.owner::text || '/b.jpg', p.owner::text || '/c.jpg'],
    'photos keep their order and are appended');
  perform kc_test.assert_raises(
    format('select public.add_my_listing_media(%L, %L::text[])', v, array[p.stranger::text || '/x.jpg']),
    'media_path_must_be_owned', 'only the owner''s own uploads can be attached');
  perform kc_test.assert_raises(
    format('select public.add_my_listing_media(%L, %L::text[])', v,
      (select array_agg(p.owner::text || '/more' || g || '.jpg') from generate_series(1, 8) g)),
    'listing_media_full', 'ten photos at most');
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'public.attach_listing_media(uuid, text[])', 'execute'),
    'clients can no longer replace a listing''s photos');

  -- A closed offer without a handover may be deleted; one with a handover may not.
  perform public.delete_my_listing(v);
  perform kc_test.assert_eq(kc_test.listing_status(v), null::text, 'a hand-closed offer is deleted');

  v_done := pg_temp.offer('handed over bike');
  perform pg_temp.handoff(v_done, 'handed_over');
  update public.listings set status = 'closed' where listing_id = v_done;
  perform kc_test.act_as(p.owner);
  perform kc_test.assert_raises(format('select public.delete_my_listing(%L)', v_done),
    'listing_has_handoff_history', 'a handed-over offer is the taker''s record too');
end $$;

-- ── another member is refused everywhere ────────────────────────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  v := pg_temp.offer('not yours');
  perform kc_test.act_as(p.stranger);
  perform kc_test.assert_raises(format('select public.pause_my_listing(%L)', v),
    'listing_not_found', 'a stranger cannot pause');
  perform kc_test.assert_raises(format('select public.delete_my_listing(%L)', v),
    'listing_not_found', 'a stranger cannot delete');
  perform kc_test.assert_raises(
    format('select public.add_my_listing_media(%L, %L::text[])', v, array[p.stranger::text || '/y.jpg']),
    'listing_not_found', 'a stranger cannot add photos');
  perform kc_test.assert_eq(kc_test.listing_status(v), 'open', 'the offer is untouched');
end $$;

rollback;

\echo '✓ 0543_listing_owner_lifecycle.sql passed'
