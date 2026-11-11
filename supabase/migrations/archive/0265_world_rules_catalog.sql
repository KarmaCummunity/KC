-- 0265_world_rules_catalog | Issue #849 (part 1)
-- PRD V2 rule registry (R-Food, R-Items, R-Rides, R-Med, …).

begin;

create table public.marketplace_rules (
  rule_code   text primary key,
  world_slug  text references public.worlds(slug) on delete cascade,
  label_en    text not null,
  is_active   boolean not null default true
);

create table public.marketplace_rule_params (
  rule_code   text not null references public.marketplace_rules(rule_code) on delete cascade,
  param_key   text not null,
  param_value jsonb not null,
  primary key (rule_code, param_key)
);

insert into public.marketplace_rules (rule_code, world_slug, label_en) values
  ('R-Food-1', 'food', 'Food listing requires expiry'),
  ('R-Food-2', 'food', 'Food expiry auto-block'),
  ('R-Food-7', 'food', 'Food posting ban flag'),
  ('R-Items-1', 'items', 'Items listing requires image reference'),
  ('R-Items-5', 'items', 'Items 30-day TTL cap'),
  ('R-Rides-1', 'rides', 'Ride cost-share cap offer'),
  ('R-Rides-2', 'rides', 'Ride cost-share cap request'),
  ('R-Med-6', 'medical', 'Medical routes via external body'),
  ('R-Animals-1', 'animals', 'Animals routes via external body'),
  ('R-Env-1', 'environment', 'Environment routes via external body'),
  ('R-Knowledge-1', 'knowledge', 'Knowledge pending approval'),
  ('R-Money-3', 'money', 'Max 5 active money campaigns per owner'),
  ('R-Match-6', 'romantic_matchmaking', 'Matchmaking 18+ only')
on conflict (rule_code) do nothing;

insert into public.marketplace_rule_params (rule_code, param_key, param_value) values
  ('R-Items-5', 'ttl_days', '30'),
  ('R-Rides-1', 'max_cost_share_ils', '70'),
  ('R-Rides-2', 'max_cost_share_ils', '20'),
  ('R-Money-3', 'max_active', '5'),
  ('R-Match-6', 'min_age_years', '18')
on conflict do nothing;

alter table public.users
  add column if not exists food_posting_banned_until timestamptz;

alter table public.marketplace_rules enable row level security;
alter table public.marketplace_rule_params enable row level security;

create policy marketplace_rules_read on public.marketplace_rules
  for select to authenticated using (true);

create policy marketplace_rule_params_read on public.marketplace_rule_params
  for select to authenticated using (true);

commit;
