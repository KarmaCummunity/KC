-- 0268_donation_intents_payments | Issue #850 (part 2)

begin;

create table public.donation_intents (
  intent_id        uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(user_id) on delete cascade,
  org_id           uuid not null references public.organizations(org_id),
  listing_id       uuid references public.listings(listing_id) on delete set null,
  amount_ils       numeric(12, 2) not null check (amount_ils >= 5),
  currency         text not null default 'ILS',
  idempotency_key  text not null unique,
  status           text not null default 'created'
    check (status in ('created','checkout','paid','failed','cancelled')),
  checkout_url     text,
  provider_id      uuid references public.payment_providers(provider_id),
  provider_ref     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.payments (
  payment_id       uuid primary key default gen_random_uuid(),
  intent_id        uuid not null references public.donation_intents(intent_id),
  user_id          uuid not null references public.users(user_id),
  org_id           uuid not null references public.organizations(org_id),
  amount_ils       numeric(12, 2) not null check (amount_ils > 0),
  status           text not null default 'pending'
    check (status in ('pending','succeeded','failed','refunded')),
  provider_id      uuid references public.payment_providers(provider_id),
  provider_ref     text,
  idempotency_key  text not null unique,
  method_id        uuid references public.payment_methods(method_id),
  created_at       timestamptz not null default now()
);

create index payments_intent_idx on public.payments (intent_id);

create trigger donation_intents_set_updated_at
  before update on public.donation_intents
  for each row execute function public.set_updated_at();

alter table public.donation_intents enable row level security;
alter table public.payments enable row level security;

create policy donation_intents_own on public.donation_intents
  for select to authenticated using (user_id = auth.uid());

create policy payments_own on public.payments
  for select to authenticated using (user_id = auth.uid());

create or replace function public.create_donation_intent(
  p_org_id uuid,
  p_amount_ils numeric,
  p_idempotency_key text,
  p_listing_id uuid default null
)
returns public.donation_intents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.donation_intents;
  v_org public.organizations;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if p_amount_ils is null or p_amount_ils < 5 then
    raise exception 'money_min_amount' using errcode = '23514';
  end if;

  select * into v_org from public.organizations where org_id = p_org_id;
  if not found or not v_org.is_verified_nonprofit then
    raise exception 'verified_org_required' using errcode = '42501';
  end if;

  insert into public.donation_intents (
    user_id, org_id, listing_id, amount_ils, idempotency_key, status, checkout_url, provider_id
  )
  select
    v_uid, p_org_id, p_listing_id, p_amount_ils, p_idempotency_key, 'checkout',
    'https://checkout.sandbox.local/' || gen_random_uuid()::text,
    (select provider_id from public.payment_providers where slug = 'sandbox' limit 1)
  on conflict (idempotency_key) do update set updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_donation_intent(uuid, numeric, text, uuid) to authenticated;

commit;
