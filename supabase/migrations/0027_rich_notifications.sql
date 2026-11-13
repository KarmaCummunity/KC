-- Notifications · rich texts, follow pushes and the world kinds lost at the cut-over
-- (D26 "rich notifications", FR-NOTIF-005/006/007/008, FR-NOTIF-018 AC6, spec 07 §7.11)
--
-- 1. Follow requests, new followers and approved requests are pushed again (FR-NOTIF-006..008),
--    still switched off as a group by the member's "social" switch (FR-NOTIF-014 AC3).
-- 2. Every notification about a post carries what its text names (D26): the post's title and,
--    for a booking, its seats, its time and a ride's route. They are added to the stored
--    arguments when the row is written, from the post and the handoff, so no emitter has to
--    know them and the centre and the push read the same values. Times are written as
--    numbers in Israel time; the words around them live in the app's locale files.
-- 3. A food offer that is about to expire or expired has its own kinds and texts
--    (`food_expiring`, `food_expired`), not the 7-day post copy.
-- 4. A booking in the knowledge world is a lesson, not a handed-over item: its handoff changes
--    use `knowledge_booking_<change>` kinds with lesson wording.
-- 5. A chat hidden after reports tells each of its members (`chat_auto_removed`).

insert into kc_private.notification_kinds
  (kind, category, sends_push, group_window, title_key, body_key)
values
  ('follow_request', 'social', true, null, 'notifications.followRequestTitle', 'notifications.followRequestBody'),
  ('follow_started', 'social', true, interval '1 hour', 'notifications.followStartedTitle', 'notifications.followStartedBody'),
  ('follow_approved', 'social', true, null, 'notifications.followApprovedTitle', 'notifications.followApprovedBody')
on conflict (kind) do update set sends_push = excluded.sends_push;

insert into kc_private.notification_kinds (kind, category, bypass_preferences, title_key, body_key)
values
  ('food_expiring', 'critical', false, 'notifications.foodExpiringTitle', 'notifications.foodExpiringBody'),
  ('food_expired', 'critical', false, 'notifications.foodExpiredTitle', 'notifications.foodExpiredBody'),
  -- The member has a right to know, like `auto_removed` (FR-NOTIF-011).
  ('chat_auto_removed', 'critical', true, 'notifications.chatAutoRemovedTitle', 'notifications.chatAutoRemovedBody');

insert into kc_private.notification_kinds (kind, category, title_key, body_key)
values
  ('knowledge_booking_requested', 'critical', 'notifications.knowledgeBookingRequestedTitle', 'notifications.knowledgeBookingRequestedBody'),
  ('knowledge_booking_claimed', 'critical', 'notifications.knowledgeBookingClaimedTitle', 'notifications.knowledgeBookingClaimedBody'),
  ('knowledge_booking_confirmed', 'critical', 'notifications.knowledgeBookingConfirmedTitle', 'notifications.knowledgeBookingConfirmedBody'),
  ('knowledge_booking_declined', 'critical', 'notifications.knowledgeBookingDeclinedTitle', 'notifications.knowledgeBookingDeclinedBody'),
  ('knowledge_booking_cancelled', 'critical', 'notifications.knowledgeBookingCancelledTitle', 'notifications.knowledgeBookingCancelledBody'),
  ('knowledge_booking_expired', 'critical', 'notifications.knowledgeBookingExpiredTitle', 'notifications.knowledgeBookingExpiredBody'),
  ('knowledge_booking_completed', 'critical', 'notifications.knowledgeSessionCompletedTitle', 'notifications.knowledgeSessionCompletedBody'),
  ('knowledge_booking_no_show', 'critical', 'notifications.knowledgeBookingNoShowTitle', 'notifications.knowledgeBookingNoShowBody'),
  ('knowledge_booking_waitlist_promoted', 'critical', 'notifications.knowledgeBookingWaitlistPromotedTitle', 'notifications.knowledgeBookingWaitlistPromotedBody'),
  ('knowledge_booking_reinstated', 'critical', 'notifications.knowledgeBookingReinstatedTitle', 'notifications.knowledgeBookingReinstatedBody');

-- What a notification's text may name about its post, as text arguments:
--   post_title          the post's title
--   seats               seats of a ride booking or guests of a stay, when more than one
--   when_label          a ride's departure or a booked slot, "DD.MM HH:MI" in Israel time;
--                       a stay as "DD.MM-DD.MM"
--   route_from/route_to a ride's origin and destination (city or junction names)
-- The post is the entity itself, the post of a handoff, or `post_id` in the arguments.
create function kc_private.notification_rich_args(p_entity_type text, p_entity_id uuid, p_data jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_handoff public.post_handoffs;
  v_post_id uuid;
  v_title text;
  v_ride public.post_ride_details;
  v_args jsonb := '{}'::jsonb;
begin
  if p_entity_type = 'post_handoff' then
    select h.* into v_handoff from public.post_handoffs h where h.id = p_entity_id;
    v_post_id := v_handoff.post_id;
  elsif p_entity_type = 'post' then
    v_post_id := p_entity_id;
  elsif p_data ->> 'post_id' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' then
    v_post_id := (p_data ->> 'post_id')::uuid;
  end if;
  select p.title into v_title from public.posts p where p.id = v_post_id;
  if v_title is null then
    return v_args;
  end if;
  v_args := jsonb_build_object('post_title', v_title);
  select r.* into v_ride from public.post_ride_details r where r.post_id = v_post_id;

  if v_ride.post_id is not null then
    v_args := v_args || jsonb_build_object(
      'route_from', kc_access.place_name(v_ride.origin_city_id, null, v_ride.origin_junction_id),
      'route_to', kc_access.place_name(v_ride.dest_city_id, null, v_ride.dest_junction_id),
      'when_label', to_char(v_ride.departs_at at time zone 'Asia/Jerusalem', 'DD.MM HH24:MI'));
  end if;
  if v_handoff.id is null then
    return jsonb_strip_nulls(v_args);
  end if;
  if v_handoff.seats > 1 then
    v_args := v_args || jsonb_build_object('seats', v_handoff.seats);
  end if;
  if v_handoff.machine_id = 'housing_booking' and v_handoff.slot_starts_at is not null then
    v_args := v_args || jsonb_build_object('when_label',
      to_char(v_handoff.slot_starts_at at time zone 'Asia/Jerusalem', 'DD.MM') || '-' ||
      to_char(v_handoff.slot_ends_at at time zone 'Asia/Jerusalem', 'DD.MM'));
  elsif v_handoff.slot_starts_at is not null then
    v_args := v_args || jsonb_build_object('when_label',
      to_char(v_handoff.slot_starts_at at time zone 'Asia/Jerusalem', 'DD.MM HH24:MI'));
  end if;
  return jsonb_strip_nulls(v_args);
end;
$$;
comment on function kc_private.notification_rich_args(text, uuid, jsonb) is
  'Text arguments a notification may name about its post: title, seats, time, route (D26).';

-- Adds the rich arguments to a notification when it is written or merged; an argument the
-- emitter already set is kept.
create function kc_private.notifications_add_rich_args()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.data := kc_private.notification_rich_args(new.entity_type, new.entity_id, new.data) || new.data;
  return new;
end;
$$;
comment on function kc_private.notifications_add_rich_args() is
  'BEFORE INSERT / UPDATE OF data on notifications: adds post title, seats, time and route.';

create trigger notifications_add_rich_args
  before insert or update of data on public.notifications
  for each row execute function kc_private.notifications_add_rich_args();

-- Handoff kinds: a knowledge booking (a lesson or a session) is named as one.
create or replace function kc_private.handoff_notification_kind(
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
    else case
      when p_new.machine_id = 'giving_handoff'
           and exists (select 1 from public.posts p where p.id = p_new.post_id and p.world_slug = 'knowledge')
        then 'knowledge_booking'
      else p_new.machine_id
    end || '_' || case
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

-- Expiry of every world; a food offer's owner is told with the food wording.
create or replace function kc_private.post_expiry_sweep(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post record;
  v_handoff record;
  v_count integer := 0;
begin
  for v_post in
    select p.id, p.owner_id, p.world_slug from public.posts p
     where p.expires_at <= now() and p.status in ('open', 'paused')
     order by p.expires_at
     limit least(greatest(p_limit, 1), 5000)
       for update skip locked
  loop
    for v_handoff in
      select h.id, h.status from public.post_handoffs h
       where h.post_id = v_post.id
         and ((h.machine_id <> 'event_registration' and h.status in ('reserved', 'confirmed'))
              or (h.machine_id = 'event_registration' and h.status in ('waitlisted', 'reserved')))
    loop
      perform kc_private.handoff_move(
        v_handoff.id, 'cancelled', 'system',
        case when v_handoff.status in ('reserved', 'waitlisted') then 'expired' else 'not_completed' end);
    end loop;
    perform kc_private.post_move(v_post.id, 'expired', 'system');
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', case v_post.world_slug when 'food' then 'food_expired' else 'post_expired' end,
      'recipient_id', v_post.owner_id, 'actor_id', null,
      'entity', jsonb_build_object('type', 'post', 'id', v_post.id),
      'data', jsonb_build_object('world_slug', v_post.world_slug, 'dedupe_key', 'post_expired:' || v_post.id)));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Food offers nearing expiry: urgency rises inside 72 hours; inside 24 hours the owner is
-- told once, with the food wording (S4, FR-NOTIF-005).
create or replace function kc_private.food_expiry_alert_sweep(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_food record;
  v_count integer := 0;
begin
  update public.posts p
     set urgency_level = 3
    from public.post_food_details f
   where f.post_id = p.id and f.expires_at <= now() + interval '72 hours'
     and p.status = 'open' and p.urgency_level is distinct from 3;

  for v_food in
    select f.post_id, f.expires_at, p.owner_id
      from public.post_food_details f
      join public.posts p on p.id = f.post_id
     where f.expires_at > now() and f.expires_at <= now() + interval '24 hours'
       and f.expiry_alerted_at is null and p.status = 'open'
     order by f.expires_at
     limit least(greatest(p_limit, 1), 5000)
       for update of f skip locked
  loop
    update public.post_food_details f set expiry_alerted_at = now() where f.post_id = v_food.post_id;
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', 'food_expiring', 'recipient_id', v_food.owner_id, 'actor_id', null,
      'entity', jsonb_build_object('type', 'post', 'id', v_food.post_id),
      'data', jsonb_build_object(
        'world_slug', 'food', 'expires_at', v_food.expires_at,
        'dedupe_key', 'food_expiring:' || v_food.post_id || ':' || v_food.expires_at)));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- A chat hidden for review after reports: each member is told once per hiding.
create function kc_private.chats_notify_auto_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  for v_user_id in select cm.user_id from public.chat_members cm where cm.chat_id = new.id loop
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', 'chat_auto_removed', 'recipient_id', v_user_id, 'actor_id', null,
      'entity', jsonb_build_object('type', 'chat', 'id', new.id),
      'data', jsonb_build_object(
        'dedupe_key', 'chat_auto_removed:' || new.id || ':' || v_user_id || ':' || new.moderation_hidden_at)));
  end loop;
  return null;
end;
$$;
comment on function kc_private.chats_notify_auto_removed() is
  'AFTER UPDATE OF moderation_hidden_at on chats: tells each member that the chat was hidden after reports.';

create trigger chats_notify_auto_removed
  after update of moderation_hidden_at on public.chats
  for each row
  when (old.moderation_hidden_at is null and new.moderation_hidden_at is not null)
  execute function kc_private.chats_notify_auto_removed();
