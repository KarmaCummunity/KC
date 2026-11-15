-- FR-STATS-003 — Personal activity timeline (best-effort from posts + recipients).
-- Full event history (reopen instant, un-mark recipient) requires a durable log (FR-STATS-005 / future TD).
-- SECURITY DEFINER: returns only rows for auth.uid(); RLS on base tables still applies for direct selects.

create or replace function public.rpc_my_activity_timeline(p_limit int default 30)
returns table (
  occurred_at timestamptz,
  kind text,
  post_id uuid,
  post_title text,
  actor_display_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lim int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  v_lim := greatest(1, least(coalesce(p_limit, 30), 50));

  return query
  with owned as (
    select p.post_id, p.title, p.status, p.created_at, p.updated_at
    from public.posts p
    where p.owner_id = v_uid
  ),
  created_events as (
    select o.created_at as occurred_at,
           'post_created'::text as kind,
           o.post_id,
           o.title as post_title,
           null::text as actor_display_name
    from owned o
  ),
  closure_events as (
    select o.updated_at as occurred_at,
           case o.status
             when 'closed_delivered' then 'post_closed_delivered'
             when 'deleted_no_recipient' then 'post_closed_no_recipient'
             when 'expired' then 'post_expired'
             when 'removed_admin' then 'post_removed_admin'
             else null
           end as kind,
           o.post_id,
           o.title as post_title,
           null::text as actor_display_name
    from owned o
    where o.status <> 'open'
  ),
  marked as (
    select r.marked_at as occurred_at,
           'marked_as_recipient'::text as kind,
           r.post_id,
           p.title as post_title,
           u.display_name as actor_display_name
    from public.recipients r
    join public.posts p on p.post_id = r.post_id
    join public.users u on u.user_id = p.owner_id
    where r.recipient_user_id = v_uid
  ),
  merged as (
    select * from created_events
    union all
    select ce.* from closure_events ce where ce.kind is not null
    union all
    select * from marked
  )
  select m.occurred_at, m.kind, m.post_id, m.post_title, m.actor_display_name
    from merged m
   order by m.occurred_at desc, m.post_id desc
   limit v_lim;
end;
$$;

revoke all on function public.rpc_my_activity_timeline(int) from public;
grant execute on function public.rpc_my_activity_timeline(int) to authenticated;
