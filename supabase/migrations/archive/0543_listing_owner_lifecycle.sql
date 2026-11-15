-- 0543_listing_owner_lifecycle | docs/spec/07 §7.1 "Owner management" (PM decision 2026-11-03).
-- What a listing's owner may do in each status, enforced by the owner RPCs:
--   open    edit, pause, mark fulfilled, delete, add photos
--   paused  ('cancelled') edit, resume (not after expiry), delete, add photos; hidden from
--           everyone but the owner (is_listing_visible_to, the feed mirror) — unchanged here
--   closed  fields locked (update_my_listing already refuses); photos may be added, never
--           replaced or removed; delete only while no handoff was handed over
-- An active handoff (reserved / confirmed) blocks pause, mark fulfilled and delete, so a
-- taker is never stranded and karma is never granted twice (the handoff flow closes it).
-- Refusals carry codes the client maps to messages: listing_not_found (missing, or not the
-- caller's), listing_wrong_status, listing_has_active_handoff, listing_has_handoff_history,
-- listing_expired, listing_media_full, media_path_must_be_owned.

begin;

-- ── helpers (internal: called only from the SECURITY DEFINER RPCs below) ────────
create or replace function public.listing_has_active_handoff(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.giving_handoffs h
     where h.listing_id = p_listing_id
       and h.status in ('reserved', 'confirmed')
  );
$$;

revoke all on function public.listing_has_active_handoff(uuid) from public, anon, authenticated;

-- The caller's own listing, locked for the status change; raises listing_not_found otherwise.
create or replace function public.listing_lock_own(p_listing_id uuid)
returns public.listings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.listings;
begin
  if auth.uid() is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  select * into v_row
    from public.listings
   where listing_id = p_listing_id
     and owner_id = auth.uid()
   for update;
  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.listing_lock_own(uuid) from public, anon, authenticated;

-- ── pause: open → paused, never over an active handoff ──────────────────────────
create or replace function public.pause_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.listings := public.listing_lock_own(p_listing_id);
begin
  if v_row.status <> 'open' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(p_listing_id) then
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  update public.listings
     set status = 'cancelled', availability_status = 'ongoing', updated_at = now()
   where listing_id = p_listing_id;
end;
$$;

-- ── resume: paused → open, unless the listing's own expiry has passed ───────────
create or replace function public.resume_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.listings := public.listing_lock_own(p_listing_id);
begin
  if v_row.status <> 'cancelled' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'listing_expired' using errcode = '23514';
  end if;
  update public.listings set status = 'open', updated_at = now() where listing_id = p_listing_id;
end;
$$;

-- ── mark fulfilled: open → closed by hand, only when no handoff is in progress ──
create or replace function public.fulfill_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.listings := public.listing_lock_own(p_listing_id);
begin
  if v_row.status <> 'open' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(p_listing_id) then
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  update public.listings set status = 'closed', updated_at = now() where listing_id = p_listing_id;
  perform public.karma_grant_once(v_row.owner_id, 'listing_fulfilled', 'listing', p_listing_id::text, 4);
end;
$$;

-- ── delete: open / paused / closed, never over a live or completed handoff ──────
create or replace function public.delete_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.listings := public.listing_lock_own(p_listing_id);
begin
  if v_row.status not in ('open', 'cancelled', 'closed') then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(p_listing_id) then
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  -- A handed-over handoff is the other side's record too (rating, karma), as for posts
  -- (FR-POST-010: a closed post with a recipient cannot be deleted).
  if exists (
    select 1 from public.giving_handoffs h
     where h.listing_id = p_listing_id and h.status = 'handed_over'
  ) then
    raise exception 'listing_has_handoff_history' using errcode = '23514';
  end if;
  delete from public.listing_media where listing_id = p_listing_id;
  delete from public.listings where listing_id = p_listing_id;
end;
$$;

-- ── add photos: appended after the existing ones, never replacing them ─────────
create or replace function public.add_my_listing_media(p_listing_id uuid, p_storage_paths text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.listings := public.listing_lock_own(p_listing_id);
  -- listing_media.sort_order is checked to 0..9 (0333): ten photos in all.
  v_next smallint := coalesce(
    (select max(m.sort_order) + 1 from public.listing_media m where m.listing_id = p_listing_id), 0);
  v_added integer := 0;
  v_path text;
begin
  if v_row.status not in ('open', 'cancelled', 'closed') then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  foreach v_path in array coalesce(p_storage_paths, array[]::text[]) loop
    continue when v_path is null or length(trim(v_path)) = 0;
    if not (v_path like auth.uid()::text || '/%') then
      raise exception 'media_path_must_be_owned' using errcode = '23514';
    end if;
    if v_next >= 10 then
      raise exception 'listing_media_full' using errcode = '23514';
    end if;
    insert into public.listing_media (listing_id, storage_path, sort_order)
    values (p_listing_id, v_path, v_next)
    on conflict on constraint listing_media_listing_path_unique do nothing;
    if found then
      v_next := v_next + 1;
      v_added := v_added + 1;
    end if;
  end loop;
  if v_added > 0 then
    update public.listings set updated_at = now() where listing_id = p_listing_id;
  end if;
  return v_added;
end;
$$;

revoke all on function public.add_my_listing_media(uuid, text[]) from public, anon;
grant execute on function public.add_my_listing_media(uuid, text[]) to authenticated;

-- Replacing a listing's photos is for the create flows only (they call it as owner of the
-- function); a client could otherwise wipe the photos of a closed listing.
revoke execute on function public.attach_listing_media(uuid, text[]) from authenticated;

commit;
