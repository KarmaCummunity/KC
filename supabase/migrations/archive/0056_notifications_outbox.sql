-- 0056_notifications_outbox | P1.5 — FR-NOTIF-* outbox + helper.
-- Creates the queue table, the enqueue helper, and the indexes required
-- by the dispatcher and the retry sweeper. Triggers, webhook, and crons
-- are split into 0057 / 0058 for reviewability.

begin;

create table if not exists public.notifications_outbox (
  notification_id      uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users(user_id) on delete cascade,
  category             text not null check (category in ('critical','social')),
  kind                 text not null,
  title_key            text not null,
  body_key             text not null,
  body_args            jsonb not null default '{}'::jsonb,
  data                 jsonb not null default '{}'::jsonb,
  dedupe_key           text,
  bypass_preferences   boolean not null default false,
  created_at           timestamptz not null default now(),
  dispatched_at        timestamptz,
  attempts             int not null default 0,
  last_error           text,
  expires_at           timestamptz not null default (now() + interval '7 days')
);

create index if not exists notifications_outbox_user_created_idx
  on public.notifications_outbox (user_id, created_at desc);

create index if not exists notifications_outbox_pending_idx
  on public.notifications_outbox (created_at)
  where dispatched_at is null;

create unique index if not exists notifications_outbox_dedupe_idx
  on public.notifications_outbox (dedupe_key)
  where dedupe_key is not null;

create index if not exists notifications_outbox_expires_idx
  on public.notifications_outbox (expires_at);

alter table public.notifications_outbox enable row level security;
-- No policies — service_role only.
revoke all on public.notifications_outbox from authenticated, anon;

create or replace function public.enqueue_notification(
  p_user_id            uuid,
  p_category           text,
  p_kind               text,
  p_title_key          text,
  p_body_key           text,
  p_body_args          jsonb default '{}'::jsonb,
  p_data               jsonb default '{}'::jsonb,
  p_dedupe_key         text default null,
  p_bypass_preferences boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_user_id is null then return null; end if;
  -- Self-suppression: never notify the actor of their own action.
  if p_user_id = coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) then
    return null;
  end if;
  insert into public.notifications_outbox(
    user_id, category, kind, title_key, body_key, body_args, data, dedupe_key, bypass_preferences
  )
  values (p_user_id, p_category, p_kind, p_title_key, p_body_key, p_body_args, p_data, p_dedupe_key, p_bypass_preferences)
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning notification_id into v_id;
  return v_id;
end $$;

revoke all on function public.enqueue_notification(uuid, text, text, text, text, jsonb, jsonb, text, boolean) from public;
grant execute on function public.enqueue_notification(uuid, text, text, text, text, jsonb, jsonb, text, boolean) to service_role;

commit;
