-- 0447_kc_support_channels | FR-DONATE-011 · D20 · G8
--
-- Direct financial support for KC itself (one-time + monthly standing order).
-- Per D20 the app never processes payments: it only redirects the donor to a
-- licensed provider's hosted page (Bit, PayBox, Grow). Card / bank details never
-- reach KC servers or the app, so no PCI-DSS scope is introduced here.
--
-- The destination URLs live in this table (not in the bundle) so the provider can
-- be swapped, paused, or added without an app release — the D20 requirement.
--
-- Operator flow (see docs/SSOT/OPERATOR_RUNBOOK.md → "KC support channels"):
--   insert into public.kc_support_channels (channel, url, provider_label)
--   values ('card_standing_order', 'https://<grow hosted page>', 'Grow')
--   on conflict (channel) do update set url = excluded.url, provider_label = excluded.provider_label,
--     is_active = true;

begin;

create table public.kc_support_channels (
  channel        text primary key
    check (channel in ('bit', 'paybox', 'card_one_time', 'card_standing_order')),
  -- HTTPS only, no embedded credentials / whitespace: the client opens this URL
  -- verbatim in the external browser, so a malformed value must be impossible.
  url            text not null
    check (url ~* '^https://[a-z0-9.-]+(:[0-9]+)?([/?#][^[:space:]]*)?$'),
  -- Shown to the donor ("processed securely by <provider_label>") for transparency.
  provider_label text not null check (char_length(provider_label) between 1 and 40),
  is_active      boolean not null default true,
  updated_at     timestamptz not null default now()
);

comment on table public.kc_support_channels is
  'FR-DONATE-011: hosted payment-page URLs for donating to KC directly. Public read; super-admin write.';

create trigger kc_support_channels_set_updated_at
  before update on public.kc_support_channels
  for each row execute function public.set_updated_at();

alter table public.kc_support_channels enable row level security;

-- Readable by guests too: the support CTA is auth-agnostic (mirrors FR-DONATE-010 AC5).
-- Guests get a plain `is_active` policy: anon has no EXECUTE on has_admin_role
-- (revoked in 0161), so calling it from an anon policy would fail every read.
create policy kc_support_channels_select_active_anon on public.kc_support_channels
  for select to anon
  using (is_active);

-- Signed-in users see active rows; super admins also see paused ones.
create policy kc_support_channels_select_authenticated on public.kc_support_channels
  for select to authenticated
  using (is_active or public.has_admin_role(auth.uid(), 'super_admin'));

-- Only super admins may change where donor money is sent.
create policy kc_support_channels_write_super_admin on public.kc_support_channels
  for all to authenticated
  using (public.has_admin_role(auth.uid(), 'super_admin'))
  with check (public.has_admin_role(auth.uid(), 'super_admin'));

revoke all on public.kc_support_channels from anon;
grant select on public.kc_support_channels to anon;
grant select, insert, update, delete on public.kc_support_channels to authenticated;

-- Seed the two instant-transfer channels already published in FR-DONATE-010.
-- They are interim (D64): the app hides them once an active card_one_time row exists.
-- Card one-time / standing-order rows are inserted by the operator once the
-- Grow merchant account exists (launch plan A11); until then the UI hides them.
insert into public.kc_support_channels (channel, url, provider_label)
values
  ('bit', 'https://www.bitpay.co.il/app/share-info?i=192485429007_19nlt4Un', 'Bit'),
  ('paybox', 'https://links.payboxapp.com/XR2JbQRxMUb', 'PayBox')
on conflict (channel) do nothing;

-- The pre-existing in-app donation flow to verified nonprofits (#850) runs on the
-- sandbox provider only (no real charge). It is hidden from donors until a real
-- provider ships; dev environments flip this row to exercise it.
insert into public.app_flags (key, enabled, description)
values (
  'money_in_app_org_payments',
  false,
  'Money hub: show the in-app (sandbox) donation flow to verified nonprofits.'
)
on conflict (key) do nothing;

commit;
