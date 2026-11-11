-- 0167_admin_audit_search_date_range — V2-ADMIN-AUDIT-5 — date range on audit search.
--
-- Extends `admin_audit_search` with `p_from` / `p_to` so admins can scope by
-- time (e.g. "all ban actions from last 7 days"). Existing callers stay
-- compatible — both new params default to NULL.

drop function if exists public.admin_audit_search(uuid, uuid, text, int, int);

create or replace function public.admin_audit_search(
  p_target_user_id uuid default null,
  p_actor_id       uuid default null,
  p_action         text default null,
  p_limit          int  default 100,
  p_offset         int  default 0,
  p_from           timestamptz default null,
  p_to             timestamptz default null
)
returns table (
  event_id     uuid,
  actor_id     uuid,
  actor_display_name text,
  action       text,
  target_type  text,
  target_id    uuid,
  target_display_name text,
  metadata     jsonb,
  created_at   timestamptz,
  total_count  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_lim   int  := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_off   int  := greatest(coalesce(p_offset, 0), 0);
  v_is_super boolean;
  v_is_mod   boolean;
  v_total bigint;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);
  v_is_super := public.has_admin_role(v_actor, 'super_admin');
  v_is_mod   := public.has_admin_role(v_actor, 'moderator');

  select count(*) into v_total
    from public.audit_events e
   where (p_target_user_id is null or e.target_id = p_target_user_id)
     and (p_actor_id       is null or e.actor_id  = p_actor_id)
     and (p_action         is null or e.action    = p_action)
     and (p_from           is null or e.created_at >= p_from)
     and (p_to             is null or e.created_at <= p_to)
     and (
       v_is_super
       or (v_is_mod and (e.actor_id = v_actor or e.target_id = v_actor))
       or (not v_is_super and not v_is_mod and e.actor_id = v_actor)
     );

  return query
  select
    e.event_id,
    e.actor_id,
    ua.display_name as actor_display_name,
    e.action,
    e.target_type,
    e.target_id,
    ut.display_name as target_display_name,
    e.metadata,
    e.created_at,
    v_total as total_count
  from public.audit_events e
  left join public.users ua on ua.user_id = e.actor_id
  left join public.users ut on ut.user_id = e.target_id
  where (p_target_user_id is null or e.target_id = p_target_user_id)
    and (p_actor_id       is null or e.actor_id  = p_actor_id)
    and (p_action         is null or e.action    = p_action)
    and (p_from           is null or e.created_at >= p_from)
    and (p_to             is null or e.created_at <= p_to)
    and (
      v_is_super
      or (v_is_mod and (e.actor_id = v_actor or e.target_id = v_actor))
      or (not v_is_super and not v_is_mod and e.actor_id = v_actor)
    )
  order by e.created_at desc
  limit v_lim offset v_off;
end;
$$;

comment on function public.admin_audit_search(uuid, uuid, text, int, int, timestamptz, timestamptz) is
  'V2-ADMIN-AUDIT-5 — same as 0149 plus optional p_from / p_to time bounds.';

revoke execute on function public.admin_audit_search(uuid, uuid, text, int, int, timestamptz, timestamptz) from public;
grant  execute on function public.admin_audit_search(uuid, uuid, text, int, int, timestamptz, timestamptz) to authenticated;
