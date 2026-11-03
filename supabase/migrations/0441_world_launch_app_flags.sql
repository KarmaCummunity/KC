-- 0441: remote launch wedge flags per marketplace world (#1041).
-- Flip without release: update public.app_flags set enabled = true where key = 'world_rides_enabled';

insert into public.app_flags (key, enabled, description)
values
  ('world_items_enabled', true, 'Launch wedge: items world visible in app navigation.'),
  ('world_food_enabled', true, 'Launch wedge: food world visible in app navigation.'),
  ('world_money_enabled', false, 'Launch wedge: money donations hub hidden until enabled.'),
  ('world_time_enabled', false, 'Launch wedge: time/volunteering hub hidden until enabled.'),
  ('world_rides_enabled', false, 'Launch wedge: rides/transport hub hidden until enabled.'),
  ('world_knowledge_enabled', false, 'Launch wedge: knowledge hub hidden until enabled.'),
  ('world_housing_enabled', false, 'Launch wedge: housing category hidden until enabled.'),
  ('world_medical_enabled', false, 'Launch wedge: medical category hidden until enabled.'),
  ('world_animals_enabled', false, 'Launch wedge: animals category hidden until enabled.'),
  ('world_environment_enabled', false, 'Launch wedge: environment listings hidden until enabled.'),
  ('world_creative_enabled', false, 'Launch wedge: creative listings hidden until enabled.'),
  ('world_app_design_enabled', false, 'Launch wedge: app_design listings hidden until enabled.')
on conflict (key) do nothing;
