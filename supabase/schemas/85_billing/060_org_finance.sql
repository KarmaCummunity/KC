-- Billing · organization bookkeeping (requirements/19: FR-FIN-001/002/003/005/009/013, D76, D78)
--
-- Every organization — Karma Community included — keeps simple single-entry books:
-- accounts (where the money sits) and entries (what came in and went out). Entries are
-- typed by hand or mirrored from in-app payments. This is the organization's own record
-- and is separate from the double-entry ledger of 040_ledger.sql, which is the product's
-- record of the money it holds.
-- Not part of this baseline (FR-FIN phases not built): category tree and rules,
-- attachments, receipt tracking of manual entries, imports, budgets, documents, snapshots.

insert into kc_private.fsm_state (machine_id, status) values
  ('org_finance_entry', 'pending'), ('org_finance_entry', 'cleared'), ('org_finance_entry', 'cancelled');
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('org_finance_entry', 'pending', 'cleared', ''),
  ('org_finance_entry', 'cleared', 'pending', ''),
  -- Void replaces delete (FR-FIN-005 AC2); a voided entry is final.
  ('org_finance_entry', 'pending', 'cancelled', ''),
  ('org_finance_entry', 'cleared', 'cancelled', '');

create table billing.org_finance_accounts (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations (id) on delete restrict,
  name                   text not null check (char_length(btrim(name)) between 1 and 80),
  kind                   text not null check (kind in ('bank', 'cash', 'bit', 'paybox', 'payment_provider', 'other')),
  last4                  text check (last4 ~ '^[0-9]{4}$'),
  opening_balance_agorot bigint not null default 0,
  opening_balance_at     date,
  -- An account with entries is deactivated, never deleted (FR-FIN-003 AC2).
  is_active              boolean not null default true,
  sort_order             integer not null default 0,
  created_by             uuid references public.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (org_id, name)
);
comment on table billing.org_finance_accounts is 'Financial accounts of an organization: bank, cash box, payment apps, the payment provider.';
create index org_finance_accounts_created_by_idx on billing.org_finance_accounts (created_by) where created_by is not null;

create table billing.org_finance_entries (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete restrict,
  account_id      uuid references billing.org_finance_accounts (id) on delete restrict,
  kind            text not null check (kind in ('donation_in', 'grant_in', 'other_in', 'expense', 'refund_out',
                                                'other_out', 'transfer')),
  -- Derived from the kind; a transfer between own accounts has none.
  direction       text generated always as (
                    case when kind in ('donation_in', 'grant_in', 'other_in') then 'in'
                         when kind in ('expense', 'refund_out', 'other_out') then 'out' end) stored,
  amount_agorot   bigint not null check (amount_agorot > 0),
  currency        text not null default 'ILS' check (currency = 'ILS'),
  occurred_at     timestamptz not null,
  counterparty    text check (char_length(counterparty) <= 200),
  -- Category key from the app's list (FR-FIN-004 default keys), or the organization's own text.
  category        text check (char_length(category) <= 60),
  description     text check (char_length(description) <= 2000),
  -- Lifecycle, machine `org_finance_entry`. `cancelled` = voided, with the reason.
  status          text not null default 'pending',
  void_reason     text check (char_length(void_reason) between 3 and 500),
  -- False keeps the entry out of the public transparency numbers (FR-FIN-022 AC4).
  is_public       boolean not null default true,
  -- `payment_sync` entries mirror an in-app payment or refund; `source_ref` names it.
  source          text not null default 'manual' check (source in ('manual', 'payment_sync')),
  source_ref      text unique,
  -- The donor of a mirrored donation; never shown publicly (FR-FIN-019 AC6).
  donor_user_id   uuid references public.users (id) on delete set null,
  donor_tombstone bytea check (octet_length(donor_tombstone) = 32),
  -- Matched to a bank or provider statement; freezes the entry (FR-FIN-013).
  reconciled_at   timestamptz,
  reconciled_by   uuid references public.users (id) on delete set null,
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint org_finance_entries_void_chk check ((status = 'cancelled') = (void_reason is not null)),
  constraint org_finance_entries_source_chk check ((source = 'manual') = (source_ref is null)),
  constraint org_finance_entries_donor_chk check (num_nonnulls(donor_user_id, donor_tombstone) <= 1)
);
comment on table billing.org_finance_entries is 'Single-entry books of an organization: manual entries and mirrored in-app payments.';

-- The books of an organization, newest first (keyset on occurred_at, id), and its public totals.
create index org_finance_entries_org_idx on billing.org_finance_entries (org_id, occurred_at desc, id desc);
-- Balance of an account; covers the account foreign key.
create index org_finance_entries_account_idx on billing.org_finance_entries (account_id) where account_id is not null;
-- Foreign keys to members.
create index org_finance_entries_donor_idx on billing.org_finance_entries (donor_user_id) where donor_user_id is not null;
create index org_finance_entries_reconciled_by_idx on billing.org_finance_entries (reconciled_by)
  where reconciled_by is not null;
create index org_finance_entries_created_by_idx on billing.org_finance_entries (created_by) where created_by is not null;

-- What may still change on an entry (FR-FIN-005 AC2/AC3, FR-FIN-013 AC3):
--   entry_voided            a voided entry never changes
--   entry_reconciled        a reconciled entry keeps its kind, amount, date, account and status
--   entry_locked_by_source  a mirrored entry keeps its kind, amount, date, account and counterparty
create function kc_private.org_finance_entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- The member references are not content: the purge of an account replaces them even
  -- on a voided entry. `direction` is generated and not yet computed in a BEFORE trigger.
  v_ignored constant text[] := array['donor_user_id', 'donor_tombstone', 'created_by', 'reconciled_by', 'direction'];
begin
  if (to_jsonb(new) - v_ignored) = (to_jsonb(old) - v_ignored) then
    return new;
  elsif old.status = 'cancelled' then
    raise exception 'entry_voided' using errcode = 'P0001';
  elsif old.reconciled_at is not null and new.reconciled_at is not null
        and (new.kind, new.amount_agorot, new.occurred_at, new.account_id, new.status)
            is distinct from (old.kind, old.amount_agorot, old.occurred_at, old.account_id, old.status) then
    raise exception 'entry_reconciled' using errcode = 'P0001';
  elsif old.source = 'payment_sync'
        and (new.kind, new.amount_agorot, new.occurred_at, new.account_id, new.counterparty, new.source_ref)
            is distinct from (old.kind, old.amount_agorot, old.occurred_at, old.account_id, old.counterparty, old.source_ref) then
    raise exception 'entry_locked_by_source' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger org_finance_entries_guard
  before update on billing.org_finance_entries
  for each row execute function kc_private.org_finance_entries_guard();
create trigger org_finance_entries_status_fsm
  before insert or update of status on billing.org_finance_entries
  for each row execute function kc_private.fsm_guard_status('org_finance_entry', 'status');
create trigger org_finance_entries_set_updated_at
  before update on billing.org_finance_entries
  for each row execute function kc_private.set_updated_at();
create trigger org_finance_accounts_set_updated_at
  before update on billing.org_finance_accounts
  for each row execute function kc_private.set_updated_at();

alter table billing.org_finance_accounts enable row level security;
alter table billing.org_finance_accounts force row level security;
alter table billing.org_finance_entries enable row level security;
alter table billing.org_finance_entries force row level security;
revoke insert, update, delete, truncate on billing.org_finance_accounts, billing.org_finance_entries from service_role;

-- The signed-in caller, who must hold a finance permission on the organization
-- (requirements/19 § Permissions):
--   view          platform admins; org_admin, org_treasurer, org_accountant of the
--                 organization; moderators for the platform organization only
--   manage        platform admins; org_admin, org_treasurer
--   transparency  platform admins; org_admin
-- Raises forbidden (42501) otherwise.
create function kc_private.finance_assert(p_org_id uuid, p_permission text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_roles constant text[] := (select m.roles from public.org_memberships m
                               where m.org_id = p_org_id and m.user_id = v_user_id);
begin
  if kc_access.has_admin_role('admin')
     or v_roles && (case p_permission
                      when 'view' then array['org_admin', 'org_treasurer', 'org_accountant']
                      when 'manage' then array['org_admin', 'org_treasurer']
                      when 'transparency' then array['org_admin'] end)
     or (p_permission = 'view' and kc_access.has_admin_role('moderator')
         and exists (select 1 from public.organizations o where o.id = p_org_id and o.is_platform)) then
    return v_user_id;
  end if;
  raise exception 'forbidden' using errcode = '42501';
end;
$$;
comment on function kc_private.finance_assert(uuid, text) is
  'Returns auth.uid(); raises forbidden unless the caller holds the finance permission on the organization.';

-- Mirrors a settled in-app payment or refund into the organization's books (FR-FIN-009):
-- a cleared entry on the organization's payment-provider account, created on first use.
-- Idempotent per source record. A failure is audited and never fails the money move
-- (AC6); the entry can be added by hand.
create function kc_private.org_finance_mirror(
  p_org_id uuid,
  p_kind text,
  p_amount_agorot bigint,
  p_occurred_at timestamptz,
  p_source_ref text,
  p_provider_id uuid,
  p_donor_user_id uuid,
  p_donor_tombstone bytea,
  p_category text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_name constant text := (select p.display_name from billing.payment_providers p where p.id = p_provider_id);
  v_account_id uuid;
begin
  select a.id into v_account_id from billing.org_finance_accounts a
   where a.org_id = p_org_id and a.kind = 'payment_provider' order by a.created_at limit 1;
  if not found then
    insert into billing.org_finance_accounts (org_id, name, kind) values (p_org_id, v_provider_name, 'payment_provider')
    returning id into v_account_id;
  end if;
  insert into billing.org_finance_entries (org_id, account_id, kind, amount_agorot, occurred_at, counterparty,
                                           category, status, source, source_ref, donor_user_id, donor_tombstone)
  values (p_org_id, v_account_id, p_kind, p_amount_agorot, p_occurred_at, v_provider_name, p_category, 'cleared',
          'payment_sync', p_source_ref, p_donor_user_id, p_donor_tombstone)
  on conflict (source_ref) do nothing;
exception when others then
  perform kc_private.audit_record('finance_sync_failed', 'organization', p_org_id,
                                  jsonb_build_object('source_ref', p_source_ref, 'sqlstate', sqlstate), null);
end;
$$;
comment on function kc_private.org_finance_mirror(uuid, text, bigint, timestamptz, text, uuid, uuid, bytea, text) is
  'Mirrors a settled payment or refund into the organization''s books; never fails the caller.';
