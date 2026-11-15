-- 0121_reports_case_detail_rpc | FR-ADMIN-013
-- Per-case detail RPC for the A1 admin reports dashboard.
--
-- Returns one JSON object:
--   { target_type, target_id, target, reporters[], timeline[] }
-- where:
--   target     — preview of the target row (post / user / chat) or {}
--   reporters  — every report on this target (open OR resolved), ordered oldest→newest
--   timeline   — every audit_events row on this target, ordered newest→oldest
--
-- RBAC: super_admin / moderator / support.

create or replace function public.reports_case_detail(
  p_target_type text,
  p_target_id   uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor     uuid := auth.uid();
  v_target    jsonb;
  v_reporters jsonb;
  v_timeline  jsonb;
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator','support']);

  if p_target_type not in ('post','user','chat') or p_target_id is null then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  if p_target_type = 'post' then
    select jsonb_build_object(
      'preview',    left(coalesce(p.title, p.description, ''), 280),
      'status',     p.status,
      'author_id',  p.owner_id,
      'created_at', p.created_at
    ) into v_target
    from public.posts p where p.post_id = p_target_id;
  elsif p_target_type = 'user' then
    select jsonb_build_object(
      'display_name', u.display_name,
      'status',       u.account_status,
      'created_at',   u.created_at
    ) into v_target
    from public.users u where u.user_id = p_target_id;
  elsif p_target_type = 'chat' then
    select jsonb_build_object(
      'removed_at', c.removed_at
    ) into v_target
    from public.chats c where c.chat_id = p_target_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'report_id',     r.report_id,
    'reporter_id',   r.reporter_id,
    'reporter_name', u.display_name,
    'reason',        r.reason,
    'note',          r.note,
    'status',        r.status,
    'created_at',    r.created_at,
    'resolved_at',   r.resolved_at,
    'resolved_by',   r.resolved_by
  ) order by r.created_at asc), '[]'::jsonb)
    into v_reporters
    from public.reports r
    left join public.users u on u.user_id = r.reporter_id
   where r.target_type = p_target_type
     and r.target_id   = p_target_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id',   e.event_id,
    'actor_id',   e.actor_id,
    'action',     e.action,
    'metadata',   e.metadata,
    'created_at', e.created_at
  ) order by e.created_at desc), '[]'::jsonb)
    into v_timeline
    from public.audit_events e
   where e.target_type = p_target_type
     and e.target_id   = p_target_id;

  return jsonb_build_object(
    'target_type', p_target_type,
    'target_id',   p_target_id,
    'target',      coalesce(v_target, '{}'::jsonb),
    'reporters',   v_reporters,
    'timeline',    v_timeline
  );
end;
$$;

revoke execute on function public.reports_case_detail(text, uuid) from public;
grant  execute on function public.reports_case_detail(text, uuid) to authenticated;
