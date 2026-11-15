-- 0037_admin_ban_delete_message | P2.2 / FR-ADMIN-004 + FR-ADMIN-005
-- admin_ban_user        — permanent ban; rejects self-ban and admin-vs-admin.
-- admin_delete_message  — hard-deletes a single user-kind chat message;
--                         refuses kind='system' (audit immutability).
--
-- Both: SECURITY DEFINER + is_admin(auth.uid()) gate + REVOKE FROM PUBLIC +
--       GRANT TO authenticated. Each writes its own audit_events row (no
--       existing trigger covers ban_user / delete_message actions).

-- ── 1. admin_ban_user ───────────────────────────────────────────────────────

create or replace function public.admin_ban_user(
  p_target_user_id uuid,
  p_reason         text,
  p_note           text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_admin(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_actor = p_target_user_id then
    raise exception 'cannot_ban_self' using errcode = 'P0013';
  end if;
  -- Privilege-escalation guard: an admin cannot ban another admin. Without
  -- this an admin with a compromised session could lock peer admins out of
  -- moderation. Belt-and-braces alongside any UI-side gating.
  if exists (select 1 from public.users
             where user_id = p_target_user_id and is_super_admin = true) then
    raise exception 'cannot_ban_admin' using errcode = 'P0014';
  end if;
  if p_reason not in ('spam','harassment','policy_violation','other') then
    raise exception 'invalid_ban_reason' using errcode = 'P0015';
  end if;

  -- Clear account_status_until: a permanent ban supersedes any prior
  -- suspension timer. Otherwise a banned row keeps misleading until-data
  -- visible to audit/admin views.
  update public.users
     set account_status       = 'banned',
         account_status_until = null
   where user_id = p_target_user_id and account_status <> 'banned';
  if not found then
    return;  -- already banned, no audit (idempotent re-ban)
  end if;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'ban_user', 'user', p_target_user_id,
          jsonb_build_object('reason', p_reason, 'note', p_note, 'permanent', true));
end;
$$;

revoke execute on function public.admin_ban_user(uuid, text, text) from public;
grant  execute on function public.admin_ban_user(uuid, text, text) to authenticated;


-- ── 2. admin_delete_message ─────────────────────────────────────────────────

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
  if v_actor is null or not public.is_admin(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

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
