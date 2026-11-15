-- 0403_app_flags | Minimal remote config: boolean feature flags readable by every client.
--
-- First flag: ios_in_app_donations. When false (default), the iOS app opens donation
-- flows in Safari instead of paying in-app (App Store 3.2.2(iv) / 3.2.1(vi)).
-- Android and web ignore this flag.
--
-- Precedence on the client: a row here overrides the compiled default in
-- app/apps/mobile/src/config/featureFlags.ts; no row → compiled default.
-- Flip without a release:  update public.app_flags set enabled = true where key = 'ios_in_app_donations';
-- Writes: service role / SQL editor only (no insert/update/delete policies).

create table if not exists public.app_flags (
  key         text primary key check (key ~ '^[a-z0-9_]{1,64}$'),
  enabled     boolean not null default false,
  description text,
  updated_at  timestamptz not null default now()
);

alter table public.app_flags enable row level security;

drop policy if exists app_flags_select_all on public.app_flags;
create policy app_flags_select_all on public.app_flags
  for select to anon, authenticated using (true);

revoke insert, update, delete on public.app_flags from anon, authenticated;
grant select on public.app_flags to anon, authenticated;

insert into public.app_flags (key, enabled, description)
values (
  'ios_in_app_donations',
  false,
  'iOS: pay donations in-app (true) or open them in Safari (false). Android/web unaffected.'
)
on conflict (key) do nothing;
