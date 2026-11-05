-- 0627_g1_owner_rpcs_lock_the_post | G1 step 6a-5c (ADR-006, D-214, issue #1671): the owner
-- management RPCs lock the post — the record — first, then its listing.
--
-- Until now `pause / resume / fulfill / update / delete_my_listing` locked the listing and only then
-- the post (`listing_lock_own`, 0543; `listing_set_post_status`, 0554), while the booking writers
-- lock the post first (0624). Two transactions taking the same pair in opposite orders can
-- deadlock (an owner pausing while a passenger books). From this file on every writer of a
-- listing world takes the post's row lock first:
--   1. post_lock_own_listing (new)   resolves a listing id or a post id to the post, locks it and
--      checks the caller owns it; a listing that has no post yet (pending moderation) is checked
--      for ownership and the caller locks the listing alone
--   2. post_record_set_status (new)  sets a status on the record of any world: the post when it
--      owns a native listing (the listing follows), else the listing (items, listing-sourced; the
--      post follows or, for items, keeps its own engine as before); ride_post_set_status (0624)
--      now delegates to it
--   3. pause / resume / fulfill / update / delete_my_listing (0554, 0622) lock the post through 1,
--      then the listing through listing_lock_own, and write the status through 2.
-- The status guards still read the listing row, exactly as before, because a post of a listing
-- held for moderation has a status the listing does not (one state machine is 6b). Every RPC
-- now also accepts the post id where it took the listing id; the karma reference, the handoff
-- checks and the listing writes use the resolved listing id. Names, arguments, return types,
-- error codes and grants are unchanged; `listing_lock_own` and `listing_set_post_status` stay
-- (6c). Bodies are the latest definitions copied verbatim; every changed line carries `-- 0627`.

begin;

-- ── 1. Lock the post of a listing the caller owns ───────────────────────────────────────────────
create or replace function public.post_lock_own_listing(p_target uuid)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id uuid := public.handoff_target_post_id(p_target);
  v_post public.posts;
begin
  -- Same error codes as listing_lock_own (0543).
  if auth.uid() is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if v_post_id is null then
    -- A listing without a post yet (not published, 0557): the caller locks the listing alone.
    if not exists (select 1 from public.listings l where l.listing_id = p_target and l.owner_id = auth.uid()) then
      raise exception 'listing_not_found' using errcode = 'P0002';
    end if;
    return null;
  end if;
  select * into v_post
    from public.posts
   where post_id = v_post_id
     and owner_id = auth.uid()
   for update;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  return v_post;
end;
$$;

comment on function public.post_lock_own_listing(uuid) is
  'G1 (0627): resolves a listing id or a post id to its post, locks it FOR UPDATE and checks the caller owns it (auth_required / listing_not_found); null for an owned listing that has no post yet. Owner RPCs lock the post first, then the listing.';

revoke all on function public.post_lock_own_listing(uuid) from public, anon, authenticated;
grant execute on function public.post_lock_own_listing(uuid) to service_role;

-- ── 2. Set a status on the record of any world ──────────────────────────────────────────────────
-- The post when it owns a native listing (food, rides, housing, time), whose listing follows
-- through listing_upsert_from_post; otherwise the listing — listing-sourced (the post follows
-- through the mirror sync) or items (its listing keeps origin 'post', as listing_set_post_status
-- left it) — as listing_status_for_post maps the status. The caller holds the post's row lock.
create or replace function public.post_record_set_status(p_post public.posts, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_post.world_slug, 'items') <> 'items' and public.post_owns_listing(p_post) then
    update public.posts set status = p_status, updated_at = now()
     where post_id = p_post.post_id and status is distinct from p_status;
  else
    update public.listings set status = public.listing_status_for_post(p_status), updated_at = now()
     where listing_id = coalesce(p_post.listing_id, p_post.legacy_listing_id, public.listing_id_of_post(p_post.post_id));
  end if;
end;
$$;

comment on function public.post_record_set_status(public.posts, text) is
  'G1 (0627): sets a status on a post''s record — the post when it owns a native listing, else its listing (listing-sourced or items); the other side follows. The caller holds the post''s row lock.';

revoke all on function public.post_record_set_status(public.posts, text) from public, anon, authenticated;
grant execute on function public.post_record_set_status(public.posts, text) to service_role;

-- ride_post_set_status (0624) is the rides case of the generic setter.
create or replace function public.ride_post_set_status(p_post public.posts, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.post_record_set_status(p_post, p_status); -- 0627: one setter for every world
end;
$$;

revoke all on function public.ride_post_set_status(public.posts, text) from public, anon, authenticated;
grant execute on function public.ride_post_set_status(public.posts, text) to service_role;

-- ── 3. Owner management (D104): post first, then listing (0554) ─────────────────────────────────
create or replace function public.pause_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts := public.post_lock_own_listing(p_listing_id); -- 0627: the post first
  v_row public.listings := public.listing_lock_own(coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post.post_id), p_listing_id)); -- 0627: then its listing
begin
  if v_row.status <> 'open' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(v_row.listing_id) then -- 0627: the resolved listing
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  if v_post.post_id is not null then                                    -- 0627
    perform public.post_record_set_status(v_post, 'paused');            -- 0627: the record
    update public.listings set availability_status = 'ongoing', updated_at = now() where listing_id = v_row.listing_id; -- 0627
    return;
  end if;
  update public.listings
     set status = 'cancelled', availability_status = 'ongoing', updated_at = now()
   where listing_id = v_row.listing_id; -- 0627: a listing without a post yet
end;
$$;

create or replace function public.resume_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts := public.post_lock_own_listing(p_listing_id); -- 0627: the post first
  v_row public.listings := public.listing_lock_own(coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post.post_id), p_listing_id)); -- 0627: then its listing
begin
  if v_row.status <> 'cancelled' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'listing_expired' using errcode = '23514';
  end if;
  if v_post.post_id is not null then                         -- 0627
    perform public.post_record_set_status(v_post, 'open');   -- 0627: the record
    return;
  end if;
  update public.listings set status = 'open', updated_at = now() where listing_id = v_row.listing_id; -- 0627
end;
$$;

create or replace function public.fulfill_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts := public.post_lock_own_listing(p_listing_id); -- 0627: the post first
  v_row public.listings := public.listing_lock_own(coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post.post_id), p_listing_id)); -- 0627: then its listing
begin
  if v_row.status <> 'open' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(v_row.listing_id) then -- 0627: the resolved listing
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  if v_post.post_id is not null then                                     -- 0627
    perform public.post_record_set_status(v_post, 'closed_delivered');   -- 0627: the record
  else                                                                   -- 0627
    update public.listings set status = 'closed', updated_at = now() where listing_id = v_row.listing_id; -- 0627
  end if;
  -- The karma reference stays the listing id (one grant per listing, whichever id the caller sent).
  perform public.karma_grant_once(v_row.owner_id, 'listing_fulfilled', 'listing', v_row.listing_id::text, 4); -- 0627
end;
$$;

create or replace function public.update_my_listing(
  p_listing_id uuid,
  p_title text default null,
  p_summary text default null,
  p_details jsonb default null,
  p_city_id text default null,
  p_max_radius_km numeric default null,
  p_urgency_level smallint default null,
  p_availability_status text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.listings%rowtype;
  v_post public.posts; -- 0627
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  v_post := public.post_lock_own_listing(p_listing_id); -- 0627: the post first
  select * into v_row from public.listings
   where listing_id = coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post.post_id), p_listing_id) -- 0627
     and owner_id = v_uid for update;
  if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
  if v_row.status not in ('open', 'cancelled') then
    raise exception 'listing_not_editable' using errcode = '23514';
  end if;
  if p_details is not null
     and not public.validate_listing_details(coalesce(v_post.kind_id, v_row.kind_id), p_details) then -- 0627: the post's kind
    raise exception 'details_schema_mismatch' using errcode = '23514';
  end if;

  if v_row.origin = 'native' and v_row.legacy_post_id is not null then
    if p_title is not null and char_length(trim(p_title)) > 80 then
      raise exception 'title_too_long' using errcode = '23514';
    end if;
    -- The post is the record; the listing follows through the posts → listings trigger.
    update public.posts set
      title         = coalesce(nullif(trim(p_title), ''), title),
      description   = case when p_summary is null then description else nullif(trim(p_summary), '') end,
      details       = coalesce(p_details, details),
      city          = coalesce(p_city_id, city),
      urgency_level = coalesce(p_urgency_level, urgency_level),
      geo           = case when p_city_id is not null then public.listing_geo_from_city(p_city_id) else geo end,
      updated_at    = now()
    where post_id = v_row.legacy_post_id;

    update public.listings set
      max_radius_km_override = coalesce(p_max_radius_km, max_radius_km_override),
      availability_status    = coalesce(p_availability_status, availability_status),
      updated_at             = now()
    where listing_id = v_row.listing_id -- 0627: the resolved listing
      and (p_max_radius_km is not null or p_availability_status is not null);
    return;
  end if;

  update public.listings set
    title = coalesce(nullif(trim(p_title), ''), title),
    summary = case when p_summary is null then summary else nullif(trim(p_summary), '') end,
    details = coalesce(p_details, details),
    city_id = coalesce(p_city_id, city_id),
    max_radius_km_override = coalesce(p_max_radius_km, max_radius_km_override),
    urgency_level = coalesce(p_urgency_level, urgency_level),
    availability_status = coalesce(p_availability_status, availability_status),
    geo = case
      when p_city_id is not null then public.listing_geo_from_city(p_city_id)
      else geo
    end,
    updated_at = now()
  where listing_id = v_row.listing_id; -- 0627: the resolved listing
end;
$$;

-- delete_my_listing (0622).
create or replace function public.delete_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts := public.post_lock_own_listing(p_listing_id); -- 0627: the post first
  v_row public.listings := public.listing_lock_own(coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post.post_id), p_listing_id)); -- 0627: then its listing
begin
  if v_row.status not in ('open', 'cancelled', 'closed') then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(v_row.listing_id) then -- 0627: the resolved listing
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  -- A handed-over handoff is the other side's record too (rating, karma), as for posts
  -- (FR-POST-010: a closed post with a recipient cannot be deleted).
  if exists (
    select 1 from public.post_handoffs h                        -- 0622: the record
     where h.post_id = public.post_id_of_listing(v_row.listing_id) -- 0627: the resolved listing's post
       and h.world_slug <> 'time' -- 0622: event attendance never blocked the delete (0620)
       and h.status = 'handed_over'
  ) then
    raise exception 'listing_has_handoff_history' using errcode = '23514';
  end if;
  delete from public.listing_media where listing_id = v_row.listing_id; -- 0627
  if v_row.origin = 'native' and v_row.legacy_post_id is not null then
    -- The post is the record; its listing goes with it (legacy_post_id cascades).
    delete from public.posts where post_id = v_row.legacy_post_id;
    return;
  end if;
  delete from public.listings where listing_id = v_row.listing_id; -- 0627
end;
$$;

-- `create or replace` keeps the 0543 / 0554 / 0622 grants; restated so this file is self-contained.
revoke all on function public.pause_my_listing(uuid) from public, anon;
revoke all on function public.resume_my_listing(uuid) from public, anon;
revoke all on function public.fulfill_my_listing(uuid) from public, anon;
revoke all on function public.delete_my_listing(uuid) from public, anon;
grant execute on function public.pause_my_listing(uuid) to authenticated;
grant execute on function public.resume_my_listing(uuid) to authenticated;
grant execute on function public.fulfill_my_listing(uuid) to authenticated;
grant execute on function public.delete_my_listing(uuid) to authenticated;
revoke all on function public.update_my_listing(uuid, text, text, jsonb, text, numeric, smallint, text) from public, anon;
grant execute on function public.update_my_listing(uuid, text, text, jsonb, text, numeric, smallint, text) to authenticated;

commit;
