-- Notifications · registry of notification kinds
--
-- Modules do not send notifications: they record an outbox event on topic `notification`
-- naming a kind, and this registry says what that kind is. The rows are vocabulary, like
-- the edges of a state machine: one per kind the product can emit. A later module adds the
-- rows of its own kinds next to the code that emits them.
--
-- Event payload (kc_private.outbox_enqueue('notification', …)):
--   { "kind": "<kind>", "recipient_id": "<uuid>", "actor_id": "<uuid|null>",
--     "entity": { "type": "<text>", "id": "<uuid>" },
--     "data": { …, "dedupe_key": "<text, optional>" } }
-- `data.dedupe_key`: a recipient gets at most one notification per key (FR-NOTIF-018 AC5).
-- `data` is stored on the notification as the arguments of its text, without the key.

create table kc_private.notification_kinds (
  kind               text primary key check (kind ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- The two groups a member can switch off as a whole (FR-NOTIF-014, D5). `critical` is
  -- the group the project book calls "important" (spec 07 §7.11).
  category           text not null check (category in ('critical', 'social')),
  -- Whether the kind is on for a member who never touched its own switch (FR-NOTIF-017).
  default_enabled    boolean not null default true,
  -- Account and safety notices: delivered whatever the member switched off, also to a
  -- member whose account is not active and across a block.
  bypass_preferences boolean not null default false,
  -- Time-critical kinds are pushed during the member's quiet hours as well (D95).
  bypass_quiet_hours boolean not null default false,
  -- False = shown in the notification centre only, never pushed (S10: social).
  sends_push         boolean not null default true,
  -- Events of this kind about the same entity merge into one unread notification while
  -- they arrive within this time of each other ("X and 3 others"); null = never merged.
  group_window       interval check (group_window > interval '0'),
  -- Keys of the texts in the app's locale files; the database stores no wording.
  title_key          text not null,
  body_key           text not null
);
comment on table kc_private.notification_kinds is
  'Vocabulary of notification kinds: category, preference rules, channels, grouping, text keys.';

alter table kc_private.notification_kinds enable row level security;
alter table kc_private.notification_kinds force row level security;

-- Messaging, follows, the recipient mark and the kinds of spec requirements/09 that no
-- module emits yet (post_expiring, message_undeliverable, auto_removed, account_suspended,
-- match_suggested).
insert into kc_private.notification_kinds
  (kind, category, bypass_preferences, sends_push, group_window, title_key, body_key)
values
  -- FR-NOTIF-001/002: messages of one chat merge while unread (S10: per entity per hour).
  ('chat_message', 'critical', false, true, interval '1 hour', 'notifications.chatTitle', 'notifications.chatBody'),
  ('support_message', 'critical', false, true, interval '1 hour', 'notifications.supportTitle', 'notifications.chatBody'),
  -- FR-NOTIF-003.
  ('system_message', 'critical', false, true, null, 'notifications.systemTitle', 'notifications.systemBody'),
  -- FR-NOTIF-004.
  ('message_undeliverable', 'critical', false, true, null,
   'notifications.messageUndeliverableTitle', 'notifications.messageUndeliverableBody'),
  -- FR-NOTIF-005.
  ('post_expiring', 'critical', false, true, null, 'notifications.postExpiringTitle', 'notifications.postExpiringBody'),
  -- FR-NOTIF-006/007/008. New followers merge within the hour (FR-NOTIF-007 AC3).
  ('follow_request', 'social', false, false, null, 'notifications.followRequestTitle', 'notifications.followRequestBody'),
  ('follow_started', 'social', false, false, interval '1 hour', 'notifications.followStartedTitle', 'notifications.followStartedBody'),
  ('follow_approved', 'social', false, false, null, 'notifications.followApprovedTitle', 'notifications.followApprovedBody'),
  -- FR-NOTIF-009/010.
  ('mark_recipient', 'critical', false, true, null, 'notifications.markRecipientTitle', 'notifications.markRecipientBody'),
  ('unmark_recipient', 'critical', false, true, null, 'notifications.unmarkRecipientTitle', 'notifications.unmarkRecipientBody'),
  -- FR-NOTIF-011 and the suspension notice: the member has a right to know.
  ('auto_removed', 'critical', true, true, null, 'notifications.autoRemovedTitle', 'notifications.autoRemovedBody'),
  ('account_suspended', 'critical', true, true, null, 'notifications.accountSuspendedTitle', 'notifications.accountSuspendedBody'),
  -- FR-NOTIF-017.
  ('match_suggested', 'critical', false, true, null, 'notifications.matchSuggestedTitle', 'notifications.matchSuggestedBody');

-- Handoff changes (FR-NOTIF-018, D73, D131, D138): one kind per machine and change, named
-- `<machine>_<change>` by kc_private.handoff_notification_kind. All are critical; ride
-- bookings are also pushed during quiet hours (D95). Text keys are the kind in camelCase.
insert into kc_private.notification_kinds (kind, category, bypass_quiet_hours, title_key, body_key)
select k.kind, 'critical', m.machine = 'ride_booking',
       'notifications.' || k.camel || 'Title', 'notifications.' || k.camel || 'Body'
  from unnest(array['giving_handoff', 'ride_booking', 'housing_booking', 'event_registration']) as m (machine)
 cross join unnest(array[
         'requested', 'claimed', 'confirmed', 'declined', 'cancelled', 'expired', 'completed',
         'no_show', 'waitlist_promoted', 'reinstated']) as c (change)
 cross join lateral (
   select m.machine || '_' || c.change as kind,
          split_part(m.machine, '_', 1)
            || replace(initcap(replace(split_part(m.machine, '_', 2) || '_' || c.change, '_', ' ')), ' ', '')
            as camel) k;
