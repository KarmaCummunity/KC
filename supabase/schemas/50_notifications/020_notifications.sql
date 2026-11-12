-- Notifications · notifications (the in-app notification centre, D7, D26)
--
-- One row per notification a member sees. Rows are written only by the delivery function
-- (030_notification_delivery.sql) and are append-mostly, so the table is partitioned by
-- month on `created_at`: retention (180 days) drops whole partitions instead of deleting
-- rows. Partitions are plain declarative ones, created ahead of time by
-- kc_private.notifications_ensure_partition; they live in `kc_private`, so only this
-- parent is part of the API.

create table public.notifications (
  id          uuid not null default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  -- A kind of kc_private.notification_kinds; `category` and the text keys are copied from
  -- it at delivery, so reading the centre never touches the private registry. No foreign
  -- key: the only writer takes the values from the registry row itself.
  kind        text not null,
  category    text not null check (category in ('critical', 'social')),
  -- Giving world of the entity, for the world filter of the centre; null when none.
  world_slug  text,
  -- What the notification is about and where a tap leads (a chat, a post handoff, a member).
  entity_type text,
  entity_id   uuid,
  title_key   text not null,
  body_key    text not null,
  -- Arguments of the text and of the tap route, as sent by the emitting module (ids,
  -- statuses). Display names are not stored: the app resolves them from `actor_ids`.
  data        jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  -- Set for kinds that merge: later events with the same key join this row while it is
  -- unread and inside the kind's group window.
  group_key   text,
  -- Members who caused the notification, newest first, at most five; `group_count` is the
  -- number of merged events ("X and 3 others").
  actor_ids   uuid[] not null default '{}',
  group_count integer not null default 1 check (group_count >= 1),
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  -- Last merge; equal to created_at for a notification that never merged.
  updated_at  timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);
comment on table public.notifications is
  'In-app notification centre of a member. Written by server code; partitioned by month, kept 180 days.';

-- The centre, newest first: keyset on (created_at, id).
create index notifications_user_recent_idx on public.notifications (user_id, created_at desc, id desc);
-- Unread rows of a member: the badge count, "mark all read", and the lookup of the open
-- group a new event merges into.
create index notifications_user_unread_idx on public.notifications (user_id, group_key)
  where read_at is null;

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

-- A member reads their own notifications. Marking them read goes through RPCs.
create policy notifications_select_self on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.notifications to authenticated;

-- Rows whose month has no partition yet land here, so a missed scheduler run never fails a
-- delivery; ensure_partition moves them out when it creates the month.
create table kc_private.notifications_default partition of public.notifications default;
alter table kc_private.notifications_default enable row level security;
alter table kc_private.notifications_default force row level security;

-- Creates the partition of the month containing p_day, if it does not exist. Rows of that
-- month waiting in the default partition are moved into it. Run monthly, one month ahead.
create function kc_private.notifications_ensure_partition(p_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from constant date := date_trunc('month', p_day)::date;
  v_to constant date := (v_from + interval '1 month')::date;
  v_name constant text := 'notifications_y' || to_char(v_from, 'YYYY"m"MM');
begin
  if to_regclass('kc_private.' || v_name) is not null then
    return;
  end if;
  execute format('create table kc_private.%I (like public.notifications including defaults including constraints)', v_name);
  execute format('alter table kc_private.%I enable row level security', v_name);
  execute format('alter table kc_private.%I force row level security', v_name);
  execute format(
    'with moved as (delete from kc_private.notifications_default d
                     where d.created_at >= %L and d.created_at < %L returning d.*)
     insert into kc_private.%I select * from moved', v_from, v_to, v_name);
  execute format(
    'alter table public.notifications attach partition kc_private.%I for values from (%L) to (%L)',
    v_name, v_from, v_to);
end;
$$;
comment on function kc_private.notifications_ensure_partition(date) is
  'Creates the monthly partition of notifications for the given day, if missing.';

-- The month the baseline is applied in and the one after it.
do $$
begin
  perform kc_private.notifications_ensure_partition(current_date);
  perform kc_private.notifications_ensure_partition((current_date + interval '1 month')::date);
end $$;

-- Dedupe ledger: one row per (member, key) that already produced a notification. Kept apart
-- from the partitioned table because a uniqueness guarantee cannot span partitions.
create table kc_private.notification_dedupe (
  user_id    uuid not null references public.users (id) on delete cascade,
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (user_id, dedupe_key)
);
comment on table kc_private.notification_dedupe is
  'Keys that already produced a notification for a member; purged with the notifications.';
-- Retention purge: keys older than the window.
create index notification_dedupe_created_idx on kc_private.notification_dedupe (created_at);

alter table kc_private.notification_dedupe enable row level security;
alter table kc_private.notification_dedupe force row level security;

-- Retention (180 days): drops every monthly partition that lies entirely before the
-- window, and deletes older rows left in the default partition and in the dedupe ledger.
-- Returns the number of partitions dropped. Run daily.
create function kc_private.notifications_purge(p_keep interval default interval '180 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff constant timestamptz := now() - p_keep;
  v_partition record;
  v_dropped integer := 0;
begin
  for v_partition in
    select c.relname
      from pg_catalog.pg_inherits i
      join pg_catalog.pg_class c on c.oid = i.inhrelid
     where i.inhparent = 'public.notifications'::regclass
       and c.relname ~ '^notifications_y\d{4}m\d{2}$'
       -- The partition ends where the next month begins.
       and to_date(substr(c.relname, 16), 'YYYY"m"MM') + interval '1 month' <= v_cutoff
  loop
    execute format('drop table kc_private.%I', v_partition.relname);
    v_dropped := v_dropped + 1;
  end loop;

  delete from kc_private.notifications_default d where d.created_at < v_cutoff;
  delete from kc_private.notification_dedupe d where d.created_at < v_cutoff;
  return v_dropped;
end;
$$;
comment on function kc_private.notifications_purge(interval) is
  'Retention: drops monthly partitions older than the window and purges the dedupe ledger.';
