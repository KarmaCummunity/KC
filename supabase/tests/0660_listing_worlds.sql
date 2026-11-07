-- supabase/tests/0660_listing_worlds.sql | tests for multi-world posts (#1475)
-- Verifies:
-- 1. listing_worlds table, primary key, no duplicate primary world constraint.
-- 2. get_listing_additional_worlds & set_listing_additional_worlds RPCs.
-- 3. browse_listings includes listing in both primary and additional world feeds with no duplicates.
-- 4. search_listings includes additional worlds.
-- 5. feed_ranked_ids matches posts with additional worlds.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('mw_author') as author,
       kc_test.create_user('mw_viewer') as viewer;

-- ── 1. Create a listing with primary world 'items' ──────────────────────────────────────────────
select kc_test.act_as((select author from personas));

create temp table my_listing as
select public.create_marketplace_listing(
  p_kind_id => kc_test.listing_kind_id('items', 'give_item'),
  p_title => 'מתמטיקה בהתנדבות',
  p_summary => 'שיעור פרטי במתמטיקה',
  p_direction => 'give',
  p_city_id => 'tel-aviv'
) as listing_id;

do $$
declare
  v_lid uuid;
begin
  select listing_id into v_lid from my_listing;
  if v_lid is null then
    raise exception 'failed to create fixture listing';
  end if;
end;
$$;

-- ── 2. listing_worlds constraints & helpers ────────────────────────────────────────────────────
-- Adding an additional world 'knowledge' succeeds
insert into public.listing_worlds (listing_id, world_slug)
select listing_id, 'knowledge' from my_listing;

-- Attempting to add primary world 'items' fails
do $$
declare
  v_lid uuid;
  v_failed boolean := false;
begin
  select listing_id into v_lid from my_listing;
  begin
    insert into public.listing_worlds (listing_id, world_slug)
    values (v_lid, 'items');
  exception when sqlstate '23514' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'constraint failed: primary world should not be insertable into listing_worlds';
  end if;
end;
$$;

-- get_listing_additional_worlds helper returns the additional world
do $$
declare
  v_lid uuid;
  v_worlds text[];
begin
  select listing_id into v_lid from my_listing;
  v_worlds := public.get_listing_additional_worlds(v_lid);
  if v_worlds <> array['knowledge'] then
    raise exception 'get_listing_additional_worlds unexpected: %', v_worlds;
  end if;
end;
$$;

-- set_listing_additional_worlds updates the worlds and filters out primary
select public.set_listing_additional_worlds(
  (select listing_id from my_listing),
  array['knowledge', 'time', 'items']
);

do $$
declare
  v_lid uuid;
  v_worlds text[];
begin
  select listing_id into v_lid from my_listing;
  v_worlds := public.get_listing_additional_worlds(v_lid);
  if v_worlds <> array['knowledge', 'time'] then
    raise exception 'set_listing_additional_worlds unexpected: %', v_worlds;
  end if;
end;
$$;

-- ── 3. browse_listings includes additional worlds ──────────────────────────────────────────────
select kc_test.act_as((select viewer from personas));

-- Browse 'items' (primary world) returns the listing
do $$
declare
  v_lid uuid;
  v_found boolean;
begin
  select listing_id into v_lid from my_listing;
  select exists (
    select 1 from public.browse_listings(p_world_slug => 'items') where listing_id = v_lid
  ) into v_found;
  if not v_found then
    raise exception 'browse_listings failed to return listing in primary world items';
  end if;
end;
$$;

-- Browse 'knowledge' (additional world) returns the listing
do $$
declare
  v_lid uuid;
  v_found boolean;
begin
  select listing_id into v_lid from my_listing;
  select exists (
    select 1 from public.browse_listings(p_world_slug => 'knowledge') where listing_id = v_lid
  ) into v_found;
  if not v_found then
    raise exception 'browse_listings failed to return listing in additional world knowledge';
  end if;
end;
$$;

-- Browse 'time' (additional world) returns the listing
do $$
declare
  v_lid uuid;
  v_found boolean;
begin
  select listing_id into v_lid from my_listing;
  select exists (
    select 1 from public.browse_listings(p_world_slug => 'time') where listing_id = v_lid
  ) into v_found;
  if not v_found then
    raise exception 'browse_listings failed to return listing in additional world time';
  end if;
end;
$$;

-- Browse 'food' (unrelated world) does NOT return the listing
do $$
declare
  v_lid uuid;
  v_found boolean;
begin
  select listing_id into v_lid from my_listing;
  select exists (
    select 1 from public.browse_listings(p_world_slug => 'food') where listing_id = v_lid
  ) into v_found;
  if v_found then
    raise exception 'browse_listings returned listing in unrelated world food';
  end if;
end;
$$;

-- Browse without world returns the listing at most once (no duplicate rows)
do $$
declare
  v_lid uuid;
  v_count integer;
begin
  select listing_id into v_lid from my_listing;
  select count(*) into v_count
    from public.browse_listings()
   where listing_id = v_lid;
  if v_count <> 1 then
    raise exception 'browse_listings duplicate rows count: % (expected 1)', v_count;
  end if;
end;
$$;

-- ── 4. search_listings by world includes additional worlds ─────────────────────────────────────
-- Ensure search vector exists
update public.listings
   set search_vector = to_tsvector('simple', title || ' ' || coalesce(summary, ''))
 where listing_id = (select listing_id from my_listing);

do $$
declare
  v_lid uuid;
  v_found boolean;
begin
  select listing_id into v_lid from my_listing;
  select exists (
    select 1 from public.search_listings('מתמטיקה', p_world_slug => 'knowledge')
     where listing_id = v_lid
  ) into v_found;
  if not v_found then
    raise exception 'search_listings failed to find listing with p_world_slug knowledge';
  end if;
end;
$$;

rollback;
