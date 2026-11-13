-- Billing · settings, payment providers, payment methods
--
-- Everything about money lives in the schema `billing`, which the API does not expose: a
-- device reaches it only through the `public` RPCs of this module, each of which checks
-- the caller and returns the caller's own data; provider webhooks and jobs reach it through
-- service-role functions (design §2.1, §3.8). No client role holds any privilege here, and
-- the service role only reads: every write goes through a function, so a money move and
-- its ledger lines are always one transaction.
--
-- Conventions of the module:
--   amounts      integer agorot (`bigint`) with a currency code; shekels only for now (D78)
--   statuses     one vocabulary on the FSM kernel: a completed money move is `succeeded`,
--                a withdrawn one `cancelled` (state-machines §7 Q4)
--   idempotency  every table that a retried request or webhook can write has its own
--                unique idempotency key
--   members      a money row names its member as `user_id`, or — after the account was
--                purged — as `user_tombstone`, the salted hash of audit.deletion_tombstones
--                (design §4.1.4). The rows themselves are never removed with the account.
--   service RPCs `public.api_*` and `public.provider_webhook_apply` are executable by the
--                service role only (no grant to a client role).

-- One row of module-wide settings.
create table billing.settings (
  singleton boolean primary key default true check (singleton),
  -- How long money records of a purged account are kept before they may be erased.
  -- Null = indefinitely: the period is an open legal question (design §12 Q5), and
  -- nothing is purged automatically until it is answered.
  retention_after_account_deletion interval check (retention_after_account_deletion > interval '0'),
  -- Smallest donation, in agorot (5 shekels).
  min_donation_agorot bigint not null default 500 check (min_donation_agorot > 0),
  updated_at timestamptz not null default now()
);
comment on table billing.settings is 'Module-wide billing settings; exactly one row.';
alter table billing.settings enable row level security;
alter table billing.settings force row level security;
-- Operations change a setting; the row itself is permanent.
revoke insert, delete, truncate on billing.settings from service_role;
-- The row is structure, not data: the functions of the module read it.
insert into billing.settings default values;

create trigger settings_set_updated_at
  before update on billing.settings
  for each row execute function kc_private.set_updated_at();

-- Payment providers the product can clear through. Swappable without code (D20): the
-- default active provider takes new donations. Rows are configuration, loaded per environment.
create table billing.payment_providers (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z][a-z0-9_]{1,30}$'),
  display_name  text not null check (char_length(display_name) between 1 and 80),
  is_active     boolean not null default true,
  is_default    boolean not null default false,
  -- Settings the app may see (hosted-fields flags and the like). Never a credential:
  -- provider secrets belong to the Edge Functions' environment.
  config_public jsonb not null default '{}'::jsonb check (jsonb_typeof(config_public) = 'object'),
  created_at    timestamptz not null default now(),
  constraint payment_providers_default_active_chk check (is_active or not is_default)
);
comment on table billing.payment_providers is 'Payment providers; the default active one receives new donations.';
create unique index payment_providers_single_default_key on billing.payment_providers (is_default) where is_default;
alter table billing.payment_providers enable row level security;
alter table billing.payment_providers force row level security;

-- A member's saved way to pay, as the provider's token. Card data is never stored: at most
-- the last four digits and the brand the provider reports for display.
create table billing.payment_methods (
  id             uuid primary key default gen_random_uuid(),
  -- A token is the member's own and leaves with the account.
  user_id        uuid not null references public.users (id) on delete cascade,
  provider_id    uuid not null references billing.payment_providers (id),
  provider_token text not null check (char_length(provider_token) between 1 and 500),
  last4          text check (last4 ~ '^[0-9]{4}$'),
  brand          text check (char_length(brand) <= 30),
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (provider_id, provider_token)
);
comment on table billing.payment_methods is 'Provider tokens of a member''s saved payment methods. No card data.';
-- A member's methods; one default per member.
create index payment_methods_user_idx on billing.payment_methods (user_id);
create unique index payment_methods_single_default_key on billing.payment_methods (user_id) where is_default;
alter table billing.payment_methods enable row level security;
alter table billing.payment_methods force row level security;
revoke insert, update, delete, truncate on billing.payment_methods from service_role;

-- The provider that takes a new donation; raises when clearing is not available.
create function kc_private.billing_default_provider()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select p.id into v_id from billing.payment_providers p where p.is_default and p.is_active;
  if not found then
    raise exception 'payments_unavailable' using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;
comment on function kc_private.billing_default_provider() is
  'The default active payment provider; raises payments_unavailable when there is none.';

-- Stores the token of a payment method the provider created for a member at a hosted
-- checkout and returns its id; repeating the call returns the same row. A member's first
-- method becomes their default.
create function public.api_payment_method_save(
  p_user_id uuid,
  p_provider_slug text,
  p_provider_token text,
  p_last4 text default null,
  p_brand text default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into billing.payment_methods (user_id, provider_id, provider_token, last4, brand, is_default)
  select p_user_id, p.id, p_provider_token, p_last4, p_brand,
         not exists (select 1 from billing.payment_methods m where m.user_id = p_user_id)
    from billing.payment_providers p
   where p.slug = p_provider_slug
  on conflict (provider_id, provider_token) do update set last4 = excluded.last4, brand = excluded.brand
  returning id;
$$;
comment on function public.api_payment_method_save(uuid, text, text, text, text) is
  'Service role: stores the provider token of a member''s payment method.';
