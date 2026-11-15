-- 0256_notification_inbox_rpcs_realtime | KC#869 — inbox RPCs, quiet hours prefs, badge broadcast.

-- Extend default notification_preferences shape (merge-safe; existing rows unchanged).
comment on column public.users.notification_preferences is
  'FR-NOTIF-014 + KC#869: {critical,social,kinds:{...},quietHours:{enabled,start,end,timezone}}. critical bypasses quiet hours.';

create or replace function public.notification_in_quiet_hours(p_prefs jsonb, p_at timestamptz default now())
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_qh jsonb;
  v_start time;
  v_end time;
  v_local time;
  v_tz text;
begin
  v_qh := p_prefs -> 'quietHours';
  if v_qh is null or coalesce((v_qh ->> 'enabled')::boolean, false) is not true then
    return false;
  end if;
  v_tz := coalesce(v_qh ->> 'timezone', 'UTC');
  v_start := (v_qh ->> 'start')::time;
  v_end := (v_qh ->> 'end')::time;
  v_local := (p_at at time zone v_tz)::time;

  if v_start <= v_end then
    return v_local >= v_start and v_local < v_end;
  end if;
  -- Overnight window (e.g. 22:00 → 07:00)
  return v_local >= v_start or v_local < v_end;
end;
$$;

revoke all on function public.notification_in_quiet_hours(jsonb, timestamptz) from public;
grant execute on function public.notification_in_quiet_hours(jsonb, timestamptz) to authenticated, service_role;

create or replace function public.rpc_notification_inbox_list(
  p_limit integer default 30,
  p_cursor_created_at timestamptz default null,
  p_cursor_inbox_id uuid default null,
  p_category text default null,
  p_world text default null
)
returns setof public.notification_inbox
language sql
stable
security invoker
set search_path = public
as $$
  select i.*
    from public.notification_inbox i
   where i.user_id = (select auth.uid())
     and (p_category is null or i.category = p_category)
     and (p_world is null or i.world = p_world)
     and (
       p_cursor_created_at is null
       or (i.created_at, i.inbox_id) < (p_cursor_created_at, coalesce(p_cursor_inbox_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
     )
   order by i.created_at desc, i.inbox_id desc
   limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

grant execute on function public.rpc_notification_inbox_list(integer, timestamptz, uuid, text, text) to authenticated;

create or replace function public.rpc_notification_inbox_unread_count()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer
    from public.notification_inbox i
   where i.user_id = (select auth.uid())
     and i.read_at is null;
$$;

grant execute on function public.rpc_notification_inbox_unread_count() to authenticated;

create or replace function public.rpc_notification_inbox_mark_read(p_inbox_id uuid)
returns public.notification_inbox
language plpgsql
security invoker
set search_path = public
as $$
declare v_row public.notification_inbox;
begin
  update public.notification_inbox
     set read_at = coalesce(read_at, now())
   where inbox_id = p_inbox_id
     and user_id = (select auth.uid())
  returning * into v_row;
  if v_row.inbox_id is null then
    raise exception 'notification_not_found' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

grant execute on function public.rpc_notification_inbox_mark_read(uuid) to authenticated;

create or replace function public.rpc_notification_inbox_mark_all_read()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_n integer;
begin
  update public.notification_inbox
     set read_at = now()
   where user_id = (select auth.uid())
     and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function public.rpc_notification_inbox_mark_all_read() to authenticated;

-- Badge fan-out: user:<uuid>:notifications / event badge
create or replace function public.notification_inbox_broadcast_badge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_unread int;
begin
  v_uid := coalesce(new.user_id, old.user_id);
  select count(*)::integer into v_unread
    from public.notification_inbox
   where user_id = v_uid and read_at is null;

  perform realtime.send(
    jsonb_build_object(
      'unread_count', v_unread,
      'inbox_id', coalesce(new.inbox_id, old.inbox_id),
      'op', tg_op
    ),
    'badge',
    'user:' || v_uid::text || ':notifications',
    true
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists tg_notification_inbox_broadcast on public.notification_inbox;
create trigger tg_notification_inbox_broadcast
  after insert or update of read_at on public.notification_inbox
  for each row execute function public.notification_inbox_broadcast_badge();

drop policy if exists user_notifications_broadcast_receive on realtime.messages;
create policy user_notifications_broadcast_receive
  on realtime.messages
  for select
  to authenticated
  using (
    (select realtime.topic()) like 'user:%:notifications'
    and nullif(split_part((select realtime.topic()), ':', 2), '')::uuid = (select auth.uid())
  );
