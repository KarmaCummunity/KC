-- Billing · refunds, payouts, KYC profiles, provider webhook events

insert into kc_private.fsm_state (machine_id, status) values
  ('refund', 'pending'), ('refund', 'succeeded'), ('refund', 'failed'),
  ('payout', 'pending'), ('payout', 'succeeded'), ('payout', 'failed'),
  ('kyc', 'pending'), ('kyc', 'approved'), ('kyc', 'rejected'),
  ('webhook_event', 'pending'), ('webhook_event', 'processed'), ('webhook_event', 'failed');
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  -- Only the provider's word settles a refund or a payout.
  ('refund', 'pending', 'succeeded', 'provider'),
  ('refund', 'pending', 'failed', 'provider'),
  ('payout', 'pending', 'succeeded', 'provider'),
  ('payout', 'pending', 'failed', 'provider'),
  -- The provider may revise its verdict at any time: a rejected party is checked again,
  -- an approved one is re-verified periodically.
  ('kyc', 'pending', 'approved', 'provider'),
  ('kyc', 'pending', 'rejected', 'provider'),
  ('kyc', 'rejected', 'pending', 'provider'),
  ('kyc', 'approved', 'pending', 'provider'),
  ('kyc', 'approved', 'rejected', 'provider'),
  ('kyc', 'rejected', 'approved', 'provider'),
  -- A failed event is applied again when the provider resends it.
  ('webhook_event', 'pending', 'processed', ''),
  ('webhook_event', 'pending', 'failed', ''),
  ('webhook_event', 'failed', 'processed', '');

-- Money returned to a donor. Opened by a platform admin, settled by a provider event.
create table billing.refunds (
  id              uuid primary key default gen_random_uuid(),
  payment_id      uuid not null references billing.payments (id) on delete restrict,
  amount_agorot   bigint not null check (amount_agorot > 0),
  -- Stable reason code; free text never enters the money tables.
  reason          text not null check (reason in ('donor_request', 'duplicate', 'fraud', 'error')),
  -- Lifecycle, machine `refund`.
  status          text not null default 'pending',
  provider_ref    text,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  opened_by       uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz,
  constraint refunds_settled_chk check ((status = 'pending') = (settled_at is null))
);
comment on table billing.refunds is 'Refunds of payments; the ledger is posted when the provider confirms.';
-- Refunds of a payment (remaining refundable amount); covers the payment foreign key.
create index refunds_payment_idx on billing.refunds (payment_id);
create index refunds_opened_by_idx on billing.refunds (opened_by) where opened_by is not null;

-- Money the provider transfers to an organization's bank account.
create table billing.payouts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete restrict,
  amount_agorot   bigint not null check (amount_agorot > 0),
  currency        text not null default 'ILS' check (currency = 'ILS'),
  -- Lifecycle, machine `payout`.
  status          text not null default 'pending',
  provider_ref    text,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  created_at      timestamptz not null default now(),
  settled_at      timestamptz,
  constraint payouts_settled_chk check ((status = 'pending') = (settled_at is null))
);
comment on table billing.payouts is 'Payouts to organizations; the ledger is posted when the provider confirms.';
-- Payouts of an organization, newest first (finance screen, open payouts in the balance check).
create index payouts_org_idx on billing.payouts (org_id, created_at desc);

-- "Know your customer" state of a payer (a member) or a recipient (an organization), as
-- reported by the provider. Only the state and the provider's reference: documents stay
-- with the provider. A payer's profile leaves with the account.
create table billing.kyc_profiles (
  id           uuid primary key default gen_random_uuid(),
  party_type   text not null check (party_type in ('payer', 'recipient')),
  user_id      uuid unique references public.users (id) on delete cascade,
  org_id       uuid unique references public.organizations (id) on delete cascade,
  -- State, machine `kyc`.
  status       text not null default 'pending',
  provider_ref text,
  verified_at  timestamptz,
  updated_at   timestamptz not null default now(),
  constraint kyc_profiles_party_chk check (
    case party_type when 'payer' then user_id is not null and org_id is null
                    else org_id is not null and user_id is null end)
);
comment on table billing.kyc_profiles is 'KYC state of payers and recipient organizations, as reported by the provider.';

-- Every event a provider sent, once: (provider, event id) is the idempotency key of the
-- whole webhook path.
create table billing.webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider_slug     text not null,
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 200),
  event_type        text,
  payload           jsonb not null check (jsonb_typeof(payload) = 'object'),
  -- Processing state, machine `webhook_event`.
  status            text not null default 'pending',
  processed_at      timestamptz,
  -- Stable error code of the last failed attempt.
  error_code        text,
  created_at        timestamptz not null default now(),
  unique (provider_slug, provider_event_id)
);
comment on table billing.webhook_events is 'Provider events, each stored and applied once.';
-- Operations: events that failed, oldest first.
create index webhook_events_failed_idx on billing.webhook_events (created_at) where status = 'failed';

create trigger refunds_status_fsm
  before insert or update of status on billing.refunds
  for each row execute function kc_private.fsm_guard_status('refund', 'status');
create trigger payouts_status_fsm
  before insert or update of status on billing.payouts
  for each row execute function kc_private.fsm_guard_status('payout', 'status');
create trigger kyc_profiles_status_fsm
  before insert or update of status on billing.kyc_profiles
  for each row execute function kc_private.fsm_guard_status('kyc', 'status');
create trigger kyc_profiles_set_updated_at
  before update on billing.kyc_profiles
  for each row execute function kc_private.set_updated_at();
create trigger webhook_events_status_fsm
  before insert or update of status on billing.webhook_events
  for each row execute function kc_private.fsm_guard_status('webhook_event', 'status');

alter table billing.refunds enable row level security;
alter table billing.refunds force row level security;
alter table billing.payouts enable row level security;
alter table billing.payouts force row level security;
alter table billing.kyc_profiles enable row level security;
alter table billing.kyc_profiles force row level security;
alter table billing.webhook_events enable row level security;
alter table billing.webhook_events force row level security;
revoke insert, update, delete, truncate
  on billing.refunds, billing.payouts, billing.kyc_profiles, billing.webhook_events from service_role;
