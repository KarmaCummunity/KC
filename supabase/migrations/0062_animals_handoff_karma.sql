-- Karma · a completed handoff in the animals world pays like an item
--
-- An adoption or foster offer takes the generic item handoff (kc_private.handoff_flow_of), and
-- the karma consumer pays a completed handoff by its world (`context` = `world_slug`). The
-- baseline seeded no `animals` values, so such a handoff was performed but paid nothing.
-- PM decision (docs/spec/07_cross_cutting_systems.md §7.6, D164): the
-- giver earns 20 and the receiver 15, as for an item, without the item value bonus.
-- Idempotent: a re-run leaves the configured values as they are.
insert into kc_private.karma_values (event_type, context, points, unit, max_units, daily_cap) values
  ('handoff_giver', 'animals', 20, 'once', 1, null),
  ('handoff_receiver', 'animals', 15, 'once', 1, null)
on conflict do nothing;
