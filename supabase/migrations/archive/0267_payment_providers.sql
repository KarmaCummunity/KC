-- 0267_payment_providers | Issue #850 (part 1)
-- Provider registry + tokenized payment methods (no PAN/CVV).

begin;

create table public.payment_providers (
  provider_id   uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  display_name  text not null,
  is_active     boolean not null default true,
  config_public jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

insert into public.payment_providers (slug, display_name, config_public)
values ('sandbox', 'Sandbox provider', '{"hosted_fields": true}'::jsonb)
on conflict (slug) do nothing;

create table public.payment_methods (
  method_id       uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(user_id) on delete cascade,
  provider_id     uuid not null references public.payment_providers(provider_id),
  provider_token  text not null,
  last4           text,
  brand           text,
  exp_month       smallint,
  exp_year        smallint,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint payment_methods_token_present check (char_length(provider_token) > 0)
);

create index payment_methods_user_idx on public.payment_methods (user_id);

create table public.payment_recipients_kyc (
  recipient_kyc_id uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(org_id) on delete cascade,
  status           text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  provider_ref     text,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint payment_recipients_kyc_org_unique unique (org_id)
);

create table public.payer_kyc_profiles (
  user_id              uuid primary key references public.users(user_id) on delete cascade,
  status               text not null default 'none'
    check (status in ('none','pending','approved','rejected')),
  cumulative_donated_ils numeric(12, 2) not null default 0,
  kyc_required_threshold_ils numeric(12, 2) not null default 10000,
  provider_ref         text,
  verified_at          timestamptz,
  updated_at           timestamptz not null default now()
);

alter table public.payment_providers enable row level security;
alter table public.payment_methods enable row level security;
alter table public.payment_recipients_kyc enable row level security;
alter table public.payer_kyc_profiles enable row level security;

create policy payment_providers_read on public.payment_providers
  for select to authenticated using (is_active);

create policy payment_methods_own on public.payment_methods
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy payer_kyc_own on public.payer_kyc_profiles
  for select to authenticated using (user_id = auth.uid());

create policy payment_recipients_kyc_org_read on public.payment_recipients_kyc
  for select to authenticated using (
    exists (
      select 1 from public.org_memberships m
       where m.org_id = payment_recipients_kyc.org_id
         and m.user_id = auth.uid()
         and m.role in ('org_admin','org_manager')
    )
    or public.is_listing_operator(auth.uid())
  );

revoke all on public.payment_recipients_kyc from anon;

commit;
