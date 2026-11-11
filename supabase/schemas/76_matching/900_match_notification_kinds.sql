-- Matching · notification kinds emitted by this module
--
-- `match_suggested` (a new pair, kc_private.match_announce) is registered with the
-- registry itself (50_notifications/010). These are the two kinds of an answer
-- (public.match_respond): the other owner is interested, and both owners accepted. Both
-- are "important" like the suggestion itself (docs/SSOT/MATCHING_V2.md "Client").

insert into kc_private.notification_kinds (kind, category, title_key, body_key)
values
  ('match_interest', 'critical', 'notifications.matchInterestTitle', 'notifications.matchInterestBody'),
  ('match_accepted', 'critical', 'notifications.matchAcceptedTitle', 'notifications.matchAcceptedBody');
