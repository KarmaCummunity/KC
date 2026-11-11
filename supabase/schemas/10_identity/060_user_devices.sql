-- Identity · user_devices (push tokens, FR-NOTIF-015)
--
-- One row per device a member receives push notifications on. The member registers the
-- token at sign-in, refreshes `last_seen_at` on every app start and deletes the row at
-- sign-out; server code deletes it when the push provider reports the token as dead, when
-- the account is deactivated (FR-SETTINGS-012 AC2) and after 90 days without use.

create table public.user_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  platform     text not null check (platform in ('ios', 'android', 'web')),
  -- Provider token. Unique: one physical device delivers to one member at a time.
  push_token   text not null unique check (char_length(push_token) between 1 and 4096),
  -- Last app start on this device; drives the 90-day prune (FR-NOTIF-015 AC4).
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
comment on table public.user_devices is 'Push tokens of a member''s devices. Owner-only.';

-- Notification dispatch: every token of the recipient.
create index user_devices_user_idx on public.user_devices (user_id);
-- Daily prune job: tokens not seen for 90 days.
create index user_devices_last_seen_idx on public.user_devices (last_seen_at);

alter table public.user_devices enable row level security;
alter table public.user_devices force row level security;

create policy user_devices_select_self on public.user_devices
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_devices_insert_self on public.user_devices
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Refreshing a registration (upsert on the token) may only touch the caller's own row.
create policy user_devices_update_self on public.user_devices
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy user_devices_delete_self on public.user_devices
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.user_devices to authenticated;
-- The columns an upsert on `push_token` rewrites; `id` and `created_at` never change.
grant update (user_id, platform, push_token, last_seen_at) on public.user_devices to authenticated;
