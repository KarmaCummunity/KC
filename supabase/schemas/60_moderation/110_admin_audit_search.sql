-- Moderation · the audit screen (FR-ADMIN-007)
--
-- The audit trail is not exposed as a table: staff read it through this function, newest
-- first, one keyset page at a time. Rows carry ids only; the screen resolves names through
-- the profiles it may read.
--   super admin   every event
--   moderator     events they made and events about them
--   support       events they made

create function public.admin_audit_search(
  p_target_id uuid default null,
  p_actor_id uuid default null,
  p_action text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  -- Keyset cursor: occurred_at and id of the last row of the previous page.
  p_before_occurred_at timestamptz default null,
  p_before_id bigint default null,
  p_limit integer default 50
)
returns table (
  id bigint,
  occurred_at timestamptz,
  actor_id uuid,
  action text,
  target_type text,
  target_id uuid,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('support');
  v_sees_all constant boolean := kc_access.has_admin_role('super_admin');
  v_sees_about_self constant boolean := kc_access.has_admin_role('moderator');
begin
  return query
  select e.id, e.occurred_at, e.actor_id, e.action, e.target_type, e.target_id, e.metadata
    from audit.events e
   where (p_target_id is null or e.target_id = p_target_id)
     and (p_actor_id is null or e.actor_id = p_actor_id)
     and (p_action is null or e.action = p_action)
     and (p_from is null or e.occurred_at >= p_from)
     and (p_to is null or e.occurred_at < p_to)
     and (p_before_occurred_at is null
          or (e.occurred_at, e.id) < (p_before_occurred_at, coalesce(p_before_id, 9223372036854775807)))
     and (v_sees_all or e.actor_id = v_actor or (v_sees_about_self and e.target_id = v_actor))
   order by e.occurred_at desc, e.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
comment on function public.admin_audit_search(uuid, uuid, text, timestamptz, timestamptz, timestamptz, bigint, integer) is
  'Staff: keyset-paginated search of the audit trail, scoped by the caller''s role.';
grant execute on function public.admin_audit_search(uuid, uuid, text, timestamptz, timestamptz, timestamptz, bigint, integer)
  to authenticated;
