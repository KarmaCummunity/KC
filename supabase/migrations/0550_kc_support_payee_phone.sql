-- 0550_kc_support_payee_phone | FR-DONATE-011 AC9 (interim personal-phone transfers)
--
-- Until licensed clearing exists, donors to KC transfer through Bit / PayBox to
-- the founder's personal phone number. The number is stored here (never in the
-- public repo) and shown to signed-in users only:
--   * column-level grants hide `payee_phone` from `anon` on direct table reads;
--   * `list_kc_support_channels()` is the app's read path and returns the
--     number only when the caller is signed in (NULL for guests).
--
-- Operator flow (docs/SSOT/OPERATOR_RUNBOOK.md → "KC support channels"):
--   update public.kc_support_channels set payee_phone = '05XXXXXXXX'
--    where channel in ('bit', 'paybox');

begin;

alter table public.kc_support_channels
  add column payee_phone text
    -- Israeli mobile number, digits only (e.g. 05XXXXXXXX); formatting is a UI concern.
    check (payee_phone ~ '^05[0-9]{8}$'),
  -- A payee phone only makes sense for the phone-addressed transfer apps.
  add constraint kc_support_channels_payee_phone_kind
    check (payee_phone is null or channel in ('bit', 'paybox'));

comment on column public.kc_support_channels.payee_phone is
  'FR-DONATE-011 AC9: phone number donors transfer to in Bit / PayBox. Signed-in readers only.';

-- Guests keep reading the public columns; the phone column is not granted to them.
revoke select on public.kc_support_channels from anon;
grant select (channel, url, provider_label, is_active, updated_at)
  on public.kc_support_channels to anon;

-- Single read path for the app: active channels, phone masked for guests.
-- SECURITY DEFINER so the guest call can read the table without the phone
-- column grant; it only ever returns active rows and NULLs the phone for anon.
create or replace function public.list_kc_support_channels()
returns table (channel text, url text, provider_label text, payee_phone text)
language sql
stable
security definer
set search_path = public
as $$
  select c.channel,
         c.url,
         c.provider_label,
         case when auth.uid() is null then null else c.payee_phone end
    from public.kc_support_channels c
   where c.is_active
   order by c.channel;
$$;

comment on function public.list_kc_support_channels() is
  'FR-DONATE-011: active KC support channels; payee_phone is returned to signed-in callers only.';

revoke execute on function public.list_kc_support_channels() from public;
grant execute on function public.list_kc_support_channels() to anon, authenticated;

commit;
