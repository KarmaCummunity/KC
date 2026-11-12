-- Notifications: the registry names every kind; delivery turns an outbox event into one
-- notification, honouring preferences, bypass kinds, blocks, dedupe keys, grouping and quiet
-- hours; a member reads and marks only their own notifications; follow events are emitted;
-- rows are routed to monthly partitions and purged by retention; the badge is broadcast.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.id(p_who text) returns uuid language sql as
  $$select ('00000000-0000-4000-8000-00000000000' || p_who)::uuid$$;

-- Runs a statement as a signed-in member (or as `anon` when p_who is null) and returns its
-- first value as text; 'ok' when it returns none, the message of a P0001 error, or the
-- SQLSTATE of any other error.
create function pg_temp.run(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', pg_temp.id(p_who), 'role', case when p_who is null then 'anon' else 'authenticated' end)::text, true);
    perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
    execute p_sql into v_value;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return coalesce(nullif(v_value, ''), 'ok');
  exception when others then
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- Records a `notification` event and delivers it; returns the delivery result.
create function pg_temp.emit(
  p_kind text, p_to text, p_actor text default null, p_entity text default null, p_data jsonb default '{}')
returns jsonb
language sql
as $$
  select kc_private.notifications_deliver(kc_private.outbox_enqueue('notification', jsonb_build_object(
    'kind', p_kind, 'recipient_id', pg_temp.id(p_to), 'actor_id', pg_temp.id(p_actor),
    'entity', case when p_entity is not null then jsonb_build_object('type', 'chat', 'id', pg_temp.id(p_entity)) end,
    'data', p_data)));
$$;

-- 'status' or 'status:reason' of a delivery, plus ':push' when a push is to be sent.
create function pg_temp.outcome(p_result jsonb)
returns text
language sql
as $$
  select concat_ws(':', p_result ->> 'status', p_result ->> 'reason',
                   case when p_result -> 'push' <> 'null'::jsonb then 'push' end);
$$;

-- Pending `notification` events of a kind addressed to a member.
create function pg_temp.events(p_kind text, p_who text)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = 'notification' and e.processed_at is null and e.payload ->> 'kind' = p_kind
     and e.payload ->> 'recipient_id' = pg_temp.id(p_who)::text;
$$;

-- Sets a member's notification preferences.
create function pg_temp.prefs(p_who text, p_preferences jsonb)
returns void
language sql
as $$
  update public.user_private set notification_preferences = p_preferences where user_id = pg_temp.id(p_who);
$$;

select plan(66);

-- Alice, Bob, Carol and Dan are active; Eve has not confirmed her email. Dan blocked Bob.
insert into auth.users (id, email, raw_app_meta_data)
select pg_temp.id(x), x || '@example.test', case when x = 'e' then '{}' else '{"provider":"google"}' end::jsonb
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
update public.users set display_name = 'Member ' || right(id::text, 1);
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.id('d'), pg_temp.id('b'));

-- ── Registry ────────────────────────────────────────────────────────────────
-- 76 kinds from the baseline, plus those of later migrations: support_issue_received (0015),
-- report_sla_warning (0017), task_assigned (0034).
select is((select count(*) from kc_private.notification_kinds), 79::bigint, 'the registry holds every kind');
select is((select title_key || '|' || bypass_quiet_hours || '|' || category from kc_private.notification_kinds
            where kind = 'ride_booking_waitlist_promoted'),
  'notifications.rideBookingWaitlistPromotedTitle|true|critical', 'a handoff kind has its camelCase keys and rules');
select is((select count(*) from kc_private.notification_kinds where bypass_preferences), 5::bigint,
  'only the account, removal and emergency notices bypass preferences');
select is(pg_temp.run('a', 'select count(*) from kc_private.notification_kinds'), '42501', 'the registry is not readable from a device');

-- ── Delivery: one notification, the push for the worker, the event confirmed ─
select is(pg_temp.outcome(pg_temp.emit('mark_recipient', 'b', 'a', '1', '{"post_id":"p1","world_slug":"items","dedupe_key":"mark:1:b"}')),
  'delivered', 'an event becomes a notification; without a device there is no push');
select is((select kind || '|' || category || '|' || world_slug || '|' || title_key || '|' || entity_type || '|' || (actor_ids = array[pg_temp.id('a')])
              || '|' || (data ? 'dedupe_key') || '|' || (data ->> 'post_id')
            from public.notifications where user_id = pg_temp.id('b')),
  'mark_recipient|critical|items|notifications.markRecipientTitle|chat|true|false|p1', 'the notification carries kind, keys, entity, actor and data');
select is((select count(*) from kc_private.outbox_events where topic = 'notification' and processed_at is null), 0::bigint,
  'delivery confirms the outbox event');
select is(pg_temp.outcome(kc_private.notifications_deliver((select max(id) from kc_private.outbox_events))),
  'skipped:already_processed', 'delivering a confirmed event again does nothing');
select is(pg_temp.outcome(pg_temp.emit('mark_recipient', 'b', 'a', '1', '{"dedupe_key":"mark:1:b"}')), 'skipped:duplicate',
  'a second event with the same dedupe key is not delivered');
select is(pg_temp.outcome(pg_temp.emit('mark_recipient', 'c', 'a', '1', '{"dedupe_key":"mark:1:b"}')), 'delivered',
  'the same key for another member is delivered');

insert into public.user_devices (user_id, platform, push_token) values (pg_temp.id('b'), 'ios', 'token-b');
select is((select r -> 'push' -> 'tokens' -> 0 ->> 'token' || '|' || (r -> 'push' ->> 'title_key') || '|' || (r -> 'push' -> 'args' ->> 'actor_display_name')
              || '|' || (r -> 'push' -> 'data' ->> 'kind') || '|' || (r -> 'push' -> 'data' -> 'entity' ->> 'id' = pg_temp.id('2')::text)
            from pg_temp.emit('unmark_recipient', 'b', 'a', '2') r),
  'token-b|notifications.unmarkRecipientTitle|Member a|unmark_recipient|true', 'with a device the result carries the push to send');
select throws_ok($$select pg_temp.emit('no_such_kind', 'b')$$, 'P0001', 'unknown_notification_kind', 'an unregistered kind fails the delivery');

-- ── Who is not notified ─────────────────────────────────────────────────────
select is(pg_temp.outcome(pg_temp.emit('mark_recipient', 'e', 'a')), 'skipped:recipient_inactive', 'an inactive member is not notified');
select is(pg_temp.outcome(pg_temp.emit('account_suspended', 'e')), 'delivered', '… except by a notice that bypasses preferences');
select is(pg_temp.outcome(pg_temp.emit('mark_recipient', 'b', 'd')), 'skipped:blocked', 'a member of a blocked pair does not notify the other');
select is(pg_temp.outcome(pg_temp.emit('mark_recipient', '9', 'a')), 'skipped:recipient_missing', 'an event for a removed member is dropped');

-- ── Preferences ─────────────────────────────────────────────────────────────
select pg_temp.prefs('b', '{"critical": false}') \gset
select is(pg_temp.outcome(pg_temp.emit('mark_recipient', 'b', 'a')), 'skipped:preferences', 'a switched-off category is not delivered');
select is(pg_temp.outcome(pg_temp.emit('auto_removed', 'b')), 'delivered:push', 'a bypass kind is delivered and pushed all the same');
select is(pg_temp.outcome(pg_temp.emit('follow_approved', 'b', 'a')), 'delivered', 'the other category is unaffected');
select pg_temp.prefs('b', '{"social": false, "kinds": {"match_suggested": false, "mark_recipient": "no"}}') \gset
select is(pg_temp.outcome(pg_temp.emit('follow_approved', 'b', 'a')), 'skipped:preferences', 'the social switch stops social kinds');
select is(pg_temp.outcome(pg_temp.emit('match_suggested', 'b')), 'skipped:preferences', 'a single kind can be switched off');
select is(pg_temp.outcome(pg_temp.emit('mark_recipient', 'b', 'a')), 'delivered:push', 'a value that is not a boolean switches nothing off');

-- ── Channels and quiet hours ────────────────────────────────────────────────
select pg_temp.prefs('b', '{}') \gset
select is(pg_temp.outcome(pg_temp.emit('follow_approved', 'b', 'c')), 'delivered', 'a social kind is shown in the centre and not pushed');
select pg_temp.prefs('b', '{"quietHours": {"enabled": true, "start": "00:00", "end": "23:59:59.999"}}') \gset
select is(pg_temp.outcome(pg_temp.emit('giving_handoff_confirmed', 'b', 'a')), 'delivered', 'in quiet hours the notification is written but not pushed');
select is(pg_temp.outcome(pg_temp.emit('ride_booking_confirmed', 'b', 'a')), 'delivered:push', 'a time-critical kind is pushed in quiet hours');
select is(pg_temp.outcome(pg_temp.emit('account_suspended', 'b')), 'delivered:push', 'a bypass kind is pushed in quiet hours');
select is(kc_private.notification_in_quiet_hours('{"quietHours": {"enabled": true}}', '2026-01-10 23:30+02')
    and kc_private.notification_in_quiet_hours('{"quietHours": {"enabled": true}}', '2026-01-10 07:59+02')
    and not kc_private.notification_in_quiet_hours('{"quietHours": {"enabled": true}}', '2026-01-10 08:00+02'),
  true, 'the default window is 22:00–08:00 Israel time and crosses midnight');
select is(kc_private.notification_in_quiet_hours('{"quietHours": {"enabled": true, "start": "20:00", "end": "21:00", "timezone": "UTC"}}', '2026-01-10 20:30Z')
    and not kc_private.notification_in_quiet_hours('{"quietHours": {"start": "00:00", "end": "23:59"}}')
    and not kc_private.notification_in_quiet_hours('{"quietHours": {"enabled": true, "start": "soon", "timezone": "Mars"}}'),
  true, 'a stored window and zone are used; quiet hours are off unless enabled; unreadable values mean none');
select pg_temp.prefs('b', '{}') \gset

-- ── Grouping ────────────────────────────────────────────────────────────────
select is(pg_temp.emit('chat_message', 'c', 'a', '5') ->> 'group_count', '1', 'the first message of a chat starts a notification');
select is(pg_temp.emit('chat_message', 'c', 'a', '5') ->> 'group_count', '2', 'the next one inside the window merges into it');
select is(pg_temp.emit('chat_message', 'c', 'b', '5') ->> 'group_count', '3', 'also from another member');
select is((select count(*) || '|' || min(group_count) || '|' || (min(actor_ids::text) = array[pg_temp.id('b'), pg_temp.id('a')]::text)
            from public.notifications where user_id = pg_temp.id('c') and kind = 'chat_message'),
  '1|3|true', 'one row counts the events and lists the actors newest first');
select is(pg_temp.emit('chat_message', 'c', 'a', '6') ->> 'group_count', '1', 'another entity has its own notification');
update public.notifications set updated_at = now() - interval '2 hours'
 where user_id = pg_temp.id('c') and entity_id = pg_temp.id('5');
select is(pg_temp.emit('chat_message', 'c', 'a', '5') ->> 'group_count', '1', 'an event after the window starts a new notification');
select is(pg_temp.run('c', 'select public.notifications_mark_all_read()'), '4', 'the member reads everything');
select is(pg_temp.emit('chat_message', 'c', 'a', '5') ->> 'group_count', '1', 'an event after reading starts a new notification');
select is(pg_temp.emit('mark_recipient', 'c', 'a', '5') ->> 'group_count' || '/' || (pg_temp.emit('mark_recipient', 'c', 'a', '5') ->> 'group_count'),
  '1/1', 'a kind without a group window never merges');

-- ── The centre: read access and RPCs ────────────────────────────────────────
select is(pg_temp.run('b', 'select count(*) from public.notifications'), '9', 'a member reads their own notifications');
select is(pg_temp.run('a', 'select count(*) from public.notifications'), '0', 'and nobody else''s');
select is(pg_temp.run(null, 'select count(*) from public.notifications'), '42501', 'a signed-out caller cannot read notifications');
select is(pg_temp.run('b', 'update public.notifications set read_at = now()'), '42501', 'a notification is not writable from a device');
select is(pg_temp.run('b', $$insert into public.notifications (user_id, kind, category, title_key, body_key)
    values ('00000000-0000-4000-8000-00000000000b', 'x', 'social', 't', 'b')$$), '42501', 'nor insertable');
select is(pg_temp.run('b', 'select count(*) from kc_private.notifications_default'), '42501', 'partitions are not reachable from a device');
select is(pg_temp.run('b', 'select public.notifications_unread_count()'), '9', 'the badge counts unread notifications');
select is(pg_temp.run('b', $$select public.bootstrap_session() -> 'unread' ->> 'notifications'$$), '9', 'session start carries the badge');
select is(pg_temp.run('b', $$select count(*) || '|' || count(actor_display_name) || '|' || bool_and(category = 'social') from public.notifications_page(50, null, null, 'social')$$),
  '2|2|true', 'the page filters by category and carries the newest actor''s name');
select is(pg_temp.run('b', $$with first as (select * from public.notifications_page(4)),
    rest as (select * from public.notifications_page(50, (select min(created_at) from first),
                 (select id from first order by created_at, id limit 1)))
    select (select count(*) from first) || '+' || (select count(*) from rest) || '|'
        || not exists (select 1 from first f join rest r using (id))$$), '4+5|true', 'the keyset cursor walks the centre without repeats');
select is(pg_temp.run('a', format('select public.notifications_mark_read(%L::uuid[])', (select array_agg(id) from public.notifications))),
  '0', 'a member cannot mark another member''s notifications');
select is(pg_temp.run('b', 'select public.notifications_mark_read(array(select id from public.notifications limit 2))'), '2', 'a member marks listed notifications read');
select is(pg_temp.run('b', 'select public.notifications_mark_all_read()') || '/' || pg_temp.run('b', 'select public.notifications_unread_count()'),
  '7/0', 'and all the rest at once');
select is(pg_temp.run(null, 'select public.notifications_unread_count()'), '42501', 'a signed-out caller has no RPC');

-- ── Realtime badge ──────────────────────────────────────────────────────────
select is((select (count(*) > 2) || '|' || max((m.payload ->> 'unread_count')::integer) from realtime.messages m
            where m.topic = 'user:' || pg_temp.id('b') || ':notifications' and m.event = 'badge'),
  'true|9', 'each change of the centre broadcasts the unread count to the member''s own topic');
select is((select count(*) from realtime.messages m
            where m.topic = 'user:' || pg_temp.id('b') || ':notifications' and m.payload ->> 'unread_count' = '0'),
  1::bigint, 'marking seven notifications read sends one event');

-- ── Follow events (FR-NOTIF-006/007/008) ────────────────────────────────────
select is(pg_temp.run('c', $$select public.follow_user('00000000-0000-4000-8000-00000000000a')$$) || '/' || pg_temp.events('follow_started', 'a'),
  'following/1', 'following a public profile notifies the followed member');
update public.users set privacy_mode = 'Private' where id = pg_temp.id('a');
select is(pg_temp.run('b', $$select public.follow_user('00000000-0000-4000-8000-00000000000a')$$) || '/' || pg_temp.events('follow_request', 'a'),
  'requested/1', 'a follow request notifies its target');
select is(pg_temp.run('a', $$select public.follow_request_decide('00000000-0000-4000-8000-00000000000b', true)$$) || '/'
    || pg_temp.events('follow_approved', 'b') || '/' || pg_temp.events('follow_started', 'a'),
  'ok/1/1', 'accepting notifies the requester, and does not announce the new follower to the member who accepted');
select is((select string_agg(pg_temp.outcome(r), ',') from kc_private.notifications_deliver_batch() r), 'delivered,delivered,delivered',
  'the batch worker delivers the pending events');
delete from public.follows where follower_id = pg_temp.id('c');
update public.users set privacy_mode = 'Public' where id = pg_temp.id('a');
select is(pg_temp.run('c', $$select public.follow_user('00000000-0000-4000-8000-00000000000a')$$) is not null
    and (select string_agg(pg_temp.outcome(r), ',') from kc_private.notifications_deliver_batch() r) = 'skipped:duplicate',
  true, 'following again after an unfollow does not notify a second time');
do $$ begin perform kc_private.outbox_enqueue('notification', '{"kind":"nope","recipient_id":null}'); end $$;
select string_agg(pg_temp.outcome(r), ',') as failed_batch from kc_private.notifications_deliver_batch() r \gset
select is(:'failed_batch' || '|' || (select last_error from kc_private.outbox_events where payload ->> 'kind' = 'nope'),
  'failed:unknown_notification_kind|unknown_notification_kind', 'a failing event is reported and kept for a retry with its error');

-- ── Partitions and retention ────────────────────────────────────────────────
select is((select count(distinct tableoid::regclass::text) || '|' || min(tableoid::regclass::text) from public.notifications),
  '1|kc_private.notifications_y' || to_char(now(), 'YYYY"m"MM'), 'new rows go to the partition of their month');
insert into public.notifications (user_id, kind, category, title_key, body_key, created_at)
values (pg_temp.id('c'), 'mark_recipient', 'critical', 't', 'b', '2020-01-15');
insert into kc_private.notification_dedupe (user_id, dedupe_key, created_at) values (pg_temp.id('c'), 'old', '2020-01-15');
select is((select tableoid::regclass::text from public.notifications where created_at < '2021-01-01'),
  'kc_private.notifications_default', 'a row of a month without a partition waits in the default partition');
select lives_ok($$select kc_private.notifications_ensure_partition('2020-01-31')$$, 'the month''s partition is created');
select is((select tableoid::regclass::text from public.notifications where created_at < '2021-01-01'),
  'kc_private.notifications_y2020m01', '… and takes over the waiting row');
select kc_private.notifications_purge() as dropped \gset
select is(:dropped || '|' || (select count(*) from public.notifications where created_at < '2021-01-01')
    || '|' || (select count(*) from kc_private.notification_dedupe where dedupe_key = 'old')
    || '|' || (to_regclass('kc_private.notifications_y' || to_char(now(), 'YYYY"m"MM')) is not null),
  '1|0|0|true', 'retention drops the old partition and old dedupe keys and keeps the current month');

-- ── Account removal ─────────────────────────────────────────────────────────
delete from auth.users where id = pg_temp.id('b');
select is((select count(*) from public.notifications where user_id = pg_temp.id('b'))
    + (select count(*) from kc_private.notification_dedupe where user_id = pg_temp.id('b')),
  0::bigint, 'removing an account removes its notifications and dedupe keys');

-- Cross-module contract: every kind the engagement module emits is registered, otherwise
-- delivery would reject its events.
select is(
  (select count(*) from kc_private.notification_kinds
    where kind in ('post_reaction', 'post_comment', 'post_comment_reply', 'post_mention')),
  4::bigint, 'the engagement kinds emitted by the social module are registered');

select * from finish();
rollback;
