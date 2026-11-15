-- Billing · ledger (double entry, append-only)
--
-- Every money move is recorded as one ledger transaction: lines that share a `txn_id` and
-- whose debits equal their credits. The balance is checked when the database transaction
-- commits, so no path — a function of this module, a migration, a manual fix — can leave
-- an unbalanced transaction behind. A line is never changed or removed by any role; a
-- mistake is corrected by a new, opposite transaction.
--
-- Accounts:
--   provider_clearing  money held for us by the payment provider (asset)
--   org_payable        money owed to an organization (liability; `org_id` says to which)
-- Moves:  payment  debit provider_clearing / credit org_payable
--         refund   debit org_payable / credit provider_clearing
--         payout   debit org_payable / credit provider_clearing

create table billing.ledger_entries (
  id            bigint generated always as identity primary key,
  txn_id        uuid not null,
  account       text not null check (account in ('provider_clearing', 'org_payable')),
  -- The organization whose money the move is about.
  org_id        uuid not null references public.organizations (id) on delete restrict,
  debit_agorot  bigint not null default 0 check (debit_agorot >= 0),
  credit_agorot bigint not null default 0 check (credit_agorot >= 0),
  currency      text not null default 'ILS' check (currency = 'ILS'),
  -- The business record the transaction belongs to. No foreign key: one column refers to
  -- three tables, and those rows can never be deleted (restrict from their own children).
  ref_type      text not null check (ref_type in ('payment', 'refund', 'payout')),
  ref_id        uuid not null,
  created_at    timestamptz not null default now(),
  -- A line is one-sided.
  constraint ledger_entries_one_side_chk check ((debit_agorot > 0) <> (credit_agorot > 0)),
  -- Idempotency: a business record is posted once.
  unique (ref_type, ref_id, account)
);
comment on table billing.ledger_entries is
  'Double-entry ledger in agorot. Balanced per transaction at commit; append-only for every role.';

-- Lines of a transaction (the balance check).
create index ledger_entries_txn_idx on billing.ledger_entries (txn_id);
-- Balance and statement of an organization per account; covers the organization foreign key.
create index ledger_entries_org_account_idx on billing.ledger_entries (org_id, account, id);

alter table billing.ledger_entries enable row level security;
alter table billing.ledger_entries force row level security;
revoke insert, update, delete, truncate on billing.ledger_entries from service_role;

-- No change and no removal, for any role (the table owner included).
create trigger ledger_entries_append_only
  before update or delete on billing.ledger_entries
  for each row execute function kc_private.audit_reject_change();
create trigger ledger_entries_no_truncate
  before truncate on billing.ledger_entries
  for each statement execute function kc_private.audit_reject_change();

-- Raises unless the transaction of the inserted line balances, per currency.
create function kc_private.ledger_assert_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1
               from billing.ledger_entries e
              where e.txn_id = new.txn_id
              group by e.currency
             having sum(e.debit_agorot) <> sum(e.credit_agorot)) then
    raise exception 'ledger_unbalanced' using errcode = 'P0001', detail = format('txn %s', new.txn_id);
  end if;
  return null;
end;
$$;
comment on function kc_private.ledger_assert_balanced() is
  'Deferred constraint trigger: a ledger transaction must balance when the database transaction commits.';

create constraint trigger ledger_entries_balanced
  after insert on billing.ledger_entries
  deferrable initially deferred
  for each row execute function kc_private.ledger_assert_balanced();

-- Posts one balanced transaction of two lines for a business record. Posting the same
-- record again is a no-op, so a replayed provider event cannot double-count.
create function kc_private.ledger_post(
  p_ref_type text,
  p_ref_id uuid,
  p_org_id uuid,
  p_debit_account text,
  p_credit_account text,
  p_amount_agorot bigint
)
returns void
language sql
security definer
set search_path = ''
as $$
  with txn as (select gen_random_uuid() as id)
  insert into billing.ledger_entries (txn_id, account, org_id, debit_agorot, credit_agorot, ref_type, ref_id)
  select txn.id, l.account, p_org_id, l.debit, l.credit, p_ref_type, p_ref_id
    from txn, (values (p_debit_account, p_amount_agorot, 0::bigint),
                      (p_credit_account, 0::bigint, p_amount_agorot)) as l (account, debit, credit)
  on conflict (ref_type, ref_id, account) do nothing;
$$;
comment on function kc_private.ledger_post(text, uuid, uuid, text, text, bigint) is
  'Posts the two balanced lines of a payment, refund or payout; idempotent per business record.';

-- What the product still owes an organization: collected, minus refunded and paid out.
create function kc_private.billing_org_balance(p_org_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(e.credit_agorot - e.debit_agorot), 0)::bigint
    from billing.ledger_entries e
   where e.org_id = p_org_id and e.account = 'org_payable';
$$;
comment on function kc_private.billing_org_balance(uuid) is 'Balance owed to an organization, in agorot, from the ledger.';
