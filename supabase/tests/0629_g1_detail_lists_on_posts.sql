-- supabase/tests/0629_g1_detail_lists_on_posts.sql | 0629 (G1 step 6a-5e, issue #1671): listing
-- detail and owner/profile lists read post of post-owned listing; equal oracle byte for byte.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('dl_owner')    as owner,
       kc_test.create_user('dl_viewer')   as viewer,
       kc_test.create_user('dl_mentor')   as mentor,
       kc_test.create_user('dl_pager')    as pager;

-- Knowledge publishes only for a verified identity (worlds.requires_verification).
update public.users set verified_at = now() where user_id = (select mentor from personas);

-- ── Oracles: the pre-0629 bodies ────────────────────────────────────────────────────────────────

/** get_marketplace_listing_detail as of 0561. */
create function pg_temp.old_detail(p_listing_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_viewer uuid := auth.uid();
  v_listing_id uuid := public.handoff_target_listing_id(p_listing_id);
  v_post_id uuid;
  v_listing public.listings%rowtype;
  v_row public.marketplace_listing_card%rowtype;
  v_media jsonb;
  v_owner jsonb;
begin
  select * into v_listing from public.listings where listing_id = v_listing_id;
  if not found then return null; end if;
  if not public.is_listing_visible_to(v_listing, v_viewer) then return null; end if;

  v_post_id := public.post_id_of_listing(v_listing_id);
  select * into v_row from public.marketplace_listing_card c where c.listing_id = v_listing_id;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', m.storage_path, 'sort_order', m.sort_order)
    order by m.sort_order), '[]'::jsonb) into v_media
    from public.listing_media m where m.listing_id = v_listing_id;
  select jsonb_build_object('user_id', u.user_id, 'display_name', u.display_name,
    'avatar_url', u.avatar_url, 'share_handle', u.share_handle, 'city_id', u.city,
    'verification_level', u.verification_level) -- 0652
    into v_owner from public.users u where u.user_id = v_row.owner_id;

  return jsonb_build_object(
    'listing_id', v_row.listing_id, 'owner_id', v_row.owner_id,
    'world_slug', v_row.world_slug, 'world_label_en', v_row.world_label_en,
    'world_label_he', v_row.world_label_he, 'kind_slug', v_row.kind_slug,
    'kind_label_en', v_row.kind_label_en, 'kind_label_he', v_row.kind_label_he,
    'direction', v_row.direction, 'title', v_row.title, 'summary', v_row.summary,
    'details', v_row.details, 'city_id', v_row.city_id, 'urgency_level', v_row.urgency_level,
    'availability_status', v_row.availability_status, 'status', v_listing.status,
    'published_at', v_row.published_at,
    'geo', case when v_row.geo is null then null else extensions.st_asgeojson(v_row.geo)::jsonb end,
    'max_radius_km', v_listing.max_radius_km_override,
    'media', v_media, 'owner', v_owner,
    'feed_post_id', v_post_id,
    'feed_hidden', coalesce((select p.feed_hidden from public.posts p where p.post_id = v_post_id), false)
  );
end;
$$;

/**
 * list_my_listings as of 0413, its rows as one ordered JSON array. The kind join sits inside the
 * paged query, as it does in the function: since 0667 `listings` is a view over `posts`, a post
 * with no kind is a row the join drops, and a limit taken first would return a short page (#2004).
 */
create function pg_temp.old_my_listings(p_limit int, p_offset int, p_cursor_updated_at timestamptz, p_cursor_id uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(to_jsonb(q) order by q.ord), '[]'::jsonb) from (
    select row_number() over (order by l.updated_at desc, l.listing_id desc) as ord,
           l.listing_id, l.world_slug, l.kind_slug as slug, l.direction, l.status, l.title,
           l.summary, l.urgency_level, l.availability_status, l.updated_at
      from (select l.*, lk.slug as kind_slug from public.listings l
              join public.listing_kinds lk on lk.kind_id = l.kind_id
             where l.owner_id = auth.uid()
               and l.status <> 'removed_admin'
               and (p_cursor_id is null or (l.updated_at, l.listing_id) < (p_cursor_updated_at, p_cursor_id))
             order by l.updated_at desc, l.listing_id desc
             limit least(greatest(coalesce(p_limit, 50), 1), 100)
             offset case when p_cursor_id is null then greatest(coalesce(p_offset, 0), 0) else 0 end) l
  ) q;
$$;

/** list_profile_listings as of 0338, its rows as one ordered JSON array. */
create function pg_temp.old_profile_listings(p_owner_id uuid, p_limit int)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(to_jsonb(q) order by q.ord), '[]'::jsonb) from (
    select row_number() over (order by l.published_at desc nulls last, l.created_at desc) as ord,
           l.listing_id, l.world_slug, lk.slug, l.direction, l.status, l.title, l.summary
      from public.listings l
      join public.listing_kinds lk on lk.kind_id = l.kind_id
     where l.owner_id = p_owner_id
       and l.moderation_status = 'published'
       and l.status in ('open', 'closed')
       and public.is_listing_visible_to(l, auth.uid())
     order by l.published_at desc nulls last, l.created_at desc
     limit least(greatest(coalesce(p_limit, 24), 1), 50)
  ) q;
$$;

/** The RPC's rows in the oracle's JSON form. */
create function pg_temp.new_my_listings(p_limit int, p_offset int, p_cursor_updated_at timestamptz, p_cursor_id uuid)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'ord', q.ord, 'listing_id', q.listing_id, 'world_slug', q.world_slug, 'slug', q.kind_slug,
           'direction', q.direction, 'status', q.status, 'title', q.title, 'summary', q.summary,
           'urgency_level', q.urgency_level, 'availability_status', q.availability_status,
           'updated_at', q.updated_at) order by q.ord), '[]'::jsonb)
    from (select row_number() over () as ord, r.*
            from public.list_my_listings(p_limit, p_offset, p_cursor_updated_at, p_cursor_id) r) q;
$$;

create function pg_temp.new_profile_listings(p_owner_id uuid, p_limit int)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'ord', q.ord, 'listing_id', q.listing_id, 'world_slug', q.world_slug, 'slug', q.kind_slug,
           'direction', q.direction, 'status', q.status, 'title', q.title, 'summary', q.summary)
           order by q.ord), '[]'::jsonb)
    from (select row_number() over () as ord, r.* from public.list_profile_listings(p_owner_id, p_limit) r) q;
$$;

/** Asserts every reader agrees with its oracle for every listing, as owner, viewer and guest. */
create function pg_temp.assert_same(p_stage text)
returns void
language plpgsql
as $$
declare
  p personas;
  v_viewer uuid;
  v_listing uuid;
  v_first jsonb;
begin
  select * into p from personas;
  foreach v_viewer in array array[p.owner, p.viewer, p.mentor, null] loop
    if v_viewer is null then perform kc_test.act_as_anon(); else perform kc_test.act_as(v_viewer); end if;
    for v_listing in select listing_id from public.listings where owner_id in (p.owner, p.mentor) loop
      perform kc_test.assert_eq(public.get_marketplace_listing_detail(v_listing)::text, pg_temp.old_detail(v_listing)::text,
        format('%s: detail of %s for %s', p_stage, v_listing, coalesce(v_viewer::text, 'a guest')));
      perform kc_test.assert_eq(public.get_marketplace_listing_detail(public.post_id_of_listing(v_listing))::text,
        pg_temp.old_detail(public.post_id_of_listing(v_listing))::text,
        format('%s: detail by post id of %s', p_stage, v_listing));
    end loop;
    perform kc_test.assert_eq(pg_temp.new_profile_listings(p.owner, 24)::text, pg_temp.old_profile_listings(p.owner, 24)::text,
      format('%s: profile list for %s', p_stage, coalesce(v_viewer::text, 'a guest')));
    perform kc_test.assert_eq(pg_temp.new_profile_listings(p.mentor, 24)::text, pg_temp.old_profile_listings(p.mentor, 24)::text,
      format('%s: mentor profile list', p_stage));
    if v_viewer is not null then
      perform kc_test.assert_eq(pg_temp.new_my_listings(50, 0, null, null)::text, pg_temp.old_my_listings(50, 0, null, null)::text,
        format('%s: own list of %s', p_stage, v_viewer));
      -- Keyset and offset pages agree too.
      v_first := pg_temp.old_my_listings(2, 0, null, null);
      if jsonb_array_length(v_first) = 2 then
        perform kc_test.assert_eq(
          pg_temp.new_my_listings(2, 0, (v_first -> 1 ->> 'updated_at')::timestamptz, (v_first -> 1 ->> 'listing_id')::uuid)::text,
          pg_temp.old_my_listings(2, 0, (v_first -> 1 ->> 'updated_at')::timestamptz, (v_first -> 1 ->> 'listing_id')::uuid)::text,
          format('%s: own list keyset page', p_stage));
        perform kc_test.assert_eq(pg_temp.new_my_listings(2, 1, null, null)::text, pg_temp.old_my_listings(2, 1, null, null)::text,
          format('%s: own list offset page', p_stage));
      end if;
    end if;
  end loop;
end $$;
grant execute on function pg_temp.assert_same(text), pg_temp.old_detail(uuid), pg_temp.old_my_listings(int, int, timestamptz, uuid),
  pg_temp.old_profile_listings(uuid, int), pg_temp.new_my_listings(int, int, timestamptz, uuid), pg_temp.new_profile_listings(uuid, int) to public;

-- ── T1 every shape, every stage, as owner, member and guest ─────────────────────────────────
do $$
declare
  p personas;
  v_ride uuid;
  v_direct uuid;
  v_item_post uuid;
  v_knowledge uuid;
  v_backfilled uuid;
begin
  select * into p from personas;

  -- A post-owned ride.
  perform kc_test.act_as(p.owner);
  v_ride := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'),
    p_title   => 'Tel Aviv to Jerusalem',
    p_summary => 'leaving from the central station',
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(interval '3 hours'), 'seats_available', 3),
    p_city_id => 'tel-aviv',
    p_availability_status => 'scheduled',
    p_max_radius_km => 12.5);

  -- A listing-sourced ride with a title its post cannot carry whole and no city.
  v_direct := kc_test.create_listing(p.owner, 'rides', 'ride_offer', 'give', repeat('long title ', 10),
    kc_test.ride_route_tlv_jlm()
    || jsonb_build_object('departs_at', kc_test.iso_in(interval '5 hours'), 'seats_available', 2));

  -- An items post (its listing keeps origin 'post') and a directly inserted items listing.
  perform kc_test.act_as(p.owner);
  insert into public.posts (owner_id, type, title, description, category, city, street, street_number, item_condition)
  values (p.owner, 'Give', 'a bookshelf', 'solid oak', 'Furniture', 'tel-aviv', 'Herzl', '1', 'Good')
  returning post_id into v_item_post;
  perform kc_test.create_listing(p.owner, 'items', 'give_item', 'give', 'a lamp',
    '{"item_condition":"Good","image_url":"https://example.test/i.jpg"}'::jsonb, now() + interval '30 days');

  -- A knowledge listing awaiting moderation: no post yet.
  v_knowledge := kc_test.create_listing(p.mentor, 'knowledge', 'course', 'give', 'intro to sql',
    jsonb_build_object(
      'topic', 'SQL', 'level', 'beginner', 'modality', 'video', 'slots_available', 2,
      'slot_starts_at', kc_test.iso_in(interval '10 minutes'),
      'slot_ends_at', kc_test.iso_in(interval '2 hours')));
  perform kc_test.assert_eq(public.post_id_of_listing(v_knowledge),
    case when (select relkind from pg_class where relname = 'listings') = 'r' then null::uuid else v_knowledge end,
    'the pending knowledge listing has expected post');

  -- A listing made post-owned by the 0554 backfill: its post kept the mirror's values — the
  -- title cut to 80 characters, the trimmed description and the owner's city where the listing has
  -- none — until a later write converges the two. Built here as a post-owned ride whose listing
  -- holds the pre-0554 values and whose post holds the mirror's, written with the posts → listings
  -- sync off so the listing keeps its own.
  perform kc_test.act_as(p.owner);
  v_backfilled := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'),
    p_title   => 'Haifa to Tel Aviv',
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(interval '6 hours'), 'seats_available', 2),
    p_city_id => 'tel-aviv');

  -- Every row here is written in one transaction, so now() ties them all; give each published
  -- listing its own publication time so the profile order (published_at desc) is fully defined.
  -- The change flows to the post of a post-owned listing (0626).
  update public.listings l
     set published_at = now() - r.n * interval '1 minute', created_at = now() - r.n * interval '1 minute'
    from (select listing_id, row_number() over (order by listing_id) as n
            from public.listings where owner_id in (p.owner, p.mentor)) r
   where l.listing_id = r.listing_id and l.published_at is not null;
  update public.posts po
     set published_at = l.published_at, created_at = l.created_at
    from public.listings l
   where po.post_id = l.legacy_post_id or po.listing_id = l.listing_id;

  -- The backfilled shape diverges last: a listing write after this would converge it again.
  update public.listings
     set title = 'a ride listed before the post model ' || repeat('z', 70), summary = '  padded summary  ', city_id = null
   where listing_id = v_backfilled;
  if exists (select 1 from pg_trigger where tgname = 'posts_sync_listing') then
    alter table public.posts disable trigger posts_sync_listing;
    update public.posts po
       set title = left(l.title, 80), description = nullif(trim(l.summary), ''), city = 'haifa'
      from public.listings l
     where l.listing_id = v_backfilled and po.post_id = l.legacy_post_id;
    alter table public.posts enable trigger posts_sync_listing;
    perform kc_test.assert_true(
      (select po.title <> l.title and po.city is distinct from l.city_id and po.description is distinct from l.summary
         from public.listings l join public.posts po on po.post_id = l.legacy_post_id
        where l.listing_id = v_backfilled),
      'the backfilled shape: its post and its listing differ on title, description and city');
  end if;

  perform pg_temp.assert_same('created');

  perform kc_test.act_as(p.owner);
  perform public.update_my_listing(v_ride, p_title => 'Tel Aviv to Jerusalem, 2 seats', p_summary => 'one stop',
                                   p_city_id => 'haifa', p_urgency_level => 3::smallint);
  perform pg_temp.assert_same('edited');

  perform kc_test.act_as(p.owner);
  perform public.pause_my_listing(v_ride);
  perform public.pause_my_listing(v_direct);
  perform pg_temp.assert_same('paused');

  perform kc_test.act_as(p.owner);
  perform public.resume_my_listing(v_ride);
  update public.listings set moderation_status = 'pending_review' where listing_id = v_ride;
  update public.posts set moderation_status = 'pending_review' where listing_id = v_ride or post_id = v_ride;
  perform pg_temp.assert_same('held');

  update public.listings set moderation_status = 'published' where listing_id in (v_ride, v_knowledge);
  update public.posts set moderation_status = 'published' where listing_id in (v_ride, v_knowledge) or post_id in (v_ride, v_knowledge);
  if exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync') then
    perform kc_test.assert_true(public.post_id_of_listing(v_knowledge) is not null, 'publishing gave the knowledge listing its post');
  end if;
  perform pg_temp.assert_same('published again');

  perform kc_test.act_as(p.owner);
  perform public.fulfill_my_listing(v_ride);
  perform public.resume_my_listing(v_direct);
  perform pg_temp.assert_same('fulfilled');
end $$;

-- ── T2 #2004: a post with no kind sits inside the keyset page, every run ────────────────────────
-- Fixed listing ids make the order deterministic; all five share one updated_at (one transaction).
do $$
declare
  p personas;
  v_kind public.listing_kinds.kind_id%type := kc_test.listing_kind_id('items', 'give_item');
  v_ids uuid[] := array['00000000-0000-4000-8000-000000002005', '00000000-0000-4000-8000-000000002004',
                        '00000000-0000-4000-8000-000000002003', '00000000-0000-4000-8000-000000002002',
                        '00000000-0000-4000-8000-000000002001']::uuid[];
  v_first jsonb;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.pager);
  insert into public.posts (post_id, owner_id, type, title, description, category, city, street, street_number, item_condition, urgency_level, kind_id)
  select t.id, p.pager, 'Give', 'item ' || t.ord, 'solid oak', 'Furniture', 'tel-aviv', 'Herzl', '1', 'Good', 1::smallint, v_kind
    from unnest(v_ids) with ordinality as t(id, ord);
  -- Only an insert derives a kind (0693), so a kind-less row is made by clearing it.
  update public.posts set kind_id = null where post_id = v_ids[3];

  v_first := pg_temp.old_my_listings(2, 0, null, null);
  perform kc_test.assert_eq(jsonb_array_length(v_first), 2, 'T2: the first page is full');
  v_cursor_at := (v_first -> 1 ->> 'updated_at')::timestamptz;
  v_cursor_id := (v_first -> 1 ->> 'listing_id')::uuid;
  perform kc_test.assert_eq(v_cursor_id, v_ids[2], 'T2: the cursor is the second listing');

  perform kc_test.assert_eq(array(select r.listing_id from public.list_my_listings(2, 0, v_cursor_at, v_cursor_id) r)::text,
    array[v_ids[4], v_ids[5]]::text, 'T2: the keyset page skips the kind-less post and stays full');
  perform kc_test.assert_eq(pg_temp.new_my_listings(2, 0, v_cursor_at, v_cursor_id)::text,
    pg_temp.old_my_listings(2, 0, v_cursor_at, v_cursor_id)::text, 'T2: keyset page equals the oracle');
  perform kc_test.assert_eq(pg_temp.new_my_listings(2, 2, null, null)::text,
    pg_temp.old_my_listings(2, 2, null, null)::text, 'T2: offset page equals the oracle');
end $$;

rollback;
\echo '✓ 0629_g1_detail_lists_on_posts.sql passed'
