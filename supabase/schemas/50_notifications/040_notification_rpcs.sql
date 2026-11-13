-- Notifications · RPCs of the notification centre
--
-- Reading runs with the caller's rights (the row policy limits it to their own rows).
-- Marking read is the only change a member can make and goes through the two functions
-- below; the table itself is not writable from a device.

-- One page of the caller's notification centre, newest first, with the display fields of
-- the newest actor so the screen needs no second request. Keyset on (created_at, id):
-- pass the last row's values to get the next page. `p_category` filters to one group.
-- The actor's fields are null when that member is not visible to the caller any more.
create function public.notifications_page(
  p_limit integer default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_category text default null
)
returns table (
  id uuid,
  kind text,
  category text,
  world_slug text,
  entity_type text,
  entity_id uuid,
  title_key text,
  body_key text,
  data jsonb,
  actor_ids uuid[],
  group_count integer,
  read_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  actor_display_name text,
  actor_avatar_url text
)
language sql
stable
set search_path = ''
as $$
  select n.id, n.kind, n.category, n.world_slug, n.entity_type, n.entity_id, n.title_key,
         n.body_key, n.data, n.actor_ids, n.group_count, n.read_at, n.created_at, n.updated_at,
         u.display_name, u.avatar_url
    from public.notifications n
    left join public.users u on u.id = n.actor_ids[1]
   where n.user_id = (select auth.uid())
     and (p_category is null or n.category = p_category)
     and (p_before_created_at is null or (n.created_at, n.id) < (p_before_created_at, p_before_id))
   order by n.created_at desc, n.id desc
   limit least(greatest(coalesce(p_limit, 30), 1), 50);
$$;
comment on function public.notifications_page(integer, timestamptz, uuid, text) is
  'One page of the caller''s notification centre, newest first, with the newest actor''s display fields.';
grant execute on function public.notifications_page(integer, timestamptz, uuid, text) to authenticated;

-- Badge of the notification centre: the caller's unread notifications.
create function public.notifications_unread_count()
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
    from public.notifications n
   where n.user_id = (select auth.uid()) and n.read_at is null;
$$;
comment on function public.notifications_unread_count() is 'Number of the caller''s unread notifications.';
grant execute on function public.notifications_unread_count() to authenticated;

-- Marks the listed notifications of the caller read; returns how many changed. Ids of
-- other members' notifications and already read ones are ignored.
create function public.notifications_mark_read(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_changed integer;
begin
  update public.notifications n
     set read_at = now()
   where n.user_id = v_user_id and n.read_at is null and n.id = any (p_ids);
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;
comment on function public.notifications_mark_read(uuid[]) is 'Marks the listed notifications of the caller read.';
grant execute on function public.notifications_mark_read(uuid[]) to authenticated;

-- Marks every unread notification of the caller read; returns how many changed.
create function public.notifications_mark_all_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_changed integer;
begin
  update public.notifications n
     set read_at = now()
   where n.user_id = v_user_id and n.read_at is null;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;
comment on function public.notifications_mark_all_read() is 'Marks all of the caller''s notifications read.';
grant execute on function public.notifications_mark_all_read() to authenticated;
