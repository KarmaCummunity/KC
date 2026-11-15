-- Money · the channels for supporting KC directly (FR-DONATE-010, FR-DONATE-011, D20, D64,
-- D121; app migration map M20)
--
-- The "Support KC" card opens a licensed provider's hosted page (Bit, PayBox, a card page):
-- the app never handles card or bank details. The links live in this small table, not in the
-- app bundle, so a provider is swapped, paused or added without a release (PM decision: a
-- table in the database). Everyone reads the active channels through one function; only the
-- super admin writes rows (operator flow: docs/SSOT/OPERATOR_RUNBOOK.md "KC support
-- channels"). The interim Bit / PayBox transfers go to a phone number that is shown to
-- signed-in members only and never stored in the repository.

create table public.kc_support_channels (
  channel        text primary key
                   check (channel in ('bit', 'paybox', 'card_one_time', 'card_standing_order')),
  -- Opened verbatim in the external browser, so only a plain https address is accepted: no
  -- credentials, no whitespace (the app checks the same rule, KcSupportChannel.ts).
  url            text not null check (url ~* '^https://[a-z0-9.-]+(:[0-9]+)?([/?#][^[:space:]]*)?$'),
  -- Shown to the donor ("processed securely by <provider_label>").
  provider_label text not null check (char_length(provider_label) between 1 and 40),
  -- Israeli mobile number, digits only, for the phone-addressed transfer apps (D121).
  payee_phone    text check (payee_phone ~ '^05[0-9]{8}$'),
  is_active      boolean not null default true,
  updated_at     timestamptz not null default now(),
  constraint kc_support_channels_payee_phone_kind_chk
    check (payee_phone is null or channel in ('bit', 'paybox'))
);
comment on table public.kc_support_channels is
  'Hosted payment pages for supporting KC directly. Read through list_kc_support_channels; super admin writes.';

create trigger kc_support_channels_set_updated_at
  before update on public.kc_support_channels
  for each row execute function kc_private.set_updated_at();

-- The two instant-transfer links published in FR-DONATE-010 (interim, D64: the app hides
-- them once an active card_one_time row exists). Card pages are added by the operator.
insert into public.kc_support_channels (channel, url, provider_label) values
  ('bit', 'https://www.bitpay.co.il/app/share-info?i=192485429007_19nlt4Un', 'Bit'),
  ('paybox', 'https://links.payboxapp.com/XR2JbQRxMUb', 'PayBox')
on conflict (channel) do nothing;

alter table public.kc_support_channels enable row level security;
alter table public.kc_support_channels force row level security;

-- The super admin manages the rows, paused ones included; nobody else reads the table directly.
create policy kc_support_channels_all_super_admin on public.kc_support_channels
  for all to authenticated
  using ((select kc_access.has_admin_role('super_admin')))
  with check ((select kc_access.has_admin_role('super_admin')));
grant select, insert, update, delete on public.kc_support_channels to authenticated;

-- Every change of where donor money is sent is audited (the seed above is not a change).
create function kc_private.audit_kc_support_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.audit_record('kc_support_channel_' || lower(tg_op), 'kc_support_channel', null,
    jsonb_build_object('channel', coalesce(new.channel, old.channel),
                       'is_active', coalesce(new.is_active, old.is_active)));
  return null;
end;
$$;
create trigger kc_support_channels_audit
  after insert or update or delete on public.kc_support_channels
  for each row execute function kc_private.audit_kc_support_channel();

-- The active channels in a stable order. The payee phone goes to signed-in callers only
-- (FR-DONATE-011 AC9); a guest gets null. Open to guests: the support card is shown to
-- everyone.
create function public.list_kc_support_channels()
returns table (channel text, url text, provider_label text, payee_phone text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.channel, c.url, c.provider_label,
         case when (select auth.uid()) is null then null else c.payee_phone end
    from public.kc_support_channels c
   where c.is_active
   order by c.channel;
$$;
comment on function public.list_kc_support_channels() is
  'FR-DONATE-011: active KC support channels; payee_phone only for signed-in callers.';
grant execute on function public.list_kc_support_channels() to anon, authenticated;
