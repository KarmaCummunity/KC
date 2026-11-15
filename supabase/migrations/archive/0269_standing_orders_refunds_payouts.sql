-- 0269_standing_orders_refunds_payouts | Issue #850 (part 3)

begin;

create table public.standing_orders (
  order_id              uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(user_id) on delete cascade,
  org_id                uuid not null references public.organizations(org_id),
  amount_ils            numeric(12, 2) not null check (amount_ils >= 5),
  cadence               text not null check (cadence in ('monthly','quarterly','yearly')),
  status                text not null default 'active'
    check (status in ('active','paused','cancelled')),
  provider_id           uuid references public.payment_providers(provider_id),
  provider_ref          text,
  idempotency_key       text not null unique,
  next_charge_at        timestamptz,
  cancelled_at          timestamptz,
  created_at            timestamptz not null default now()
);

create table public.payment_refunds (
  refund_id        uuid primary key default gen_random_uuid(),
  payment_id       uuid not null references public.payments(payment_id),
  amount_ils       numeric(12, 2) not null check (amount_ils > 0),
  reason           text,
  status           text not null default 'pending'
    check (status in ('pending','succeeded','failed')),
  idempotency_key  text not null unique,
  provider_ref     text,
  created_at       timestamptz not null default now()
);

create table public.payment_payouts (
  payout_id        uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(org_id),
  amount_ils       numeric(12, 2) not null check (amount_ils > 0),
  status           text not null default 'pending'
    check (status in ('pending','paid','failed')),
  provider_ref     text,
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now()
);

create table public.donation_receipts (
  receipt_id       uuid primary key default gen_random_uuid(),
  payment_id       uuid not null references public.payments(payment_id),
  org_id           uuid not null references public.organizations(org_id),
  user_id          uuid not null references public.users(user_id),
  section46_serial text,
  issued_at        timestamptz not null default now(),
  payload          jsonb not null default '{}'::jsonb,
  constraint donation_receipts_payment_unique unique (payment_id)
);

alter table public.standing_orders enable row level security;
alter table public.payment_refunds enable row level security;
alter table public.payment_payouts enable row level security;
alter table public.donation_receipts enable row level security;

create policy standing_orders_own on public.standing_orders
  for select to authenticated using (user_id = auth.uid());

create policy payment_refunds_own on public.payment_refunds
  for select to authenticated using (
    exists (select 1 from public.payments p where p.payment_id = payment_refunds.payment_id and p.user_id = auth.uid())
  );

create policy donation_receipts_own on public.donation_receipts
  for select to authenticated using (user_id = auth.uid());

-- Payouts are visible to the receiving organization's admins/managers only.
create policy payment_payouts_org_admin_read on public.payment_payouts
  for select to authenticated using (
    exists (
      select 1 from public.org_memberships m
       where m.org_id = payment_payouts.org_id
         and m.user_id = auth.uid()
         and m.role in ('org_admin', 'org_manager')
    )
  );

create or replace function public.cancel_standing_order(p_order_id uuid)
returns public.standing_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.standing_orders;
begin
  update public.standing_orders
     set status = 'cancelled', cancelled_at = now()
   where order_id = p_order_id and user_id = auth.uid()
  returning * into v_row;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

grant execute on function public.cancel_standing_order(uuid) to authenticated;

commit;
