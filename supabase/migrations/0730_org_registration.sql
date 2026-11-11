-- 0730_org_registration | Organizations, first slice (FR-ORG-002, G18; PM decision D139)
--
-- An organization's event is published by a member of the organization (D22, D31), and until now
-- no one could become a member: nothing submitted an organization application, and approving one
-- created nothing (0168 deferred it). This slice makes the path real:
--
-- 1. Audit allow-lists: the 0168 decision writes `target_type = 'org_application'`, which the
--    0468 target check never listed, so every approve / reject rolled back. Both the target types
--    (`org_application`, `organization`) and the member actions are added.
-- 2. `org_applications` gains `org_id` (the organization an approval created) and
--    `declared_nonprofit` (FR-ORG-002 AC2 step 7).
-- 3. `kc_private.org_slug_for(name)`: transliterated kebab-case slug, unique (FR-ORG-001 AC5).
-- 4. `submit_org_application(...)`: a signed-in member applies; one open application at a time,
--    a new one at most once per 7 days after a rejection (FR-ORG-002 AC3–AC4).
-- 5. `admin_org_application_decide`: an approval creates the organization and makes the
--    applicant its first `org_admin` member (FR-ORG-002 AC5); either decision notifies the
--    applicant (`org_registration_decided`). The organization's own sign-in account
--    (FR-ORG-002 AC5) is a later slice.
-- 6. Members: `list_org_members`, `org_add_member`, `org_remove_member`. An organization admin or
--    manager adds a member by their share handle and removes one; anyone may leave; the last
--    admin stays. One membership row per member.

-- ── 1. Audit allow-lists ───────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_new text;
begin
  -- Target types: the printed check is `CHECK ((target_type = ANY (ARRAY[...])))`.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.audit_events'::regclass
     and c.conname = 'audit_events_target_type_check';
  if v_def is null then
    raise exception 'audit_events_target_type_check not found';
  end if;
  if v_def not like '%''organization''%' then
    v_new := replace(v_def, ']))', ', ''org_application''::text, ''organization''::text]))');
    if v_new = v_def then
      raise exception 'unexpected audit_events_target_type_check definition: %', v_def;
    end if;
    alter table public.audit_events drop constraint audit_events_target_type_check;
    execute format('alter table public.audit_events add constraint audit_events_target_type_check %s not valid', v_new);
    alter table public.audit_events validate constraint audit_events_target_type_check;
  end if;

  -- Actions: same printed shape, keeping every existing action.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.audit_events'::regclass
     and c.conname = 'audit_events_action_check';
  if v_def is null then
    raise exception 'audit_events_action_check not found';
  end if;
  if v_def not like '%org_member_add%' then
    v_new := replace(v_def, ']))', ', ''org_member_add''::text, ''org_member_remove''::text]))');
    if v_new = v_def then
      raise exception 'unexpected audit_events_action_check definition: %', v_def;
    end if;
    alter table public.audit_events drop constraint audit_events_action_check;
    execute format('alter table public.audit_events add constraint audit_events_action_check %s not valid', v_new);
    alter table public.audit_events validate constraint audit_events_action_check;
  end if;
end $$;

-- ── 2. Application columns ─────────────────────────────────────────────────────
alter table public.org_applications
  add column if not exists org_id uuid references public.organizations(org_id) on delete set null,
  add column if not exists declared_nonprofit boolean not null default false;

comment on column public.org_applications.org_id is
  'FR-ORG-002 (0730): the organization this application''s approval created.';
comment on column public.org_applications.declared_nonprofit is
  'FR-ORG-002 AC2 (0730): the applicant declared the organization operates on a non-profit basis.';

-- An applicant has at most one open application.
create unique index if not exists org_applications_one_pending_uidx
  on public.org_applications (applicant_user_id)
  where status = 'pending';

-- ── 3. Slug for a new organization ─────────────────────────────────────────────
-- Hebrew letters map to Latin (final forms included), everything else outside a–z / 0–9 becomes a
-- dash. A name with no usable letters falls back to `org`. A taken slug gets `-2`, `-3`, …
create or replace function kc_private.org_slug_for(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_slug text;
  v_n    int := 1;
begin
  v_base := lower(translate(
    coalesce(p_name, ''),
    'אבגדהוזחטיכךלמםנןסעפףצץקרשת',
    'abgdhvzhtykklmmnnsappcckrst'));
  v_base := btrim(regexp_replace(v_base, '[^a-z0-9]+', '-', 'g'), '-');
  v_base := btrim(left(v_base, 50), '-');
  if v_base = '' then
    v_base := 'org';
  end if;

  v_slug := v_base;
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  end loop;
  return v_slug;
end;
$$;

comment on function kc_private.org_slug_for(text) is
  'FR-ORG-001 AC5 (0730): a unique, transliterated kebab-case slug (≤ 60 chars) for a new organization.';

revoke all on function kc_private.org_slug_for(text) from public, anon, authenticated;

-- ── 4. submit_org_application ──────────────────────────────────────────────────
-- Errors: unauthenticated (42501); org_name_invalid, org_description_required,
-- org_contact_email_invalid, org_website_invalid, org_nonprofit_declaration_required (23514);
-- org_application_pending_exists, org_application_resubmit_too_soon (23505 / 23514).
create or replace function public.submit_org_application(
  p_org_name           text,
  p_org_description    text,
  p_contact_email      text,
  p_contact_phone      text default null,
  p_website_url        text default null,
  p_declared_nonprofit boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text := btrim(coalesce(p_org_name, ''));
  v_about   text := nullif(btrim(coalesce(p_org_description, '')), '');
  v_email   text := lower(btrim(coalesce(p_contact_email, '')));
  v_phone   text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_site    text := nullif(btrim(coalesce(p_website_url, '')), '');
  v_last    timestamptz;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if char_length(v_name) not between 2 and 120 then
    raise exception 'org_name_invalid' using errcode = '23514';
  end if;
  if v_about is null or char_length(v_about) > 4000 then
    raise exception 'org_description_required' using errcode = '23514';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then
    raise exception 'org_contact_email_invalid' using errcode = '23514';
  end if;
  -- Only a secure link without credentials or whitespace (the same rule as support channels).
  if v_site is not null and (v_site !~ '^https://[^\s@]+$' or char_length(v_site) > 2000) then
    raise exception 'org_website_invalid' using errcode = '23514';
  end if;
  if v_phone is not null and char_length(v_phone) > 20 then
    v_phone := left(v_phone, 20);
  end if;
  if not coalesce(p_declared_nonprofit, false) then
    raise exception 'org_nonprofit_declaration_required' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.org_applications a
     where a.applicant_user_id = v_uid and a.status = 'pending'
  ) then
    raise exception 'org_application_pending_exists' using errcode = '23505';
  end if;
  -- After a rejection the applicant may apply again once 7 days have passed (FR-ORG-002 AC4).
  select max(a.reviewed_at) into v_last
    from public.org_applications a
   where a.applicant_user_id = v_uid and a.status = 'rejected';
  if v_last is not null and v_last > now() - interval '7 days' then
    raise exception 'org_application_resubmit_too_soon' using errcode = '23514';
  end if;

  insert into public.org_applications (
    applicant_user_id, org_name, org_description, contact_email, contact_phone, website_url,
    declared_nonprofit
  ) values (
    v_uid, v_name, v_about, v_email, v_phone, v_site, true
  )
  returning application_id into v_id;
  return v_id;
end;
$$;

comment on function public.submit_org_application(text, text, text, text, text, boolean) is
  'FR-ORG-002 (0730): the caller applies to register an organization; one open application at a time, again at most 7 days after a rejection.';

revoke all on function public.submit_org_application(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.submit_org_application(text, text, text, text, text, boolean) to authenticated;

-- ── 5. The decision creates the organization ───────────────────────────────────
-- Same signature and errors as 0168, plus the approval side effects.
create or replace function public.admin_org_application_decide(
  p_application_id uuid,
  p_approve        boolean,
  p_note           text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_curr    public.org_applications;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_org_id  uuid;
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator']);

  select * into v_curr from public.org_applications
   where application_id = p_application_id
   for update;
  if not found then
    raise exception 'application_not_found' using errcode = 'P0002';
  end if;
  if v_curr.status <> 'pending' then
    raise exception 'application_already_decided' using errcode = '22023';
  end if;

  if p_approve then
    -- The organization, with the applicant as its first admin member.
    insert into public.organizations (name, slug, public_about_he)
    values (left(v_curr.org_name, 120), kc_private.org_slug_for(v_curr.org_name), v_curr.org_description)
    returning org_id into v_org_id;

    insert into public.org_memberships (org_id, user_id, role)
    values (v_org_id, v_curr.applicant_user_id, 'org_admin');
  end if;

  update public.org_applications
     set status      = case when p_approve then 'approved' else 'rejected' end,
         reviewed_at = now(),
         reviewed_by = v_actor,
         review_note = v_note,
         org_id      = v_org_id
   where application_id = p_application_id;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    case when p_approve then 'org_application_approve' else 'org_application_reject' end,
    'org_application',
    p_application_id,
    jsonb_strip_nulls(jsonb_build_object(
      'org_name',          v_curr.org_name,
      'applicant_user_id', v_curr.applicant_user_id,
      'org_id',            v_org_id,
      'note',              v_note
    ))
  );

  perform public.enqueue_notification(
    v_curr.applicant_user_id, 'critical', 'org_registration_decided',
    case when p_approve then 'notifications.orgRegistrationApprovedTitle'
         else 'notifications.orgRegistrationRejectedTitle' end,
    case when p_approve then 'notifications.orgRegistrationApprovedBody'
         else 'notifications.orgRegistrationRejectedBody' end,
    jsonb_build_object('orgName', v_curr.org_name, 'note', coalesce(v_note, '')),
    jsonb_build_object('route', '/settings/organizations'),
    'org_registration_decided:' || p_application_id::text,
    true
  );
end;
$$;

comment on function public.admin_org_application_decide(uuid, boolean, text) is
  'FR-ORG-002 (0730): decides a pending application; an approval creates the organization with the applicant as its first org_admin; the applicant is notified either way.';

revoke execute on function public.admin_org_application_decide(uuid, boolean, text) from public, anon;
grant  execute on function public.admin_org_application_decide(uuid, boolean, text) to authenticated;

-- ── 6. Members ─────────────────────────────────────────────────────────────────
-- The member's role in an organization, or null. One row per member is the rule from this slice
-- on; an older second row (unique per role, 0264) resolves to the strongest role.
create or replace function kc_private.org_member_role(p_org_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
    from public.org_memberships m
   where m.org_id = p_org_id and m.user_id = p_user_id
   order by case m.role
              when 'org_admin' then 0 when 'org_manager' then 1 when 'org_employee' then 2
              else 3 end
   limit 1;
$$;

comment on function kc_private.org_member_role(uuid, uuid) is
  'FR-ORG (0730): the member''s strongest role in the organization, or null when not a member.';

revoke all on function kc_private.org_member_role(uuid, uuid) from public, anon, authenticated;

-- The members of an organization, for its own members (a public team list is FR-ORG-011, opt-in).
-- Errors: unauthenticated (42501), org_not_member (42501).
create or replace function public.list_org_members(p_org_id uuid)
returns table (
  user_id      uuid,
  display_name text,
  share_handle text,
  avatar_url   text,
  role         text,
  joined_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if kc_private.org_member_role(p_org_id, v_uid) is null then
    raise exception 'org_not_member' using errcode = '42501';
  end if;

  return query
  select distinct on (m.user_id)
         m.user_id, u.display_name, u.share_handle, u.avatar_url, m.role, m.created_at
    from public.org_memberships m
    join public.users u on u.user_id = m.user_id
   where m.org_id = p_org_id
   order by m.user_id,
            case m.role when 'org_admin' then 0 when 'org_manager' then 1
                        when 'org_employee' then 2 else 3 end;
end;
$$;

comment on function public.list_org_members(uuid) is
  'FR-ORG (0730): an organization''s members with their role, readable by its members only.';

revoke all on function public.list_org_members(uuid) from public, anon;
grant execute on function public.list_org_members(uuid) to authenticated;

-- Adds a member by share handle, or changes the role of an existing one.
-- An admin or manager may add employees and volunteers; only an admin adds managers and admins.
-- Errors: unauthenticated (42501), org_member_manage_forbidden (42501), org_role_invalid (22023),
-- org_member_user_not_found (P0002), org_last_admin (23514).
create or replace function public.org_add_member(
  p_org_id       uuid,
  p_share_handle text,
  p_role         text default 'org_volunteer'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_my_role   text;
  v_target    uuid;
  v_previous  text;
  v_org_name  text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_role not in ('org_admin', 'org_manager', 'org_employee', 'org_volunteer') then
    raise exception 'org_role_invalid' using errcode = '22023';
  end if;

  v_my_role := kc_private.org_member_role(p_org_id, v_uid);
  if v_my_role is null
     or v_my_role not in ('org_admin', 'org_manager')
     or (p_role in ('org_admin', 'org_manager') and v_my_role <> 'org_admin') then
    raise exception 'org_member_manage_forbidden' using errcode = '42501';
  end if;

  select u.user_id into v_target
    from public.users u
   -- Handles compare case-insensitively (0251); a leading `@` is accepted.
   where lower(u.share_handle) = lower(ltrim(btrim(coalesce(p_share_handle, '')), '@'))
     and u.account_status = 'active';
  if v_target is null then
    raise exception 'org_member_user_not_found' using errcode = 'P0002';
  end if;

  v_previous := kc_private.org_member_role(p_org_id, v_target);
  if v_previous = p_role then
    return v_target;
  end if;
  -- Demoting the last admin would leave the organization without one.
  if v_previous = 'org_admin' and not exists (
    select 1 from public.org_memberships m
     where m.org_id = p_org_id and m.role = 'org_admin' and m.user_id <> v_target
  ) then
    raise exception 'org_last_admin' using errcode = '23514';
  end if;

  -- One row per member: the new role replaces any earlier one.
  delete from public.org_memberships where org_id = p_org_id and user_id = v_target;
  insert into public.org_memberships (org_id, user_id, role) values (p_org_id, v_target, p_role);

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_uid, 'org_member_add', 'organization', p_org_id,
          jsonb_strip_nulls(jsonb_build_object(
            'user_id', v_target, 'role', p_role, 'previous_role', v_previous)));

  -- A new member hears that they joined; a role change is not announced.
  if v_previous is null then
    select o.name into v_org_name from public.organizations o where o.org_id = p_org_id;
    perform public.enqueue_notification(
      v_target, 'social', 'org_member_added',
      'notifications.orgMemberAddedTitle', 'notifications.orgMemberAddedBody',
      jsonb_build_object('orgName', coalesce(v_org_name, '')),
      jsonb_build_object('route', '/settings/organizations'),
      'org_member_added:' || p_org_id::text || ':' || v_target::text,
      false
    );
  end if;
  return v_target;
end;
$$;

comment on function public.org_add_member(uuid, text, text) is
  'FR-ORG (0730): an organization admin or manager adds a member by share handle or changes their role; the new member is notified.';

revoke all on function public.org_add_member(uuid, text, text) from public, anon;
grant execute on function public.org_add_member(uuid, text, text) to authenticated;

-- Removes a member. A member may leave; an admin removes anyone, a manager removes employees and
-- volunteers. The last admin stays.
-- Errors: unauthenticated (42501), org_member_manage_forbidden (42501),
-- org_member_not_found (P0002), org_last_admin (23514).
create or replace function public.org_remove_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_my_role     text;
  v_target_role text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_target_role := kc_private.org_member_role(p_org_id, p_user_id);
  if v_target_role is null then
    raise exception 'org_member_not_found' using errcode = 'P0002';
  end if;

  if p_user_id <> v_uid then
    v_my_role := kc_private.org_member_role(p_org_id, v_uid);
    if v_my_role is null
       or v_my_role not in ('org_admin', 'org_manager')
       or (v_target_role in ('org_admin', 'org_manager') and v_my_role <> 'org_admin') then
      raise exception 'org_member_manage_forbidden' using errcode = '42501';
    end if;
  end if;

  if v_target_role = 'org_admin' and not exists (
    select 1 from public.org_memberships m
     where m.org_id = p_org_id and m.role = 'org_admin' and m.user_id <> p_user_id
  ) then
    raise exception 'org_last_admin' using errcode = '23514';
  end if;

  delete from public.org_memberships where org_id = p_org_id and user_id = p_user_id;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_uid, 'org_member_remove', 'organization', p_org_id,
          jsonb_build_object('user_id', p_user_id, 'role', v_target_role,
                             'left', p_user_id = v_uid));
end;
$$;

comment on function public.org_remove_member(uuid, uuid) is
  'FR-ORG (0730): removes a member (or the caller leaves); the last admin stays.';

revoke all on function public.org_remove_member(uuid, uuid) from public, anon;
grant execute on function public.org_remove_member(uuid, uuid) to authenticated;
