-- Organizations · registration from the app and the team screen (FR-ORG-002, G18, D139)
--
-- The two member-facing flows of an organization:
--   1. A member applies to register one (`submit_org_application`); staff decide in
--      030_org_applications.sql, and the applicant becomes the first org_admin.
--   2. An organization's administrators keep its team (`list_org_members`, `org_add_member`,
--      `org_remove_member`). The team is the organization-scoped role grants of
--      60_moderation; these functions are the member-facing front of them, so grants, audit
--      and the `org_memberships` projection stay the single mechanism.
--
-- The screen knows four roles: org_admin, org_manager, org_employee, org_volunteer. A member
-- holding only another organization role (volunteer_manager, treasurer, …) is listed as the
-- nearest of the four. Rules (FR-ORG, G18):
--   * an admin or a manager adds employees and volunteers; only an admin adds managers and admins;
--   * a member may leave; an admin removes anyone, a manager removes employees and volunteers;
--   * the last admin stays;
--   * adding a member again with another role replaces their roles in that organization.
-- Errors: unauthenticated / org_not_member / org_member_manage_forbidden (42501); P0001 —
-- org_name_invalid, org_description_required, org_contact_email_invalid, org_website_invalid,
-- org_nonprofit_declaration_required, org_application_pending_exists,
-- org_application_resubmit_too_soon, org_role_invalid, org_member_user_not_found,
-- org_member_not_found, org_last_admin.

insert into kc_private.notification_kinds (kind, category, title_key, body_key) values
  -- The member was added to an organization's team (a role change is not announced).
  ('org_member_added', 'social', 'notifications.orgMemberAddedTitle', 'notifications.orgMemberAddedBody');

-- The role of the four the team screen shows for a set of organization roles.
create function kc_private.org_display_role(p_roles text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when 'org_admin' = any (p_roles) then 'org_admin'
    when p_roles && array['org_manager', 'operators_manager', 'volunteer_manager'] then 'org_manager'
    when p_roles && array['org_employee', 'operator', 'org_treasurer', 'org_accountant'] then 'org_employee'
    else 'org_volunteer'
  end;
$$;
comment on function kc_private.org_display_role(text[]) is
  'Maps a member''s organization roles to the nearest of org_admin, org_manager, org_employee, org_volunteer.';

-- A member applies to register an organization. One application waits at a time, and a new
-- one is accepted 7 days after a rejection (FR-ORG-002 AC3-AC4). Returns the application id.
create function public.submit_org_application(
  p_org_name text,
  p_org_description text,
  p_contact_email text,
  p_contact_phone text default null,
  p_website_url text default null,
  p_declared_nonprofit boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid constant uuid := kc_private.require_active_caller();
  v_name constant text := btrim(coalesce(p_org_name, ''));
  v_about constant text := nullif(btrim(coalesce(p_org_description, '')), '');
  v_email constant text := lower(btrim(coalesce(p_contact_email, '')));
  v_phone constant text := left(nullif(btrim(coalesce(p_contact_phone, '')), ''), 20);
  v_site constant text := nullif(btrim(coalesce(p_website_url, '')), '');
  v_last timestamptz;
  v_id uuid;
begin
  if char_length(v_name) not between 2 and 120 then
    raise exception 'org_name_invalid' using errcode = 'P0001';
  end if;
  if v_about is null or char_length(v_about) > 4000 then
    raise exception 'org_description_required' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then
    raise exception 'org_contact_email_invalid' using errcode = 'P0001';
  end if;
  -- Only a secure link without credentials or whitespace.
  if v_site is not null and (v_site !~ '^https://[^\s@]+$' or char_length(v_site) > 2000) then
    raise exception 'org_website_invalid' using errcode = 'P0001';
  end if;
  if not coalesce(p_declared_nonprofit, false) then
    raise exception 'org_nonprofit_declaration_required' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.org_applications a where a.applicant_id = v_uid and a.status = 'pending') then
    raise exception 'org_application_pending_exists' using errcode = 'P0001';
  end if;
  select max(a.reviewed_at) into v_last
    from public.org_applications a where a.applicant_id = v_uid and a.status = 'rejected';
  if v_last is not null and v_last > now() - interval '7 days' then
    raise exception 'org_application_resubmit_too_soon' using errcode = 'P0001';
  end if;

  insert into public.org_applications
    (applicant_id, org_name, org_description, contact_email, contact_phone, website_url, declared_nonprofit)
  values (v_uid, v_name, v_about, v_email, v_phone, v_site, true)
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.submit_org_application(text, text, text, text, text, boolean) is
  'The caller applies to register an organization; one open application, again 7 days after a rejection.';
grant execute on function public.submit_org_application(text, text, text, text, text, boolean) to authenticated;

-- The team of an organization, for its own members.
create function public.list_org_members(p_org_id uuid)
returns table (
  user_id uuid, display_name text, share_handle text, avatar_url text, role text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid constant uuid := kc_private.require_active_caller();
begin
  if not exists (select 1 from public.org_memberships m where m.org_id = p_org_id and m.user_id = v_uid) then
    raise exception 'org_not_member' using errcode = '42501';
  end if;
  return query
  select m.user_id, u.display_name, u.share_handle, u.avatar_url,
         kc_private.org_display_role(m.roles), m.joined_at
    from public.org_memberships m
    join public.users u on u.id = m.user_id
   where m.org_id = p_org_id
   order by m.joined_at, m.user_id;
end;
$$;
comment on function public.list_org_members(uuid) is 'The team of an organization with each member''s role; members only.';
grant execute on function public.list_org_members(uuid) to authenticated;

-- Ends every active organization grant of a member and moves the grants that reported to
-- them one level up, as admin_revoke_role does.
create function kc_private.org_team_revoke(p_org_id uuid, p_user_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant record;
begin
  for v_grant in
    select g.id, g.manager_grant_id from public.admin_role_grants g
     where g.scope_org_id = p_org_id and g.user_id = p_user_id and g.revoked_at is null
       for update
  loop
    update public.admin_role_grants g set revoked_at = now(), revoked_by = p_actor where g.id = v_grant.id;
    update public.admin_role_grants g set manager_grant_id = v_grant.manager_grant_id
     where g.manager_grant_id = v_grant.id and g.revoked_at is null;
  end loop;
end;
$$;

-- Adds a member by share handle, or changes the role of one who is already on the team.
-- Returns the member's id.
create function public.org_add_member(p_org_id uuid, p_share_handle text, p_role text default 'org_volunteer')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_active_caller();
  v_my_roles text[];
  v_target uuid;
  v_previous text;
  v_manager_grant uuid;
  v_org_name text;
begin
  if p_role is null or p_role not in ('org_admin', 'org_manager', 'org_employee', 'org_volunteer') then
    raise exception 'org_role_invalid' using errcode = 'P0001';
  end if;
  select m.roles into v_my_roles from public.org_memberships m where m.org_id = p_org_id and m.user_id = v_actor;
  if v_my_roles is null
     or not (v_my_roles && array['org_admin', 'org_manager'])
     or (p_role in ('org_admin', 'org_manager') and not ('org_admin' = any (v_my_roles))) then
    raise exception 'org_member_manage_forbidden' using errcode = '42501';
  end if;

  -- Handles compare case-insensitively; a leading @ is accepted.
  select u.id into v_target from public.users u
   where u.share_handle = lower(ltrim(btrim(coalesce(p_share_handle, '')), '@')) and u.is_active;
  if v_target is null then
    raise exception 'org_member_user_not_found' using errcode = 'P0001';
  end if;

  select kc_private.org_display_role(m.roles) into v_previous
    from public.org_memberships m where m.org_id = p_org_id and m.user_id = v_target;
  if v_previous = p_role then
    return v_target;
  end if;
  -- Demoting the last admin would leave the organization without one.
  if v_previous = 'org_admin' and not exists (
       select 1 from public.org_memberships m
        where m.org_id = p_org_id and m.user_id <> v_target and 'org_admin' = any (m.roles)) then
    raise exception 'org_last_admin' using errcode = 'P0001';
  end if;

  -- The new grant reports to the caller's most senior grant in this organization.
  select g.id into v_manager_grant
    from public.admin_role_grants g join kc_private.admin_roles r on r.role = g.role
   where g.user_id = v_actor and g.scope_org_id = p_org_id and g.revoked_at is null
   order by r.rank desc limit 1;
  perform kc_private.org_team_revoke(p_org_id, v_target, v_actor);
  insert into public.admin_role_grants (user_id, role, scope_org_id, granted_by, manager_grant_id)
  values (v_target, p_role, p_org_id, v_actor, v_manager_grant);

  if v_previous is null then
    select o.name into v_org_name from public.organizations o where o.id = p_org_id;
    perform kc_private.outbox_enqueue('notification', jsonb_build_object(
      'kind', 'org_member_added', 'recipient_id', v_target, 'actor_id', v_actor,
      'entity', jsonb_build_object('type', 'organization', 'id', p_org_id),
      'data', jsonb_build_object('orgName', coalesce(v_org_name, ''), 'organization_id', p_org_id,
                                 'dedupe_key', 'org_member_added:' || p_org_id || ':' || v_target)));
  end if;
  return v_target;
end;
$$;
comment on function public.org_add_member(uuid, text, text) is
  'An organization admin or manager adds a member by share handle or changes their role; a new member is notified.';
grant execute on function public.org_add_member(uuid, text, text) to authenticated;

-- Removes a member from the team; the caller removes themselves to leave.
create function public.org_remove_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_active_caller();
  v_my_roles text[];
  v_target_roles text[];
begin
  select m.roles into v_target_roles from public.org_memberships m where m.org_id = p_org_id and m.user_id = p_user_id;
  if v_target_roles is null then
    raise exception 'org_member_not_found' using errcode = 'P0001';
  end if;
  if p_user_id <> v_actor then
    select m.roles into v_my_roles from public.org_memberships m where m.org_id = p_org_id and m.user_id = v_actor;
    if v_my_roles is null
       or not (v_my_roles && array['org_admin', 'org_manager'])
       or (v_target_roles && array['org_admin', 'org_manager'] and not ('org_admin' = any (v_my_roles))) then
      raise exception 'org_member_manage_forbidden' using errcode = '42501';
    end if;
  end if;
  if 'org_admin' = any (v_target_roles) and not exists (
       select 1 from public.org_memberships m
        where m.org_id = p_org_id and m.user_id <> p_user_id and 'org_admin' = any (m.roles)) then
    raise exception 'org_last_admin' using errcode = 'P0001';
  end if;
  perform kc_private.org_team_revoke(p_org_id, p_user_id, v_actor);
end;
$$;
comment on function public.org_remove_member(uuid, uuid) is
  'Removes a member from an organization''s team (or the caller leaves); the last admin stays.';
grant execute on function public.org_remove_member(uuid, uuid) to authenticated;
