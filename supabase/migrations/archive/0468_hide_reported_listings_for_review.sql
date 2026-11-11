-- 0468_hide_reported_listings_for_review | KC#1298 — D33 / D61 / G33 for marketplace listings.
-- docs/spec/07_cross_cutting_systems.md §7.15: content reported by 3 distinct reporters within
-- 14 days is hidden until human review, not removed. `0452` did this for posts; listings still
-- went straight to `removed_admin` (`0339`), so a falsely reported item or food listing could
-- not come back through the review path.
--
--   0. Reporting a listing works at all: `reports_after_insert_apply_effects` records a
--      reporter-side hide for every report, but `reporter_hides` only accepted post/user/chat, so
--      every listing report (`0337`) failed. The hide now also applies to listings, and
--      `is_listing_visible_to` honours it (FR-MOD-001 AC1), like `is_post_visible_to` for posts.
--      `audit_events` likewise rejected `target_type = 'listing'`, which every listing report,
--      auto-action and `admin_remove_listing` (`0339`) writes; it now accepts it.
--   1. New listing status `hidden_pending_review`. Every browse, search, map and matching read
--      filters `status = 'open'`, and `is_listing_visible_to` admits only open/closed listings
--      to non-owners, so a hidden listing drops out everywhere while the owner still sees it.
--   2. The report threshold hides an open listing and tells its owner in their support thread
--      (`owner_auto_removed`, outcome `hidden_pending_review`, as posts do).
--   3. `admin_restore_target('listing')` restores a hidden listing to `open`;
--      `admin_remove_listing` (`0339`) already moves any non-removed listing to `removed_admin`.
--   4. The review states are entered and left only by the threshold and the admin RPCs.
--
-- Function bodies are the current definitions (`0242`, `0339`, `0452`) with only the marked lines changed.
-- Idempotent.

begin;

-- ── 0. Listing reports can be recorded (FR-MOD-001 AC1) ──────────────────
alter table public.reporter_hides drop constraint if exists reporter_hides_target_type_check;
alter table public.reporter_hides add constraint reporter_hides_target_type_check
  check (target_type = any (array['post', 'user', 'chat', 'listing']));

alter table public.audit_events drop constraint if exists audit_events_target_type_check;
alter table public.audit_events add constraint audit_events_target_type_check
  check (target_type = any (array['post', 'user', 'chat', 'listing', 'report', 'task', 'none']));

create or replace function public.is_listing_visible_to(p_listing listings, p_viewer uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_post public.posts;
  v_ride public.ride_listings;
begin
  if p_listing.owner_id = p_viewer then
    return true;
  end if;

  -- KC#1298: a listing the viewer reported stays hidden from them (FR-MOD-001 AC1).
  if exists (
    select 1 from public.reporter_hides h
     where h.reporter_id = p_viewer
       and h.target_type = 'listing'
       and h.target_id   = p_listing.listing_id
  ) then
    return false;
  end if;

  if p_listing.legacy_post_id is not null then
    select * into v_post from public.posts where post_id = p_listing.legacy_post_id;
    if not found then
      return false;
    end if;
    return public.is_post_visible_to(v_post, p_viewer);
  end if;

  if p_listing.legacy_ride_id is not null then
    select * into v_ride from public.ride_listings where ride_id = p_listing.legacy_ride_id;
    if not found then
      return false;
    end if;
    if v_ride.owner_id = p_viewer then
      return true;
    end if;
    if public.is_blocked(p_viewer, v_ride.owner_id) then
      return false;
    end if;
    if v_ride.status <> 'open' then
      return false;
    end if;
    return v_ride.visibility = 'Public'
      or (v_ride.visibility = 'FollowersOnly' and public.is_following(p_viewer, v_ride.owner_id));
  end if;

  if p_listing.moderation_status <> 'published' then
    return false;
  end if;

  if p_listing.status not in ('open', 'closed') then
    return false;
  end if;

  if public.is_blocked(p_viewer, p_listing.owner_id) then
    return false;
  end if;

  case p_listing.anonymity_level
    when 3 then
      return p_listing.status = 'open'
        or (p_listing.status = 'closed' and p_listing.owner_id = p_viewer);
    when 2 then
      return p_listing.status = 'open'
        and public.is_following(p_viewer, p_listing.owner_id);
    when 1 then
      return public.is_listing_operator(p_viewer);
    else
      return false;
  end case;
end;
$$;

-- ── 1. New listing status ─────────────────────────────────────────────────
alter table public.listings drop constraint if exists listings_status_check;
alter table public.listings add constraint listings_status_check check (status = any (array[
  'open', 'closed', 'cancelled', 'expired', 'removed_admin', 'hidden_pending_review'
]));

-- ── 2. Report threshold: hide for review instead of removing ──────────────
create or replace function public.reports_listing_auto_remove_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  distinct_reporters int;
  v_owner_id         uuid;
  v_owner_chat       uuid;
begin
  if new.target_type <> 'listing' or new.target_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('mod_target_listing_' || new.target_id::text)::bigint);

  select count(distinct reporter_id) into distinct_reporters
    from public.reports
   where target_type = 'listing'
     and target_id   = new.target_id
     and status      = 'open'
     and created_at >= now() - interval '14 days';

  if distinct_reporters >= 3 then
    -- D33/D61: hide for human review instead of removing. Only an open listing is hidden,
    -- so a restore back to `open` is exact.
    update public.listings
       set status = 'hidden_pending_review', updated_at = now()
     where listing_id = new.target_id
       and status = 'open'
    returning owner_id into v_owner_id;

    if found then
      insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
      values (null, 'auto_remove_target', 'listing', new.target_id,
              jsonb_build_object('distinct_reporters', distinct_reporters));

      -- Best-effort owner notice in their support thread; a failure never blocks the report.
      begin
        if v_owner_id is not null and v_owner_id <> new.reporter_id then
          v_owner_chat := public.find_or_create_support_chat(v_owner_id);
          if v_owner_chat is not null then
            perform public.inject_system_message(v_owner_chat,
              jsonb_build_object('kind', 'owner_auto_removed',
                                 'target_type', 'listing',
                                 'target_id', new.target_id,
                                 'outcome', 'hidden_pending_review'),
              null);
          end if;
        end if;
      exception when others then
        raise warning 'owner_auto_removed message failed: % (state %, listing %)',
          sqlerrm, sqlstate, new.target_id;
      end;
    end if;
  end if;

  return new;
end;
$$;

-- ── 3. Admin restore understands the new status ───────────────────────────
create or replace function public.admin_restore_target(p_target_type text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor     uuid := auth.uid();
  v_changed   boolean := false;
  v_reporters uuid[];
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  if p_target_type not in ('post','user','chat','listing') then
    raise exception 'invalid_target_type' using errcode = 'P0010';
  end if;

  if p_target_type = 'post' then
    if not exists (select 1 from public.posts where post_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'post';
    end if;
  elsif p_target_type = 'user' then
    if not exists (select 1 from public.users where user_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'user';
    end if;
  elsif p_target_type = 'chat' then
    if not exists (select 1 from public.chats where chat_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'chat';
    end if;
  elsif p_target_type = 'listing' then
    if not exists (select 1 from public.listings where listing_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'listing';
    end if;
  end if;

  if p_target_type = 'post' then
    update public.posts set status = 'open', updated_at = now()
     where post_id = p_target_id and status in ('removed_admin', 'hidden_pending_review');
    v_changed := found;
  elsif p_target_type = 'user' then
    if exists (select 1 from public.users
               where user_id = p_target_id
                 and account_status not in ('suspended_admin','active')) then
      raise exception 'invalid_restore_state'
        using errcode = 'P0011', detail = 'user not in suspended_admin state';
    end if;
    update public.users set account_status = 'active'
     where user_id = p_target_id and account_status = 'suspended_admin';
    v_changed := found;
  elsif p_target_type = 'chat' then
    update public.chats set removed_at = null
     where chat_id = p_target_id and removed_at is not null;
    v_changed := found;
  elsif p_target_type = 'listing' then
    -- KC#1298: a listing hidden for review is restored like a removed one.
    update public.listings set status = 'open', updated_at = now()
     where listing_id = p_target_id and status in ('removed_admin', 'hidden_pending_review');
    v_changed := found;
  end if;

  if not v_changed then return; end if;

  select coalesce(array_agg(distinct reporter_id order by reporter_id), array[]::uuid[])
    into v_reporters
    from public.reports
   where target_type = p_target_type
     and target_id   = p_target_id
     and status      = 'open';

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'restore_target', p_target_type, p_target_id,
          jsonb_build_object('distinct_reporters', to_jsonb(v_reporters)));
end;
$$;

-- ── 4. Review states belong to moderation ─────────────────────────────────
-- The threshold trigger and the admin RPCs are SECURITY DEFINER, so they write as the function
-- owner; a client writing the table directly runs as `authenticated` (or `anon`) and may neither
-- enter nor leave a review state.
create or replace function public.listings_moderation_status_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and (old.status in ('hidden_pending_review', 'removed_admin')
          or new.status in ('hidden_pending_review', 'removed_admin'))
     and current_user in ('authenticated', 'anon') then
    raise exception 'listing_status_moderated' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.listings_moderation_status_guard() from public, anon, authenticated;

comment on function public.listings_moderation_status_guard() is
  'Only moderation (report threshold, admin RPCs) moves a listing into or out of hidden_pending_review / removed_admin. KC#1298.';

drop trigger if exists listings_moderation_status_guard on public.listings;
create trigger listings_moderation_status_guard
  before update of status on public.listings
  for each row execute function public.listings_moderation_status_guard();

commit;
