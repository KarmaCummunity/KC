-- 0686_fsm_post_event_owner_actions — wave 1b-iv of docs/architecture/state-machines.md (#1989).
--
-- {{D:event-owner-cancels-registrations}} (PM, 2026-11-09): an organizer may pause, close or
-- delete an event post that has registrations; the registrations are cancelled and each
-- attendee is notified. Before, the copies disagreed: the owner RPCs (0666) refused while a
-- registration was live, but the post status trigger (0665 / 0681) let the same move through.
--
-- 1. `event_cancel_open_registrations` (internal): while the event has not started, cancels
--    its reserved, confirmed and waitlisted registrations (`host_cancelled`) and notifies each
--    attendee once. After the start, registrations stay for attendance marking.
-- 2. `posts_event_owner_move_cancels_registrations`: after a post moves from open or paused to
--    paused, closed_delivered, deleted_no_recipient or removed_admin, an event's open
--    registrations are cancelled. One trigger covers every writer of the move.
-- 3. `pause_my_listing`, `fulfill_my_listing`, `delete_my_listing` (0666 bodies, verbatim
--    except one filter): event registrations no longer count as a blocking handoff.

begin;

-- ── 1. Cancel an upcoming event's open registrations ──────────────────────────
create or replace function kc_private.event_cancel_open_registrations(p_post_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_count int := 0;
  r record;
begin
  -- Only an event that has not started yet; afterwards the organizer marks attendance.
  if not exists (
    select 1 from public.event_post_details e
     where e.post_id = p_post_id and e.starts_at > now()
  ) then
    return 0;
  end if;
  select title into v_title from public.posts where post_id = p_post_id;

  for r in
    update public.post_handoffs
       set status = 'cancelled', cancel_reason = 'host_cancelled', cancelled_at = now()
     where post_id = p_post_id
       and world_slug = 'time'
       and status in ('reserved', 'confirmed', 'waitlisted')
    returning handoff_id, recipient_id
  loop
    perform public.enqueue_notification(
      r.recipient_id, 'critical', 'event_registration_cancelled',
      'notifications.eventRegistrationCancelledTitle', 'notifications.eventRegistrationCancelledBody',
      jsonb_build_object('eventTitle', coalesce(v_title, '')),
      jsonb_build_object('route', '/post/[id]', 'params', jsonb_build_object('postId', p_post_id::text)),
      'event_registration_cancelled:' || r.handoff_id::text,
      false
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function kc_private.event_cancel_open_registrations(uuid) is
  '{{D:event-owner-cancels-registrations}} (0686): cancels an upcoming event''s open registrations (host_cancelled) and notifies each attendee.';

revoke all on function kc_private.event_cancel_open_registrations(uuid) from public, anon, authenticated;
grant execute on function kc_private.event_cancel_open_registrations(uuid) to service_role;

-- ── 2. Every owner or admin move that takes an event off the air cancels them ──
create or replace function public.posts_event_owner_move_cancels_registrations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('open', 'paused')
     and new.status in ('paused', 'closed_delivered', 'deleted_no_recipient', 'removed_admin')
     and old.status is distinct from new.status then
    perform kc_private.event_cancel_open_registrations(new.post_id);
  end if;
  return null;
end;
$$;

comment on function public.posts_event_owner_move_cancels_registrations() is
  '{{D:event-owner-cancels-registrations}} (0686): after an event post leaves open / paused for paused, closed, deleted or removed, its open registrations are cancelled.';

revoke all on function public.posts_event_owner_move_cancels_registrations() from public, anon, authenticated;

drop trigger if exists posts_event_owner_move_cancels_registrations on public.posts;
create trigger posts_event_owner_move_cancels_registrations
  after update of status on public.posts
  for each row execute function public.posts_event_owner_move_cancels_registrations();

-- ── 3. Owner RPCs: event registrations do not block ───────────────────────────
create or replace function public.pause_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts := public.post_lock_own_listing(p_listing_id);
  v_lid uuid;
  v_status text;
begin
  if v_post.post_id is not null then
    if v_post.status <> 'open' then
      raise exception 'listing_wrong_status' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.post_handoffs h
       where h.post_id = v_post.post_id
         and h.world_slug <> 'time'  -- 0686: event registrations are cancelled, not blocking
         and h.status in ('reserved', 'confirmed')
    ) then
      raise exception 'listing_has_active_handoff' using errcode = '23514';
    end if;
    perform public.post_record_set_status(v_post, 'paused');
    update public.posts set availability_status = 'ongoing', updated_at = now()
     where post_id = v_post.post_id;

    v_lid := coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post.post_id));
    if v_lid is not null then
      update public.listings set availability_status = 'ongoing', updated_at = now()
       where listing_id = v_lid;
    end if;
    return;
  end if;

  select status into v_status from public.listings where listing_id = p_listing_id and owner_id = auth.uid() for update;
  if v_status <> 'open' then
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

create or replace function public.fulfill_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts := public.post_lock_own_listing(p_listing_id);
  v_status text;
  v_lid uuid;
begin
  if v_post.post_id is not null then
    if v_post.status <> 'open' then
      raise exception 'listing_wrong_status' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.post_handoffs h
       where h.post_id = v_post.post_id
         and h.world_slug <> 'time'  -- 0686: event registrations are cancelled, not blocking
         and h.status in ('reserved', 'confirmed')
    ) then
      raise exception 'listing_has_active_handoff' using errcode = '23514';
    end if;
    perform public.post_record_set_status(v_post, 'closed_delivered');
    v_lid := coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post.post_id), p_listing_id);
    perform public.karma_grant_once(v_post.owner_id, 'listing_fulfilled', 'listing', v_lid::text, 4);
    return;
  end if;

  select status into v_status from public.listings where listing_id = p_listing_id and owner_id = auth.uid() for update;
  if v_status <> 'open' then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(p_listing_id) then
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  update public.listings set status = 'closed', updated_at = now() where listing_id = p_listing_id;
  perform public.karma_grant_once(auth.uid(), 'listing_fulfilled', 'listing', p_listing_id::text, 4);
end;
$$;

create or replace function public.delete_my_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts := public.post_lock_own_listing(p_listing_id);
  v_lid uuid;
  v_status text;
begin
  if v_post.post_id is not null then
    if v_post.status not in ('open', 'paused', 'closed_delivered') then
      raise exception 'listing_wrong_status' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.post_handoffs h
       where h.post_id = v_post.post_id
         and h.world_slug <> 'time'  -- 0686: event registrations are cancelled, not blocking
         and h.status in ('reserved', 'confirmed')
    ) then
      raise exception 'listing_has_active_handoff' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.post_handoffs h
       where h.post_id = v_post.post_id and h.world_slug <> 'time' and h.status = 'handed_over'
    ) then
      raise exception 'listing_has_handoff_history' using errcode = '23514';
    end if;

    -- 0686: the delete is a hard delete, so no status trigger runs and the registrations go with
    -- the post in the cascade; an upcoming event's attendees are notified first.
    perform kc_private.event_cancel_open_registrations(v_post.post_id);

    v_lid := coalesce(v_post.legacy_listing_id, public.listing_id_of_post(v_post.post_id));
    if v_lid is not null then
      delete from public.listing_media where listing_id = v_lid;
      delete from public.listings where listing_id = v_lid;
    end if;
    delete from public.posts where post_id = v_post.post_id;
    return;
  end if;

  select status into v_status from public.listings where listing_id = p_listing_id and owner_id = auth.uid() for update;
  if v_status not in ('open', 'cancelled', 'closed') then
    raise exception 'listing_wrong_status' using errcode = '23514';
  end if;
  if public.listing_has_active_handoff(p_listing_id) then
    raise exception 'listing_has_active_handoff' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.post_handoffs h
     where h.post_id = public.post_id_of_listing(p_listing_id)
       and h.world_slug <> 'time'
       and h.status = 'handed_over'
  ) then
    raise exception 'listing_has_handoff_history' using errcode = '23514';
  end if;
  delete from public.listing_media where listing_id = p_listing_id;
  delete from public.listings where listing_id = p_listing_id;
end;
$$;

commit;
