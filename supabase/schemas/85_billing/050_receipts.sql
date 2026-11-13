-- Billing · donation receipts (D20, D77; FR-FIN-007 AC4, FR-FIN-008, FR-FIN-021)
--
-- One receipt record per succeeded payment, numbered per organization without gaps: the
-- serial comes from a counter row that the issuing transaction locks, so two receipts
-- issued at the same moment queue up, and a transaction that fails gives its number back.
-- The record carries whether the donation is eligible under Section 46(a) — true only
-- while the organization's approval is active on the day of the payment; the product
-- records that fact and never decides it (D77). The official document itself is produced
-- by the organization's own tools from this record.

-- Last serial issued per organization.
create table billing.receipt_counters (
  org_id      uuid primary key references public.organizations (id) on delete restrict,
  last_serial bigint not null default 0 check (last_serial >= 0)
);
comment on table billing.receipt_counters is 'Per-organization receipt counter; locked by the issuing transaction.';
alter table billing.receipt_counters enable row level security;
alter table billing.receipt_counters force row level security;

create table billing.receipts (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete restrict,
  -- Gapless within the organization, starting at 1.
  serial                bigint not null check (serial > 0),
  payment_id            uuid not null unique references billing.payments (id) on delete restrict,
  user_id               uuid references public.users (id) on delete set null,
  user_tombstone        bytea check (octet_length(user_tombstone) = 32),
  amount_agorot         bigint not null check (amount_agorot > 0),
  currency              text not null default 'ILS' check (currency = 'ILS'),
  -- Section 46(a) eligibility on the payment date, with the approval number it rests on.
  sec46_eligible        boolean not null default false,
  sec46_approval_number text,
  issued_at             timestamptz not null default now(),
  unique (org_id, serial),
  constraint receipts_party_chk check (num_nonnulls(user_id, user_tombstone) = 1),
  constraint receipts_sec46_chk check (sec46_eligible = (sec46_approval_number is not null))
);
comment on table billing.receipts is 'Receipt record of each succeeded donation, with a gapless serial per organization.';
-- "My receipts"; covers the member foreign key.
create index receipts_user_idx on billing.receipts (user_id, issued_at desc) where user_id is not null;

alter table billing.receipts enable row level security;
alter table billing.receipts force row level security;
revoke insert, update, delete, truncate on billing.receipts, billing.receipt_counters from service_role;

-- A receipt is never removed and never rewritten. The one permitted change replaces the
-- member reference by the tombstone when the account is purged.
create function kc_private.receipts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE'
     or (to_jsonb(new) - 'user_id' - 'user_tombstone') <> (to_jsonb(old) - 'user_id' - 'user_tombstone') then
    raise exception 'append_only' using errcode = 'P0001',
      detail = format('%s on %s.%s', tg_op, tg_table_schema, tg_table_name);
  end if;
  return new;
end;
$$;

create trigger receipts_immutable
  before update or delete on billing.receipts
  for each row execute function kc_private.receipts_guard();
create trigger receipts_no_truncate
  before truncate on billing.receipts
  for each statement execute function kc_private.receipts_guard();

insert into kc_private.notification_kinds (kind, category, title_key, body_key) values
  -- FR-FIN-021 AC4: the donor learns that a receipt exists; a member may switch it off.
  ('donation_receipt_ready', 'social', 'notifications.donationReceiptReadyTitle',
   'notifications.donationReceiptReadyBody');

-- Issues the receipt of a succeeded payment and returns it; a payment that already has
-- one gets the same receipt back. Runs inside the transaction that settles the payment.
-- Errors: P0001 payment_not_found (no such succeeded payment).
create function kc_private.billing_receipt_issue(p_payment_id uuid)
returns billing.receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment billing.payments;
  v_receipt billing.receipts;
  v_approval text;
  v_serial bigint;
begin
  -- The payment row serialises two issues of the same payment.
  select p.* into v_payment from billing.payments p
   where p.id = p_payment_id and p.status = 'succeeded' for update;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0001';
  end if;
  select r.* into v_receipt from billing.receipts r where r.payment_id = p_payment_id;
  if found then
    return v_receipt;
  end if;

  select o.sec46_approval_number into v_approval
    from public.organizations o
   where o.id = v_payment.org_id and o.sec46_status = 'active'
     and v_payment.created_at::date between o.sec46_valid_from and o.sec46_valid_until;

  -- The counter row is locked until this transaction ends: serials are handed out in
  -- commit order and a rollback returns the number.
  insert into billing.receipt_counters (org_id) values (v_payment.org_id) on conflict (org_id) do nothing;
  update billing.receipt_counters c set last_serial = c.last_serial + 1
   where c.org_id = v_payment.org_id
  returning c.last_serial into v_serial;

  insert into billing.receipts (org_id, serial, payment_id, user_id, user_tombstone, amount_agorot, currency,
                                sec46_eligible, sec46_approval_number)
  values (v_payment.org_id, v_serial, p_payment_id, v_payment.user_id, v_payment.user_tombstone,
          v_payment.amount_agorot, v_payment.currency, v_approval is not null, v_approval)
  returning * into v_receipt;

  perform kc_private.audit_record('receipt_issued', 'payment', p_payment_id,
    jsonb_build_object('receipt_id', v_receipt.id, 'org_id', v_receipt.org_id, 'serial', v_serial), null);
  if v_payment.user_id is not null then
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', 'donation_receipt_ready', 'recipient_id', v_payment.user_id, 'actor_id', null,
      'entity', jsonb_build_object('type', 'payment', 'id', p_payment_id),
      'data', jsonb_build_object('org_id', v_receipt.org_id, 'serial', v_serial,
                                 'dedupe_key', 'donation_receipt_ready:' || p_payment_id)));
  end if;
  return v_receipt;
end;
$$;
comment on function kc_private.billing_receipt_issue(uuid) is
  'Issues the gapless-numbered receipt of a succeeded payment; idempotent per payment.';
