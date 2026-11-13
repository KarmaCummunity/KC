-- Identity · staff set a member's verification level (FR-VERIFY, D116)
--
-- Verified-only features (events that require an identity document, worlds that require
-- verification: users.verification_level 2+) were unreachable after the cut-over because
-- nothing could raise the level. An admin (or super admin) now sets it after checking the
-- member's document outside the product, with a reason; every change is audited. A member
-- never sets their own level, and the platform badge (3) stays a super admin's decision.
-- Errors: forbidden (42501), invalid_input, self_verification, user_not_found (P0001).

create function public.admin_set_verification_level(p_user_id uuid, p_level smallint, p_reason text)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('admin');
  v_reason constant text := nullif(btrim(p_reason), '');
  v_before smallint;
begin
  if p_level is null or p_level not between 0 and 3 or v_reason is null or char_length(v_reason) > 500 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_user_id = v_actor then
    raise exception 'self_verification' using errcode = 'P0001';
  end if;
  if p_level = 3 and not kc_access.has_admin_role('super_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.verification_level into v_before from public.users u where u.id = p_user_id for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;
  if v_before = p_level then
    return p_level;
  end if;
  update public.users u set verification_level = p_level where u.id = p_user_id;
  perform kc_private.audit_record('verification_level_set', 'user', p_user_id,
    jsonb_build_object('from', v_before, 'to', p_level, 'reason', v_reason), v_actor);
  return p_level;
end;
$$;
comment on function public.admin_set_verification_level(uuid, smallint, text) is
  'Admin sets a member''s verification level (3 needs a super admin), with a reason; audited.';
grant execute on function public.admin_set_verification_level(uuid, smallint, text) to authenticated;
