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
-- The rows are written out, like every row of this registry: the generator of the kind
-- list shared with the app and the push worker (scripts/generate-notification-kinds.mjs)
-- reads literal `values` rows only, so the list can be checked without a database.
insert into kc_private.notification_kinds (kind, category, bypass_quiet_hours, title_key, body_key)
values
  ('giving_handoff_requested', 'critical', false, 'notifications.givingHandoffRequestedTitle', 'notifications.givingHandoffRequestedBody'),
  ('giving_handoff_claimed', 'critical', false, 'notifications.givingHandoffClaimedTitle', 'notifications.givingHandoffClaimedBody'),
  ('giving_handoff_confirmed', 'critical', false, 'notifications.givingHandoffConfirmedTitle', 'notifications.givingHandoffConfirmedBody'),
  ('giving_handoff_declined', 'critical', false, 'notifications.givingHandoffDeclinedTitle', 'notifications.givingHandoffDeclinedBody'),
  ('giving_handoff_cancelled', 'critical', false, 'notifications.givingHandoffCancelledTitle', 'notifications.givingHandoffCancelledBody'),
  ('giving_handoff_expired', 'critical', false, 'notifications.givingHandoffExpiredTitle', 'notifications.givingHandoffExpiredBody'),
  ('giving_handoff_completed', 'critical', false, 'notifications.givingHandoffCompletedTitle', 'notifications.givingHandoffCompletedBody'),
  ('giving_handoff_no_show', 'critical', false, 'notifications.givingHandoffNoShowTitle', 'notifications.givingHandoffNoShowBody'),
  ('giving_handoff_waitlist_promoted', 'critical', false, 'notifications.givingHandoffWaitlistPromotedTitle', 'notifications.givingHandoffWaitlistPromotedBody'),
  ('giving_handoff_reinstated', 'critical', false, 'notifications.givingHandoffReinstatedTitle', 'notifications.givingHandoffReinstatedBody'),
  ('ride_booking_requested', 'critical', true, 'notifications.rideBookingRequestedTitle', 'notifications.rideBookingRequestedBody'),
  ('ride_booking_claimed', 'critical', true, 'notifications.rideBookingClaimedTitle', 'notifications.rideBookingClaimedBody'),
  ('ride_booking_confirmed', 'critical', true, 'notifications.rideBookingConfirmedTitle', 'notifications.rideBookingConfirmedBody'),
  ('ride_booking_declined', 'critical', true, 'notifications.rideBookingDeclinedTitle', 'notifications.rideBookingDeclinedBody'),
  ('ride_booking_cancelled', 'critical', true, 'notifications.rideBookingCancelledTitle', 'notifications.rideBookingCancelledBody'),
  ('ride_booking_expired', 'critical', true, 'notifications.rideBookingExpiredTitle', 'notifications.rideBookingExpiredBody'),
  ('ride_booking_lapsed', 'critical', true, 'notifications.rideBookingLapsedTitle', 'notifications.rideBookingLapsedBody'),
  ('ride_booking_completed', 'critical', true, 'notifications.rideBookingCompletedTitle', 'notifications.rideBookingCompletedBody'),
  ('ride_booking_no_show', 'critical', true, 'notifications.rideBookingNoShowTitle', 'notifications.rideBookingNoShowBody'),
  ('ride_booking_waitlist_promoted', 'critical', true, 'notifications.rideBookingWaitlistPromotedTitle', 'notifications.rideBookingWaitlistPromotedBody'),
  ('ride_booking_reinstated', 'critical', true, 'notifications.rideBookingReinstatedTitle', 'notifications.rideBookingReinstatedBody'),
  ('housing_booking_requested', 'critical', false, 'notifications.housingBookingRequestedTitle', 'notifications.housingBookingRequestedBody'),
  ('housing_booking_claimed', 'critical', false, 'notifications.housingBookingClaimedTitle', 'notifications.housingBookingClaimedBody'),
  ('housing_booking_confirmed', 'critical', false, 'notifications.housingBookingConfirmedTitle', 'notifications.housingBookingConfirmedBody'),
  ('housing_booking_declined', 'critical', false, 'notifications.housingBookingDeclinedTitle', 'notifications.housingBookingDeclinedBody'),
  ('housing_booking_cancelled', 'critical', false, 'notifications.housingBookingCancelledTitle', 'notifications.housingBookingCancelledBody'),
  ('housing_booking_expired', 'critical', false, 'notifications.housingBookingExpiredTitle', 'notifications.housingBookingExpiredBody'),
  ('housing_booking_completed', 'critical', false, 'notifications.housingBookingCompletedTitle', 'notifications.housingBookingCompletedBody'),
  ('housing_booking_no_show', 'critical', false, 'notifications.housingBookingNoShowTitle', 'notifications.housingBookingNoShowBody'),
  ('housing_booking_waitlist_promoted', 'critical', false, 'notifications.housingBookingWaitlistPromotedTitle', 'notifications.housingBookingWaitlistPromotedBody'),
  ('housing_booking_reinstated', 'critical', false, 'notifications.housingBookingReinstatedTitle', 'notifications.housingBookingReinstatedBody'),
  ('event_registration_requested', 'critical', false, 'notifications.eventRegistrationRequestedTitle', 'notifications.eventRegistrationRequestedBody'),
  ('event_registration_claimed', 'critical', false, 'notifications.eventRegistrationClaimedTitle', 'notifications.eventRegistrationClaimedBody'),
  ('event_registration_confirmed', 'critical', false, 'notifications.eventRegistrationConfirmedTitle', 'notifications.eventRegistrationConfirmedBody'),
  ('event_registration_declined', 'critical', false, 'notifications.eventRegistrationDeclinedTitle', 'notifications.eventRegistrationDeclinedBody'),
  ('event_registration_cancelled', 'critical', false, 'notifications.eventRegistrationCancelledTitle', 'notifications.eventRegistrationCancelledBody'),
  ('event_registration_expired', 'critical', false, 'notifications.eventRegistrationExpiredTitle', 'notifications.eventRegistrationExpiredBody'),
  ('event_registration_completed', 'critical', false, 'notifications.eventRegistrationCompletedTitle', 'notifications.eventRegistrationCompletedBody'),
  ('event_registration_no_show', 'critical', false, 'notifications.eventRegistrationNoShowTitle', 'notifications.eventRegistrationNoShowBody'),
  ('event_registration_waitlist_promoted', 'critical', false, 'notifications.eventRegistrationWaitlistPromotedTitle', 'notifications.eventRegistrationWaitlistPromotedBody'),
  ('event_registration_reinstated', 'critical', false, 'notifications.eventRegistrationReinstatedTitle', 'notifications.eventRegistrationReinstatedBody');

-- Engagement on a post (emitted by 30_social; spec 07 §7.9, §7.11). Social kinds are shown
-- in the notification centre only; events about one post merge within the hour (S10).
insert into kc_private.notification_kinds
  (kind, category, sends_push, group_window, title_key, body_key)
values
  ('post_reaction', 'social', false, interval '1 hour', 'notifications.postReactionTitle', 'notifications.postReactionBody'),
  ('post_comment', 'social', false, interval '1 hour', 'notifications.postCommentTitle', 'notifications.postCommentBody'),
  ('post_comment_reply', 'social', false, interval '1 hour', 'notifications.postCommentReplyTitle', 'notifications.postCommentReplyBody'),
  ('post_mention', 'social', false, interval '1 hour', 'notifications.postMentionTitle', 'notifications.postMentionBody');
