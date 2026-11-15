-- 0124_admin_delete_message_rbac | FR-ADMIN-010, FR-ADMIN-013
--
-- Widen admin_delete_message from legacy is_admin() to RBAC, matching
-- PERMISSION_MATRIX[chat.delete_message] = ['super_admin','moderator'].
--
-- Every other semantic from 0037 is preserved verbatim:
--   * idempotent no-op when the message row is already gone.
--   * kind='system' guard with SQLSTATE P0016 (cannot_delete_system_message)
--     — admins cannot erase audit-bearing system messages.
--   * hard DELETE of the message row.
--   * single audit_events row: action='delete_message', target_type='chat',
--     target_id=v_chat, metadata={message_id: <id>}.
--
-- Only the top-level role check changes:
--   before: if v_actor is null or not public.is_admin(v_actor) then
--             raise exception 'forbidden' using errcode = '42501';
--           end if;
--   after:  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);
--
-- admin_assert_role itself raises 'forbidden' / 42501 on miss, so the wire
-- contract for clients is preserved.

create or replace function public.admin_delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_chat  uuid;
  v_kind  text;
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  select chat_id, kind into v_chat, v_kind
    from public.messages where message_id = p_message_id;
  if not found then
    return;  -- already gone; idempotent
  end if;
  if v_kind = 'system' then
    raise exception 'cannot_delete_system_message' using errcode = 'P0016';
  end if;

  delete from public.messages where message_id = p_message_id;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'delete_message', 'chat', v_chat,
          jsonb_build_object('message_id', p_message_id));
end;
$$;

revoke execute on function public.admin_delete_message(uuid) from public;
grant  execute on function public.admin_delete_message(uuid) to authenticated;
