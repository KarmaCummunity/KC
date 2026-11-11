-- Handoffs · consequences of a status change
--
-- Whatever RPC or sweep moves a handoff, in whatever world, the same three things follow
-- from the new status, so they are attached to the table and not repeated in each writer:
--   1. the counterparty's profile counter (FR-CLOSURE-009 AC2)
--   2. a `karma` event — karma itself is computed by its own module
--   3. `notification` events for the member or members who did not make the change

-- Notification kind for a handoff change, or null when nobody is told. Kinds carry the
-- machine as a prefix (`giving_handoff_confirmed`, `ride_booking_confirmed`, …), except the
-- two that concern the recipient mark of a closed post (FR-NOTIF-009, FR-NOTIF-010).
create function kc_private.handoff_notification_kind(
  p_old public.post_handoffs,
  p_new public.post_handoffs,
  p_actor_id uuid
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_old.id is null and p_new.status = 'handed_over' then 'mark_recipient'
    when p_new.cancel_reason = 'unmarked' then 'unmark_recipient'
    -- Reopening a delivered post tells nobody (FR-NOTIF-013).
    when p_new.cancel_reason = 'reopened' then null
    else p_new.machine_id || '_' || case
      -- A new handoff: a request waiting for the owner, or a seat taken at once.
      when p_old.id is null and p_new.status = 'reserved' then 'requested'
      when p_old.id is null and p_new.status = 'confirmed' and p_actor_id = p_new.recipient_id then 'claimed'
      when p_old.id is null and p_new.status = 'waitlisted' then null
      when p_old.status = 'waitlisted' and p_new.status in ('reserved', 'confirmed') then 'waitlist_promoted'
      when p_old.status = 'cancelled' then 'reinstated'
      when p_new.status = 'confirmed' then 'confirmed'
      when p_new.status = 'handed_over' then 'completed'
      when p_new.status = 'no_show' then 'no_show'
      when p_new.cancel_reason = 'expired' then 'expired'
      -- A ride that expired without leaving: the seat lapses, nobody cancelled it.
      when p_new.machine_id = 'ride_booking' and p_new.cancel_reason = 'not_completed' then 'lapsed'
      when p_new.cancel_reason = 'declined' then 'declined'
      when p_new.status = 'cancelled' then 'cancelled'
    end
  end;
$$;
comment on function kc_private.handoff_notification_kind(public.post_handoffs, public.post_handoffs, uuid) is
  'Notification kind of a handoff insert (p_old null) or status change; null = no notification.';

create function kc_private.post_handoffs_apply_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.post_handoffs;
  -- The member whose call made the change; null for a sweep or other server work.
  v_actor_id constant uuid := (select auth.uid());
  -- +1 when the handoff becomes handed over, -1 when a delivery is taken back.
  v_delta constant integer := (new.status = 'handed_over')::integer
    - (tg_op = 'UPDATE' and old.status = 'handed_over')::integer;
  v_post public.posts;
  v_kind text;
  v_to uuid;
begin
  if tg_op = 'UPDATE' then
    if new.status = old.status then
      return null;
    end if;
    v_old := old;
  end if;
  select p.* into v_post from public.posts p where p.id = new.post_id;

  if v_delta <> 0 then
    -- On an offer the other member receives; on a request the other member gives.
    update public.user_stats s
       set items_received_count = greatest(
             s.items_received_count + case v_post.direction when 'offer' then v_delta else 0 end, 0),
           items_given_count = greatest(
             s.items_given_count + case v_post.direction when 'request' then v_delta else 0 end, 0)
     where s.user_id = new.recipient_id;

    perform kc_private.outbox_enqueue('karma', jsonb_build_object(
      'kind', case v_delta when 1 then 'handoff_completed' else 'handoff_reverted' end,
      'handoff_id', new.id, 'post_id', new.post_id, 'owner_id', new.owner_id,
      'recipient_id', new.recipient_id, 'world_slug', v_post.world_slug,
      'post_type', v_post.post_type, 'direction', v_post.direction, 'seats', new.seats));
  end if;

  v_kind := kc_private.handoff_notification_kind(v_old, new, v_actor_id);
  if v_kind is null then
    return null;
  end if;
  -- Both members, minus the one who acted (FR-NOTIF-018 AC5): a request reaches the owner,
  -- a mark reaches the member who was marked, a sweep's change reaches both.
  foreach v_to in array array[new.owner_id, new.recipient_id] loop
    continue when v_to is not distinct from v_actor_id;
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', v_kind, 'recipient_id', v_to, 'actor_id', v_actor_id,
      'entity', jsonb_build_object('type', 'post_handoff', 'id', new.id),
      'data', jsonb_build_object(
        'post_id', new.post_id, 'world_slug', v_post.world_slug, 'status', new.status,
        'cancel_reason', new.cancel_reason,
        -- One delivery per kind, handoff and addressee, however often the event is retried.
        'dedupe_key', v_kind || ':' || new.id || ':' || v_to)));
  end loop;
  return null;
end;
$$;
comment on function kc_private.post_handoffs_apply_effects() is
  'AFTER INSERT OR UPDATE OF status on post_handoffs: counterparty counter, karma event, notifications.';

create trigger post_handoffs_apply_effects
  after insert or update of status on public.post_handoffs
  for each row
  execute function kc_private.post_handoffs_apply_effects();
