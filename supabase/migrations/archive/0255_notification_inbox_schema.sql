-- 0255_notification_inbox_schema | KC#869 — in-app notification center rows + grouping.

create table if not exists public.notification_inbox (
  inbox_id         uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(user_id) on delete cascade,
  outbox_id        uuid references public.notifications_outbox(notification_id) on delete set null,
  category         text not null check (category in ('critical', 'social', 'system')),
  world            text not null default 'core'
    check (world in ('core', 'items', 'rides', 'chat', 'system')),
  kind             text not null,
  title_key        text not null,
  body_key         text not null,
  body_args        jsonb not null default '{}'::jsonb,
  data             jsonb not null default '{}'::jsonb,
  group_key        text,
  group_actor_ids  uuid[] not null default '{}'::uuid[],
  group_count      integer not null default 1 check (group_count >= 1),
  read_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.notification_inbox is
  'KC#869: user-visible notification feed (distinct from push outbox). Grouped rows for social bursts.';

create index if not exists notification_inbox_user_created_idx
  on public.notification_inbox (user_id, created_at desc, inbox_id desc);

create index if not exists notification_inbox_user_unread_idx
  on public.notification_inbox (user_id, created_at desc)
  where read_at is null;

create unique index if not exists notification_inbox_open_group_uidx
  on public.notification_inbox (user_id, group_key)
  where group_key is not null and read_at is null;

create trigger notification_inbox_set_updated_at
  before update on public.notification_inbox
  for each row execute function public.set_updated_at();

alter table public.notification_inbox enable row level security;

grant select, update on public.notification_inbox to authenticated;

create policy notification_inbox_select_self on public.notification_inbox
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy notification_inbox_update_self on public.notification_inbox
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Map notification kind → world bucket for inbox filters.
create or replace function public.notification_inbox_world_for_kind(p_kind text)
returns text
language sql
immutable
as $$
  select case
    when p_kind like 'ride_%' or p_kind like 'chat_%' then 'rides'
    when p_kind like 'post_%' or p_kind like 'follow_%' then 'core'
    when p_kind in ('system_message', 'account_suspended', 'admin_task_assigned') then 'system'
    else 'core'
  end;
$$;

-- Derive grouping key + actor id from outbox row.
create or replace function public.notification_inbox_group_meta(p_row public.notifications_outbox)
returns table (group_key text, actor_id uuid)
language plpgsql
stable
set search_path = public
as $$
declare
  v_target text;
  v_actor  uuid;
  v_parts  text[];
begin
  group_key := null;
  actor_id := null;

  if p_row.dedupe_key is not null then
    v_parts := string_to_array(p_row.dedupe_key, ':');
    if array_length(v_parts, 1) >= 3 then
      begin
        actor_id := v_parts[3]::uuid;
      exception when others then
        actor_id := null;
      end;
    end if;
  end if;

  v_target := coalesce(p_row.data #>> '{params,id}', p_row.data ->> 'post_id');

  if p_row.kind in ('post_reaction', 'post_comment', 'post_mention') and v_target is not null then
    group_key := p_row.kind || ':' || v_target;
  end if;

  return next;
end;
$$;

create or replace function public.notification_inbox_sync_from_outbox()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group_key text;
  v_actor_id  uuid;
  v_existing  public.notification_inbox%rowtype;
  v_actor_name text;
  v_others int;
begin
  select gm.group_key, gm.actor_id into v_group_key, v_actor_id
    from public.notification_inbox_group_meta(new) gm;

  if v_group_key is not null then
    select * into v_existing
      from public.notification_inbox i
     where i.user_id = new.user_id
       and i.group_key = v_group_key
       and i.read_at is null
     for update;

    if found then
      v_others := v_existing.group_count; -- before increment
      update public.notification_inbox
         set group_count = group_count + 1,
             group_actor_ids = case
               when v_actor_id is not null
                 and not (v_actor_id = any (group_actor_ids))
               then group_actor_ids || v_actor_id
               else group_actor_ids
             end,
             body_key = case new.kind
               when 'post_reaction' then 'notifications.postReactionGroupedBody'
               when 'post_comment' then 'notifications.postCommentGroupedBody'
               else body_key
             end,
             body_args = coalesce(body_args, '{}'::jsonb)
               || jsonb_build_object(
                 'othersCount', v_others,
                 'totalCount', v_others + 1
               ),
             updated_at = now()
       where inbox_id = v_existing.inbox_id;
      return new;
    end if;
  end if;

  if v_actor_id is not null then
    select coalesce(u.display_name, 'Karma user') into v_actor_name
      from public.users u where u.user_id = v_actor_id;
  end if;

  insert into public.notification_inbox (
    user_id, outbox_id, category, world, kind,
    title_key, body_key, body_args, data,
    group_key, group_actor_ids, group_count
  ) values (
    new.user_id,
    new.notification_id,
    new.category,
    public.notification_inbox_world_for_kind(new.kind),
    new.kind,
    new.title_key,
    new.body_key,
    coalesce(new.body_args, '{}'::jsonb)
      || case when v_actor_name is not null
         then jsonb_build_object('actorName', v_actor_name) else '{}'::jsonb end,
    new.data,
    v_group_key,
    case when v_actor_id is not null then array[v_actor_id] else '{}'::uuid[] end,
    1
  );

  return new;
end;
$$;

drop trigger if exists tg_notification_inbox_sync on public.notifications_outbox;
create trigger tg_notification_inbox_sync
  after insert on public.notifications_outbox
  for each row execute function public.notification_inbox_sync_from_outbox();
