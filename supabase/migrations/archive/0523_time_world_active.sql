-- 0523_time_world_active | FR-FEED-020 AC2 / AC3 · backlog FEED-WORLDS (3) · D60
--
-- The time world now has its own world screen: request / offer, search, the members' feed of
-- time offers and requests, the organisations' volunteering opportunities and the shifts /
-- organizer screens. Launch flags pick active vs portal (D60), so the world becomes active,
-- as rides did when its flow shipped (0511 §7).
--
-- Housing stays a portal: publishing there needs a verified identity, and the create form does
-- not yet say so before the member fills it in (TD-245). Its flag flips with that fix.

begin;

update public.app_flags
   set enabled = true
 where key = 'world_time_enabled';

commit;
