-- supabase/tests/0730_org_registration.sql
-- Organizations, first slice (FR-ORG-002, G18): a member applies, an approval creates the
-- organization with the applicant as its first admin, and the admin manages members.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('org_applicant') as applicant,
       kc_test.create_user('org_rejected')  as rejected,
       kc_test.create_user('org_volunteer') as volunteer,
       kc_test.create_user('org_manager')   as manager,
       kc_test.create_user('org_outsider')  as outsider,
       kc_test.create_user('org_reviewer')  as reviewer;

-- A moderator decides applications (0168); only one super admin may exist, so the test uses one.
insert into public.admin_role_grants (user_id, role) select reviewer, 'moderator' from personas;

create temp table app_ids (application_id uuid, org_id uuid);

-- ── 1. Applying: validation and one open application at a time ─────────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.applicant);

  perform kc_test.assert_raises(
    $q$select public.submit_org_application('Food Bank', 'We share food', 'team@foodbank.org.il', null, null, false)$q$,
    'org_nonprofit_declaration_required', 'the non-profit declaration is required');
  perform kc_test.assert_raises(
    $q$select public.submit_org_application('Food Bank', 'We share food', 'team@foodbank.org.il', null, 'http://foodbank.org.il', true)$q$,
    'org_website_invalid', 'only a secure website link');
  perform kc_test.assert_raises(
    $q$select public.submit_org_application('Food Bank', 'We share food', 'not-an-email', null, null, true)$q$,
    'org_contact_email_invalid', 'a contact email is required');

  v := public.submit_org_application(
    'בנק המזון השכונתי', 'We collect and share surplus food.', 'Team@FoodBank.org.il',
    '050-0000000', 'https://foodbank.org.il', true);
  insert into app_ids (application_id) values (v);

  perform kc_test.assert_raises(
    $q$select public.submit_org_application('Second Org', 'Another one', 'x@y.org', null, null, true)$q$,
    'org_application_pending_exists', 'one open application per member');
end $$;

-- ── 2. Approval creates the organization; the applicant is its first admin ──────
do $$
declare
  p personas;
  a app_ids;
  v_org public.organizations;
begin
  select * into p from personas;
  select * into a from app_ids;

  perform kc_test.act_as(p.reviewer);
  perform public.admin_org_application_approve(a.application_id, 'Welcome');

  select o.* into v_org
    from public.organizations o
    join public.org_applications x on x.org_id = o.org_id
   where x.application_id = a.application_id;
  perform kc_test.assert_true(v_org.org_id is not null, 'the approval created the organization');
  perform kc_test.assert_eq(v_org.slug, 'bnk-hmzvn-hskvnty', 'the slug is the transliterated name');
  perform kc_test.assert_eq(
    (select role from public.org_memberships where org_id = v_org.org_id and user_id = p.applicant),
    'org_admin', 'the applicant is the first admin');
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where user_id = p.applicant and kind = 'org_registration_decided'),
    1::bigint, 'the applicant is told the outcome');
  perform kc_test.assert_eq(
    (select count(*) from public.audit_events
      where action = 'org_application_approve' and target_id = a.application_id),
    1::bigint, 'the approval is audited');

  update app_ids set org_id = v_org.org_id;
end $$;

-- ── 3. A rejection: the applicant may apply again only after 7 days ─────────────
do $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.rejected);
  v := public.submit_org_application('Rejected Org', 'Not yet', 'r@rejected.org', null, null, true);

  perform kc_test.act_as(p.reviewer);
  perform public.admin_org_application_reject(v, 'Missing details');
  perform kc_test.assert_true(
    (select org_id is null from public.org_applications where application_id = v),
    'a rejection creates no organization');

  perform kc_test.act_as(p.rejected);
  perform kc_test.assert_raises(
    $q$select public.submit_org_application('Rejected Org', 'Again', 'r@rejected.org', null, null, true)$q$,
    'org_application_resubmit_too_soon', 'a new application waits 7 days after a rejection');
end $$;

-- ── 4. Members: add by handle, roles, removal, the last admin stays ─────────────
do $$
declare
  p personas;
  a app_ids;
  v_handle text;
begin
  select * into p from personas;
  select * into a from app_ids;

  perform kc_test.act_as(p.applicant);
  select share_handle into v_handle from public.users where user_id = p.volunteer;
  perform public.org_add_member(a.org_id, '@' || upper(v_handle), 'org_volunteer');
  select share_handle into v_handle from public.users where user_id = p.manager;
  perform public.org_add_member(a.org_id, v_handle, 'org_manager');

  perform kc_test.assert_eq(
    (select count(*) from public.list_org_members(a.org_id)), 3::bigint, 'three members');
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where user_id = p.volunteer and kind = 'org_member_added'),
    1::bigint, 'a new member is told they joined');

  -- A manager adds volunteers but not admins; a volunteer adds no one.
  perform kc_test.act_as(p.manager);
  select share_handle into v_handle from public.users where user_id = p.outsider;
  perform kc_test.assert_raises(
    format('select public.org_add_member(%L, %L, %L)', a.org_id, v_handle, 'org_admin'),
    'org_member_manage_forbidden', 'a manager does not add admins');
  perform kc_test.act_as(p.volunteer);
  perform kc_test.assert_raises(
    format('select public.org_add_member(%L, %L, %L)', a.org_id, v_handle, 'org_volunteer'),
    'org_member_manage_forbidden', 'a volunteer does not add members');

  -- An outsider does not read the member list.
  perform kc_test.act_as(p.outsider);
  perform kc_test.assert_raises(
    format('select * from public.list_org_members(%L)', a.org_id),
    'org_not_member', 'members only');

  -- The last admin can neither leave nor be demoted; a member may leave.
  perform kc_test.act_as(p.applicant);
  perform kc_test.assert_raises(
    format('select public.org_remove_member(%L, %L)', a.org_id, p.applicant),
    'org_last_admin', 'the last admin stays');
  perform kc_test.act_as(p.volunteer);
  perform public.org_remove_member(a.org_id, p.volunteer);
  perform kc_test.assert_eq(
    (select count(*) from public.org_memberships where org_id = a.org_id and user_id = p.volunteer),
    0::bigint, 'a member may leave');
end $$;

rollback;
