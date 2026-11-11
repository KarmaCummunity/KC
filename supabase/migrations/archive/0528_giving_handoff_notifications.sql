-- 0528_giving_handoff_notifications | KC#1391 FR-NOTIF-018: item and food handoffs push the other side
--
-- Rides tell the other side of every booking change (0511, `giving_handoffs_ride_notify`), but an
-- item or food handoff changed silently: the giver never heard of a new request, and the
-- requester never heard it was approved, declined or done. This trigger sends one push to the
-- other side of every such change. The tap opens the listing:
--
--   new request (reserved)          → giver      giving_handoff_requested
--   food quick claim (confirmed)    → giver      giving_handoff_claimed
--   approved (reserved → confirmed) → requester  giving_handoff_confirmed
--   giver cancels a waiting request → requester  giving_handoff_declined
--   any other cancellation          → the side that did not cancel (both sides for a system
--                                     cancel)    giving_handoff_cancelled
--   handed over                     → the side that did not mark it, to rate the handoff
--                                                giving_handoff_completed
--
-- `enqueue_notification` drops a push to the caller (self-suppression), so the side that acted
-- is never told about its own action. One push per (kind, handoff) keeps retries idempotent.
-- Rides keep their own trigger and copy (0511); knowledge sessions are not covered here.

begin;

-- Title / body copy key stem of a handoff kind, e.g. `giving_handoff_requested` →
-- `givingHandoffRequested`. The keys live in the dispatcher's i18n.json and the app locales.
create or replace function public.giving_handoff_copy_key(p_kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select 'givingHandoff' || initcap(split_part(p_kind, '_', 3));
$$;

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
        if old.status = 'reserved' and v_actor = new.owner_id then
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

  select title into v_title from public.listings where listing_id = new.listing_id;
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
                         'params', jsonb_build_object('listingId', new.listing_id::text)),
      -- One push per kind, handoff and recipient: both sides can get the same kind.
      v_kind || ':' || new.handoff_id::text || ':' || v_to::text,
      false
    );
  end loop;
  return new;
end;
$$;

comment on function public.giving_handoff_notify() is
  'FR-NOTIF-018: one push to the other side of every item / food handoff change (request, claim, approval, decline, cancellation, hand-over).';

drop trigger if exists giving_handoffs_giving_notify on public.giving_handoffs;
create trigger giving_handoffs_giving_notify
  after insert or update of status on public.giving_handoffs
  for each row when (new.world_slug in ('items', 'food'))
  execute function public.giving_handoff_notify();

-- Trigger function and its copy helper are internal: no client calls them (0520 default).
revoke all on function public.giving_handoff_notify() from public, anon, authenticated;
revoke all on function public.giving_handoff_copy_key(text) from public, anon, authenticated;
grant execute on function public.giving_handoff_notify() to service_role;
grant execute on function public.giving_handoff_copy_key(text) to service_role;

commit;
