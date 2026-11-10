-- Social graph · follow RPCs and the privacy mode switch
--
-- A follow edge and a follow request are never inserted from a device: these functions
-- decide which of the two a "follow" becomes and who may resolve a request. Errors are
-- raised with SQLSTATE P0001 and a stable snake_case message.

-- The signed-in caller, who must hold an active account: a member waiting for verification,
-- under a sanction or pending deletion cannot act on the social graph.
create function kc_private.require_active_caller()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
begin
  if not exists (select 1 from public.users u where u.id = v_user_id and u.is_active) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  return v_user_id;
end;
$$;
comment on function kc_private.require_active_caller() is
  'Returns auth.uid(); raises unless the caller is signed in with an active account.';

-- Follows a member: an edge at once on a public profile (FR-FOLLOW-001), a pending request
-- on a private one (FR-FOLLOW-003). Returns 'following' or 'requested'; repeating the call
-- returns the same answer without a second row.
create function public.follow_user(p_target uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_target public.users;
  v_cooldown_until timestamptz;
begin
  if p_target = v_user_id then
    raise exception 'self_follow_forbidden' using errcode = 'P0001';
  end if;

  -- The share lock makes a concurrent privacy switch of the target wait for this call.
  select u.* into v_target from public.users u where u.id = p_target for share;
  if not found or not v_target.is_active then
    raise exception 'user_unavailable' using errcode = 'P0001';
  end if;
  if kc_access.is_blocked_between(v_user_id, p_target) then
    raise exception 'blocked_relationship' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.follows f
              where f.follower_id = v_user_id and f.followed_id = p_target) then
    return 'following';
  end if;
  if v_target.privacy_mode = 'Public' then
    insert into public.follows (follower_id, followed_id) values (v_user_id, p_target)
    on conflict do nothing;
    return 'following';
  end if;

  if exists (select 1 from public.follow_requests r
              where r.requester_id = v_user_id and r.target_id = p_target and r.status = 'pending') then
    return 'requested';
  end if;

  -- 14 days after a rejection the requester may ask again (FR-FOLLOW-008); the detail
  -- carries the end of the cooldown for the "try again in N days" hint.
  select max(r.cooldown_until) into v_cooldown_until
    from public.follow_requests r
   where r.requester_id = v_user_id and r.target_id = p_target
     and r.status = 'rejected' and r.cooldown_until > now();
  if v_cooldown_until is not null then
    raise exception 'follow_request_cooldown_active' using
      errcode = 'P0001',
      detail = 'cooldown_until='
        || to_char(v_cooldown_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  insert into public.follow_requests (requester_id, target_id) values (v_user_id, p_target)
  on conflict (requester_id, target_id) where status = 'pending' do nothing;
  return 'requested';
end;
$$;
comment on function public.follow_user(uuid) is
  'Follows a member: an edge on a public profile, a pending request on a private one.';
grant execute on function public.follow_user(uuid) to authenticated;

-- The target accepts or silently rejects a pending request (FR-FOLLOW-005, FR-FOLLOW-006).
create function public.follow_request_decide(p_requester uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_moved boolean;
begin
  if p_accept is null then
    raise exception 'invalid_decision' using errcode = 'P0001';
  end if;

  perform set_config('kc.fsm_role', 'target', true);
  update public.follow_requests r
     set status = case when p_accept then 'accepted' else 'rejected' end
   where r.requester_id = p_requester and r.target_id = v_user_id and r.status = 'pending';
  v_moved := found;
  perform set_config('kc.fsm_role', '', true);

  if not v_moved then
    raise exception 'follow_request_not_pending' using errcode = 'P0001';
  end if;
end;
$$;
comment on function public.follow_request_decide(uuid, boolean) is
  'The caller accepts or rejects a pending follow request addressed to them.';
grant execute on function public.follow_request_decide(uuid, boolean) to authenticated;

-- The requester withdraws their own pending request; no cooldown follows (FR-FOLLOW-004).
create function public.follow_request_cancel(p_target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_moved boolean;
begin
  perform set_config('kc.fsm_role', 'requester', true);
  update public.follow_requests r
     set status = 'cancelled'
   where r.requester_id = v_user_id and r.target_id = p_target and r.status = 'pending';
  v_moved := found;
  perform set_config('kc.fsm_role', '', true);

  if not v_moved then
    raise exception 'follow_request_not_pending' using errcode = 'P0001';
  end if;
end;
$$;
comment on function public.follow_request_cancel(uuid) is 'The caller withdraws their pending follow request.';
grant execute on function public.follow_request_cancel(uuid) to authenticated;

-- Switches the caller's profile between 'Public' and 'Private' (FR-PROFILE-005/006).
-- The switch is not retroactive for posts or existing followers. Going public accepts every
-- pending request in the same transaction; none of them can be from a blocked member,
-- because a block withdraws the requests between its two members.
create function public.set_privacy_mode(p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
begin
  if p_mode is null or p_mode not in ('Public', 'Private') then
    raise exception 'invalid_privacy_mode' using errcode = 'P0001';
  end if;

  update public.users u
     set privacy_mode = p_mode, privacy_changed_at = now()
   where u.id = v_user_id and u.privacy_mode <> p_mode;
  if not found or p_mode = 'Private' then
    return;
  end if;

  perform set_config('kc.fsm_role', 'target', true);
  update public.follow_requests r
     set status = 'accepted'
   where r.target_id = v_user_id and r.status = 'pending';
  perform set_config('kc.fsm_role', '', true);
end;
$$;
comment on function public.set_privacy_mode(text) is
  'Sets the caller''s privacy mode; going public accepts all pending follow requests.';
grant execute on function public.set_privacy_mode(text) to authenticated;
