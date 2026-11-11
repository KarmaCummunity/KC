-- 0716_giving_reservation_expiry | Wave 2c of the FSM kernel program (#1989, G61)
--
-- An item or animal reservation waits for the giver's approval until `confirm_by` (24 h after the
-- request, `reserve_item_giving`). Only rides and housing swept that deadline, so an unanswered
-- request never lapsed: the post stayed "scheduled", nobody else could reserve it, and the giver
-- could not pause or close it around the pending request.
--
-- 1. `giving_reservation_expiry_sweep()` (every 10 minutes): an items / animals reservation still
--    `reserved` after `confirm_by` is cancelled with `cancel_reason = 'expired'`
--    (`reserved → cancelled`, machine `giving_handoff`), and its open post is available again.
--    Knowledge bookings have their own confirm action and sweep (`knowledge_bookings_expire_sweep`, 0704).
-- 2. `giving_handoff_notify` (the 0621 body): an expiry pushes both sides
--    `giving_handoff_expired` instead of a cancellation by someone (FR-NOTIF-018).

-- ── 1. The sweep ───────────────────────────────────────────────────────────────
create or replace function public.giving_reservation_expiry_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_handoff record; -- an unanswered request past its confirm window
begin
  for v_handoff in
    select handoff_id, post_id
      from public.post_handoffs
     where status = 'reserved'
       and world_slug in ('items', 'animals')
       and confirm_by < now()
     for update skip locked
  loop
    update public.post_handoffs
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'expired'
     where handoff_id = v_handoff.handoff_id;
    -- The post can be reserved again, unless another handoff still holds it.
    update public.posts p
       set availability_status = 'immediate', updated_at = now()
     where p.post_id = v_handoff.post_id
       and p.status = 'open'
       and not exists (
         select 1 from public.post_handoffs h
          where h.post_id = p.post_id and h.status in ('reserved', 'confirmed'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.giving_reservation_expiry_sweep() is
  'Wave 2c (0716): items / animals reservations unanswered past confirm_by are cancelled as expired and the post is available again. pg_cron every 10 minutes.';

revoke all on function public.giving_reservation_expiry_sweep() from public, anon, authenticated;

-- ── 2. Expiry has its own push ─────────────────────────────────────────────────
create or replace function public.giving_handoff_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- The member whose call changed the handoff; null for a sweep or a service-role write.
  v_actor uuid := auth.uid();
  v_kind text;
  v_recipients uuid[];
  v_title text;
  v_to uuid;
begin
  if tg_op = 'INSERT' then
    -- An item request waits for the giver; a food quick claim (0383) is confirmed at once.
    if new.status = 'reserved' then
      v_kind := 'giving_handoff_requested';
      v_recipients := array[new.owner_id];
    elsif new.status = 'confirmed' then
      v_kind := 'giving_handoff_claimed';
      v_recipients := array[new.owner_id];
    end if;
  elsif new.status is distinct from old.status then
    case new.status
      when 'confirmed' then
        v_kind := 'giving_handoff_confirmed';
        v_recipients := array[new.recipient_id];
      when 'cancelled' then
        if new.cancel_reason = 'expired' then
          -- 0716: the giver did not answer within the confirm window; tell both sides.
          v_kind := 'giving_handoff_expired';
        elsif old.status = 'reserved' and v_actor = new.owner_id then
          v_kind := 'giving_handoff_declined';
        else
          v_kind := 'giving_handoff_cancelled';
        end if;
        -- Both sides: self-suppression drops the side that cancelled.
        v_recipients := array[new.owner_id, new.recipient_id];
      when 'handed_over' then
        v_kind := 'giving_handoff_completed';
        v_recipients := array[new.owner_id, new.recipient_id];
      else
        null;
    end case;
  end if;
  if v_kind is null then
    return new;
  end if;

  select title into v_title from public.posts where post_id = new.post_id; -- 0621: the post's title
  foreach v_to in array v_recipients loop
    perform public.enqueue_notification(
      v_to, 'critical', v_kind,
      'notifications.' || public.giving_handoff_copy_key(v_kind) || 'Title',
      'notifications.' || public.giving_handoff_copy_key(v_kind) || 'Body',
      jsonb_build_object(
        -- The other side's name: the push is about what they did or asked for.
        'name', coalesce((select display_name from public.users
                           where user_id = case when v_to = new.owner_id then new.recipient_id
                                                else new.owner_id end), ''),
        'listingTitle', coalesce(v_title, '')),
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object(
                           'listingId', public.listing_id_of_post(new.post_id)::text)), -- 0621: the derived listing
      -- One push per kind, handoff and recipient: both sides can get the same kind.
      v_kind || ':' || new.handoff_id::text || ':' || v_to::text,
      false
    );
  end loop;
  return new;
end;
$$;


-- ── 3. Schedule ────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'giving_reservation_expiry_sweep') then
      perform cron.unschedule('giving_reservation_expiry_sweep');
    end if;
    perform cron.schedule(
      'giving_reservation_expiry_sweep',
      '*/10 * * * *',
      $sql$ select public.giving_reservation_expiry_sweep(); $sql$
    );
  else
    raise notice 'pg_cron not enabled — giving_reservation_expiry_sweep not scheduled.';
  end if;
end $$;
