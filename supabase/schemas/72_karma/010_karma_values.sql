-- Karma · point values (spec 07 §7.6, D12, D29)
--
-- Every number of the karma system is configuration, not code: one row per rewarded event,
-- optionally per context (a giving world, a post type, a challenge scope). The consumer of
-- outbox topic `karma` (030_karma_consumer.sql) looks the value up when it performs an
-- event, so a value is tuned by changing a row. An event with no row earns nothing.

create table kc_private.karma_values (
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  -- What the value depends on; '' = the same value everywhere.
  --   handoff_*            post type for rides, stays and events, else the giving world
  --   challenge_*          personal | community | community_large (50+ participants)
  context    text not null default '',
  -- Points per unit. Negative values are penalties.
  points     integer not null check (points <> 0),
  -- What one unit is. `once` pays the points one time; the others multiply them by a
  -- quantity the emitter measured: nights of a stay, started half hours of a session,
  -- started 50 ILS of an item's estimated value (FR-KARMA-003), full 10 ILS of a donation.
  unit       text not null default 'once'
               check (unit in ('once', 'night', 'half_hour', 'value_50_ils', 'ils_10')),
  -- Cap on the quantity of one award ("7 nights", "up to 20 bonus points").
  max_units  integer not null default 1 check (max_units >= 1),
  -- At most this many awards of the event type per member per Israel calendar day.
  daily_cap  integer check (daily_cap > 0),
  updated_at timestamptz not null default now(),
  primary key (event_type, context),
  constraint karma_values_units_chk check (unit <> 'once' or max_units = 1)
);
comment on table kc_private.karma_values is
  'Configuration of karma: points per rewarded event and context, unit, caps. Changed by server code only.';

create trigger karma_values_set_updated_at
  before update on kc_private.karma_values
  for each row execute function kc_private.set_updated_at();

alter table kc_private.karma_values enable row level security;
alter table kc_private.karma_values force row level security;

-- Values of the events this baseline emits, as approved in spec 07 §7.6. Like the edges of
-- a state machine these rows are vocabulary: without them the consumer has nothing to pay.
insert into kc_private.karma_values (event_type, context, points, unit, max_units, daily_cap) values
  -- A completed handoff: the member who gave and the member who received.
  ('handoff_giver', 'items', 20, 'once', 1, null),
  ('handoff_receiver', 'items', 15, 'once', 1, null),
  ('item_value_bonus', 'items', 1, 'value_50_ils', 20, null),
  ('handoff_giver', 'food', 20, 'once', 1, null),
  ('handoff_receiver', 'food', 10, 'once', 1, null),
  ('handoff_giver', 'ride', 25, 'once', 1, null),
  ('handoff_receiver', 'ride', 10, 'once', 1, null),
  ('handoff_giver', 'housing_stay', 30, 'night', 7, null),
  ('handoff_receiver', 'housing_stay', 10, 'once', 1, null),
  -- Attending an event; organizing one earns nothing by itself.
  ('handoff_receiver', 'event', 10, 'once', 1, null),
  -- A knowledge session: 10 an hour for the giver, at most 8 hours (D32, S72).
  ('handoff_giver', 'knowledge', 5, 'half_hour', 16, null),
  ('handoff_receiver', 'knowledge', 5, 'once', 1, null),
  ('rating_given', '', 2, 'once', 1, null),
  -- Challenges (D52). The daily cap of an event type is counted across its contexts.
  ('challenge_opened', 'personal', 2, 'once', 1, 2),
  ('challenge_opened', 'community', 3, 'once', 1, 2),
  ('challenge_report', 'personal', 1, 'once', 1, null),
  ('challenge_report', 'community', 2, 'once', 1, null),
  ('challenge_report', 'community_large', 3, 'once', 1, null),
  ('challenge_completed', 'personal', 10, 'once', 1, null),
  ('challenge_completed', 'community', 15, 'once', 1, null),
  ('challenge_completed', 'community_large', 20, 'once', 1, null),
  -- Donations to the community: 1 point per full 10 ILS, at most 100 per donation, and 10
  -- per month of a standing order. Emitted by the billing module as `award` events:
  --   { kind: award, event_type: donation, user_id, subject: 'donation:<payment id>',
  --     quantity: { ils_10: <amount in agorot / 1000, rounded down> } }
  --   { kind: award, event_type: standing_order_month, user_id,
  --     subject: 'standing_order:<id>:<YYYY-MM>' }
  -- and, for a refund, { kind: revoke, user_id, subject_prefix: 'donation:<payment id>' }.
  ('donation', '', 1, 'ils_10', 100, null),
  ('standing_order_month', '', 10, 'once', 1, null);

-- The value of an event in a context: the row of that context, else the row of every
-- context; no row = the event is not rewarded.
create function kc_private.karma_value(p_event_type text, p_context text)
returns kc_private.karma_values
language sql
stable
security definer
set search_path = ''
as $$
  select v.*
    from kc_private.karma_values v
   where v.event_type = p_event_type and v.context in (coalesce(p_context, ''), '')
   order by (v.context <> '') desc
   limit 1;
$$;
comment on function kc_private.karma_value(text, text) is
  'Configured value of a karma event in a context, falling back to the context-free row.';
