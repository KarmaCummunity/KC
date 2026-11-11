-- Billing · standing orders, donation intents, payments (D4, D20; spec 08 "Money and donations")
--
-- Money moves only from a member to an organization, never between members (D4).
--   standing order   the member's mandate for a recurring donation
--   donation intent  one wish to donate an amount: created by the member (or by the charger
--                    for a standing order), sent to the provider's checkout, then settled
--                    by a provider event
--   payment          what the provider actually did with an intent; created only from a
--                    provider event, together with its ledger lines

insert into kc_private.fsm_state (machine_id, status) values
  ('standing_order', 'pending'), ('standing_order', 'active'), ('standing_order', 'paused'),
  ('standing_order', 'cancelled'),
  ('donation_intent', 'created'), ('donation_intent', 'checkout'), ('donation_intent', 'succeeded'),
  ('donation_intent', 'failed'), ('donation_intent', 'cancelled'),
  ('payment', 'succeeded'), ('payment', 'failed'), ('payment', 'refunded');
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  -- A mandate is live once the provider confirmed it; the member pauses, resumes and cancels.
  ('standing_order', 'pending', 'active', 'provider'),
  ('standing_order', 'pending', 'cancelled', ''),
  ('standing_order', 'active', 'paused', ''),
  ('standing_order', 'paused', 'active', ''),
  ('standing_order', 'active', 'cancelled', ''),
  ('standing_order', 'paused', 'cancelled', ''),
  ('donation_intent', 'created', 'checkout', ''),
  ('donation_intent', 'created', 'cancelled', ''),
  ('donation_intent', 'checkout', 'cancelled', ''),
  ('donation_intent', 'checkout', 'succeeded', 'provider'),
  ('donation_intent', 'checkout', 'failed', 'provider'),
  -- The donor tried again on the same checkout page and the charge went through.
  ('donation_intent', 'failed', 'succeeded', 'provider'),
  -- Fully refunded; a partial refund keeps the payment `succeeded`.
  ('payment', 'succeeded', 'refunded', 'provider');

create table billing.standing_orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users (id) on delete set null,
  user_tombstone  bytea check (octet_length(user_tombstone) = 32),
  org_id          uuid not null references public.organizations (id) on delete restrict,
  amount_agorot   bigint not null check (amount_agorot > 0),
  currency        text not null default 'ILS' check (currency = 'ILS'),
  cadence         text not null default 'monthly' check (cadence in ('monthly', 'quarterly', 'yearly')),
  -- Lifecycle, machine `standing_order`.
  status          text not null default 'pending',
  provider_id     uuid not null references billing.payment_providers (id),
  -- The provider's reference of the mandate, once confirmed.
  provider_ref    text,
  method_id       uuid references billing.payment_methods (id) on delete set null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  -- When the next charge is opened; null unless the order is active.
  next_charge_at  timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint standing_orders_party_chk check (num_nonnulls(user_id, user_tombstone) = 1),
  constraint standing_orders_next_charge_chk check ((status = 'active') = (next_charge_at is not null))
);
comment on table billing.standing_orders is 'Recurring donation mandates of members to organizations.';

-- "My standing orders", newest first; covers the member foreign key.
create index standing_orders_user_idx on billing.standing_orders (user_id, created_at desc) where user_id is not null;
-- Charger: active orders that are due, oldest first.
create index standing_orders_due_idx on billing.standing_orders (next_charge_at) where status = 'active';
-- Foreign keys.
create index standing_orders_org_idx on billing.standing_orders (org_id);
create index standing_orders_provider_idx on billing.standing_orders (provider_id);
create index standing_orders_method_idx on billing.standing_orders (method_id) where method_id is not null;

create table billing.donation_intents (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references public.users (id) on delete set null,
  user_tombstone    bytea check (octet_length(user_tombstone) = 32),
  org_id            uuid not null references public.organizations (id) on delete restrict,
  -- The campaign post the donation was made on, if any.
  post_id           uuid references public.posts (id) on delete set null,
  -- Set when the intent is one charge of a standing order.
  standing_order_id uuid references billing.standing_orders (id) on delete restrict,
  amount_agorot     bigint not null check (amount_agorot > 0),
  currency          text not null default 'ILS' check (currency = 'ILS'),
  -- Lifecycle, machine `donation_intent`.
  status            text not null default 'created',
  provider_id       uuid not null references billing.payment_providers (id),
  -- The provider's checkout session: its reference and the page the donor is sent to.
  provider_ref      text,
  checkout_url      text check (checkout_url ~* '^https://'),
  idempotency_key   text not null unique check (char_length(idempotency_key) between 8 and 200),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint donation_intents_party_chk check (num_nonnulls(user_id, user_tombstone) = 1)
);
comment on table billing.donation_intents is 'One wish to donate an amount to an organization, from creation to settlement.';

-- A member's intents, newest first; covers the member foreign key.
create index donation_intents_user_idx on billing.donation_intents (user_id, created_at desc) where user_id is not null;
-- Money raised by a campaign post.
create index donation_intents_post_idx on billing.donation_intents (post_id) where post_id is not null;
-- Charges of a standing order (history, failed-charge handling).
create index donation_intents_standing_order_idx on billing.donation_intents (standing_order_id, created_at desc)
  where standing_order_id is not null;
-- Foreign keys.
create index donation_intents_org_idx on billing.donation_intents (org_id);
create index donation_intents_provider_idx on billing.donation_intents (provider_id);

create table billing.payments (
  id              uuid primary key default gen_random_uuid(),
  intent_id       uuid not null references billing.donation_intents (id) on delete restrict,
  user_id         uuid references public.users (id) on delete set null,
  user_tombstone  bytea check (octet_length(user_tombstone) = 32),
  org_id          uuid not null references public.organizations (id) on delete restrict,
  amount_agorot   bigint not null check (amount_agorot > 0),
  currency        text not null default 'ILS' check (currency = 'ILS'),
  -- Outcome, machine `payment`.
  status          text not null,
  -- Sum of the settled refunds of this payment.
  refunded_agorot bigint not null default 0 check (refunded_agorot >= 0),
  provider_id     uuid not null references billing.payment_providers (id),
  provider_ref    text,
  method_id       uuid references billing.payment_methods (id) on delete set null,
  -- The provider event that reported the payment.
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  created_at      timestamptz not null default now(),
  constraint payments_party_chk check (num_nonnulls(user_id, user_tombstone) = 1),
  constraint payments_refunded_chk check (
    refunded_agorot <= amount_agorot and (status = 'refunded') = (refunded_agorot = amount_agorot))
);
comment on table billing.payments is 'Payments reported by the provider; written only together with their ledger lines.';

-- An intent is paid once.
create unique index payments_one_settled_per_intent_key on billing.payments (intent_id)
  where status in ('succeeded', 'refunded');
-- Failed attempts of an intent; covers the intent foreign key.
create index payments_intent_idx on billing.payments (intent_id);
-- "My donations", newest first (keyset on created_at, id); covers the member foreign key.
create index payments_user_idx on billing.payments (user_id, created_at desc, id desc) where user_id is not null;
-- Money raised by an organization; covers the organization foreign key.
create index payments_org_idx on billing.payments (org_id, created_at desc) where status = 'succeeded';
-- A provider reference names one payment (refund and dispute lookups).
create unique index payments_provider_ref_key on billing.payments (provider_id, provider_ref)
  where provider_ref is not null;
create index payments_method_idx on billing.payments (method_id) where method_id is not null;

create trigger standing_orders_status_fsm
  before insert or update of status on billing.standing_orders
  for each row execute function kc_private.fsm_guard_status('standing_order', 'status');
create trigger standing_orders_set_updated_at
  before update on billing.standing_orders
  for each row execute function kc_private.set_updated_at();
create trigger donation_intents_status_fsm
  before insert or update of status on billing.donation_intents
  for each row execute function kc_private.fsm_guard_status('donation_intent', 'status');
create trigger donation_intents_set_updated_at
  before update on billing.donation_intents
  for each row execute function kc_private.set_updated_at();
create trigger payments_status_fsm
  before insert or update of status on billing.payments
  for each row execute function kc_private.fsm_guard_status('payment', 'status');

alter table billing.standing_orders enable row level security;
alter table billing.standing_orders force row level security;
alter table billing.donation_intents enable row level security;
alter table billing.donation_intents force row level security;
alter table billing.payments enable row level security;
alter table billing.payments force row level security;
-- The service role reads; it writes only through the functions of this module.
revoke insert, update, delete, truncate on billing.standing_orders, billing.donation_intents, billing.payments
  from service_role;
