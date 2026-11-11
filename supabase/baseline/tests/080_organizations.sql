-- Organizations: an application is reviewed by platform admins and its approval creates
-- the organization with its first admin; memberships follow the role grants; members
-- publish for their organization and its administrators edit and delete its posts; the
-- open foreign keys of earlier modules are closed; donation links go live after review.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Shorthand inside SQL text: @x the member with hex digit x, #title a post, &slug an
-- organization. Posts and organizations are resolved as the database owner.
create function pg_temp.expand(p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '#(\w+)', 'g') loop
    v_sql := regexp_replace(v_sql, '#' || v_match[1] || '\M', coalesce(quote_literal((
      select p.id from public.posts p where p.title = v_match[1])), 'null') || '::uuid');
  end loop;
  for v_match in select regexp_matches(p_sql, '&([a-z-]+)', 'g') loop
    v_sql := regexp_replace(v_sql, '&' || v_match[1] || '\M', coalesce(quote_literal((
      select o.id from public.organizations o where o.slug = v_match[1])), 'null') || '::uuid');
  end loop;
  return regexp_replace(v_sql, '@([0-9a-f])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
end;
$$;

create function pg_temp.become(p_who text)
returns void
language plpgsql
as $$
begin
  if p_who is null or p_who = 'none' then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
  else
    perform set_config('request.jwt.claims', case when p_who in ('anon', 'service_role')
      then jsonb_build_object('role', p_who)
      else jsonb_build_object('sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated') end::text, true);
    perform set_config('role', case when p_who in ('anon', 'service_role') then p_who else 'authenticated' end, true);
  end if;
end;
$$;

-- Called again after the role was switched, to switch back.
grant execute on function pg_temp.become(text) to public;

-- Runs a statement as a member, `anon` or `service_role`: 'ok', the P0001 message, or the SQLSTATE.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
begin
  begin
    perform pg_temp.become(p_who);
    execute v_sql;
    perform pg_temp.become('none');
    return 'ok';
  exception when others then
    perform pg_temp.become('none');
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- One value read as a member, or as the database owner when p_who is null.
create function pg_temp.val(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
  v_value text;
begin
  perform pg_temp.become(p_who);
  execute v_sql into v_value;
  perform pg_temp.become('none');
  return v_value;
end;
$$;

-- Audit events of an action.
create function pg_temp.audited(p_action text)
returns bigint
language sql
as $$
  select count(*) from audit.events e where e.action = p_action;
$$;

select plan(74);

-- a super admin · b moderator · d platform admin · e applicant, then admin of `helpers` ·
-- f its manager · c its volunteer · 3 its employee · 1, 2 members outside it.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(string_to_array('a,b,c,d,e,f,1,2,3', ',')) x;
insert into public.admin_role_grants (user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'super_admin'), ('00000000-0000-4000-8000-00000000000b', 'moderator'),
  ('00000000-0000-4000-8000-00000000000d', 'admin');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items'), ('time', 'time', 'Time');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values
  ('items', 'item', 'item', 'Item', 'either'), ('time', 'event', 'e', 'e', 'offer');
insert into public.organizations (slug, name, is_platform) values ('kc', 'Karma Community', true);

-- ── Applications and their review ───────────────────────────────────────────
select is(pg_temp.act('e', $$select public.submit_org_application('Helpers', 'We help.', 'Helpers@Mail.test', null, null, true)$$),
  'ok', 'a member applies to register an organization');
select is(pg_temp.val(null, $$select contact_email || '|' || (org_type is null) from public.org_applications$$), 'helpers@mail.test|true',
  'the contact is stored in lower case and the form needs no organization type');
select is(pg_temp.act('e', $$select public.submit_org_application('Helpers again', 'We help.', 'h@mail.test', null, null, true)$$)
  || '|' || pg_temp.act('1', $$insert into public.org_applications (applicant_id, org_name, org_type, declared_nonprofit)
    values (@1, 'Direct', 'public_body', true)$$)
  || '|' || pg_temp.act('1', $$insert into public.org_applications (applicant_id, org_name, org_type, declared_nonprofit, status)
    values (@1, 'Self approved', 'public_body', true, 'approved')$$)
  || '|' || pg_temp.act('1', $$select public.submit_org_application('For profit', 'We earn.', 'p@mail.test', null, null, false)$$)
  || '|' || pg_temp.act(null, $$select public.submit_org_application('Anon', 'We help.', 'a@mail.test', null, null, true)$$),
  'org_application_pending_exists|42501|42501|org_nonprofit_declaration_required|42501',
  'one pending application each, no direct insert, always the declaration, signed-in members only');
select is(pg_temp.act('1', $$select public.submit_org_application('X', 'We help.', 'p@mail.test', null, null, true)$$)
  || '|' || pg_temp.act('1', $$select public.submit_org_application('Valid name', ' ', 'p@mail.test', null, null, true)$$)
  || '|' || pg_temp.act('1', $$select public.submit_org_application('Valid name', 'We help.', 'not an email', null, null, true)$$)
  || '|' || pg_temp.act('1', $$select public.submit_org_application('Valid name', 'We help.', 'p@mail.test', null, 'http://x.org', true)$$),
  'org_name_invalid|org_description_required|org_contact_email_invalid|org_website_invalid',
  'the form is validated with a stable code per field');
select is(pg_temp.val('e', 'select count(*) from public.org_applications') || pg_temp.val('1', 'select count(*) from public.org_applications')
  || pg_temp.val('b', 'select count(*) from public.org_applications') || pg_temp.val('d', 'select count(*) from public.org_applications')
  || pg_temp.act('anon', 'select 1 from public.org_applications'),
  '100142501', 'the applicant and platform admins read an application; a moderator, a member and a signed-out caller do not');
select is(pg_temp.act('b', $$select public.admin_org_application_approve((select id from public.org_applications), 'helpers')$$)
  || pg_temp.act('e', $$select public.admin_org_application_approve((select id from public.org_applications), 'helpers')$$)
  || pg_temp.act('e', $$update public.org_applications set status = 'approved'$$),
  '425014250142501', 'a moderator, the applicant and a direct update decide nothing');
select is(pg_temp.act('d', $$select public.admin_org_application_approve((select id from public.org_applications), 'kc')$$)
  || '|' || pg_temp.act('d', $$select public.admin_org_application_approve(gen_random_uuid(), 'x')$$),
  'slug_taken|application_not_found', 'an approval needs a free slug and a real application');
select is(pg_temp.act('d', $$select public.admin_org_application_approve((select id from public.org_applications), 'helpers', 'welcome')$$),
  'ok', 'a platform admin approves');
select is(pg_temp.val(null, $$select o.status || '|' || o.verification_level || '|' || o.verification_method || '|' || o.is_verified_nonprofit
      || '|' || (a.organization_id = o.id) || '|' || a.status || '|' || (a.reviewed_by = @d)
    from public.organizations o, public.org_applications a where o.slug = 'helpers'$$),
  'active|1|manual|false|true|approved|true', 'the approval creates the organization, verified at level 1, and records the decision');
select is(pg_temp.val(null, $$select array_to_string(roles, ',') from public.org_memberships where org_id = &helpers and user_id = @e$$),
  'org_admin', 'the applicant becomes the first administrator');
select is(pg_temp.audited('org_application_approve') || '|' || pg_temp.audited('org_create') || '|'
  || (select count(*) from kc_private.outbox_events e where e.topic = 'notification'
       and e.payload ->> 'kind' = 'org_application_decided' and e.payload ->> 'recipient_id' = '00000000-0000-4000-8000-00000000000e'),
  '1|2|1', 'the approval is audited and the applicant is told');
select is(pg_temp.act('d', $$select public.admin_org_application_reject((select id from public.org_applications))$$),
  'application_already_decided', 'a decision is final');
select is(pg_temp.act('1', $$select public.submit_org_application('Copy', 'We help.', 'c@mail.test', null, null, true)$$)
  || pg_temp.act('d', $$select public.admin_org_application_reject((select id from public.org_applications where applicant_id = @1), ' not yet ')$$)
  || '|' || pg_temp.val('1', $$select status || ':' || review_note from public.org_applications$$)
  || '|' || pg_temp.audited('org_application_reject'),
  'okok|rejected:not yet|1', 'a rejection keeps the note for the applicant and creates nothing');
select throws_ok($$update public.org_applications set status = 'pending'$$, 'P0001', 'illegal_transition', 'a decided application never reopens');
select throws_ok($$insert into public.org_applications (applicant_id, org_name, org_type, declared_nonprofit, status)
    values ('00000000-0000-4000-8000-000000000002', 'Odd', 'public_body', true, 'odd')$$, 'P0001', 'unknown_state', 'the machine knows its states');
insert into public.org_applications (id, applicant_id, org_name, org_type, declared_nonprofit)
values ('70000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Third', 'public_body', true);
select throws_ok($$update public.org_applications set status = 'approved', reviewed_at = now()
    where id = '70000000-0000-4000-8000-000000000001'$$, 'P0001', 'forbidden_role', 'only the admin role moves an application');

-- ── Memberships follow the role grants ──────────────────────────────────────
select is(pg_temp.act('e', $$select public.admin_grant_role(@f, 'org_manager', &helpers)$$)
  || pg_temp.act('e', $$select public.admin_grant_role(@c, 'org_volunteer', &helpers)$$)
  || pg_temp.act('e', $$select public.admin_grant_role(@3, 'org_employee', &helpers)$$)
  || pg_temp.act('e', $$select public.admin_grant_role(@3, 'org_accountant', &helpers)$$)
  || pg_temp.act('f', $$select public.admin_grant_role(@1, 'org_treasurer', &helpers)$$), 'okokokok42501',
  'the organization admin builds the team, finance roles included; a manager grants no finance role');
select is(pg_temp.val(null, $$select string_agg(right(user_id::text, 1) || ':' || array_to_string(roles, '+'), ' ' order by user_id)
    from public.org_memberships where org_id = &helpers$$),
  '3:org_employee+org_accountant c:org_volunteer e:org_admin f:org_manager', 'each member holds their active roles, most senior first');
-- The team screen: an organization's administrator reads the grants of their own
-- organization and nobody else's; an ordinary member of the team sees only their own grant.
select is(pg_temp.val('e', $$select count(*) from public.admin_role_grants where scope_org_id = &helpers$$)::int > 3,
  true, 'an organization administrator reads the grants of their organization');
select is(pg_temp.val('e', $$select count(*) from public.admin_role_grants where scope_org_id is distinct from &helpers and user_id <> @e$$),
  '0', 'and not those of any other organization or the platform');
select is(pg_temp.val('c', $$select count(*) from public.admin_role_grants where scope_org_id = &helpers and user_id <> @c$$),
  '0', 'a volunteer of the team sees only their own grant');
select is(pg_temp.act(null, $$update public.admin_role_grants set revoked_at = now()
      where user_id = @3 and role = 'org_accountant'$$)
  || pg_temp.val(null, $$select array_to_string(roles, '+') from public.org_memberships where user_id = @3$$),
  'okorg_employee', 'a revoked grant leaves the membership');
select is(pg_temp.val('c', 'select count(*) from public.org_memberships') || pg_temp.val('f', 'select count(*) from public.org_memberships')
  || pg_temp.val('1', 'select count(*) from public.org_memberships') || pg_temp.val('b', 'select count(*) from public.org_memberships'),
  '1404', 'a member reads their own membership; administrators and platform staff read the roster');
select is(pg_temp.act('c', $$update public.org_memberships set can_post = true$$)
  || pg_temp.val(null, $$select can_post from public.org_memberships where user_id = @c$$)
  || pg_temp.act('f', $$update public.org_memberships set roles = array['org_admin'] where user_id = @f$$),
  'okfalse42501', 'a member cannot give themself the right to publish, and nobody edits roles directly');

-- ── The organization row ────────────────────────────────────────────────────
select is(pg_temp.val('1', 'select count(*) from public.organizations') || pg_temp.act('anon', 'select 1 from public.organizations'),
  '242501', 'members read active organizations; signed-out callers read nothing');
select is(pg_temp.act('f', $$update public.organizations set public_about_he = 'about' where slug = 'helpers'$$)
  || pg_temp.act('3', $$update public.organizations set public_about_he = 'mine' where slug = 'helpers'$$)
  || pg_temp.act('f', $$update public.organizations set public_tagline_en = 'x' where slug = 'kc'$$)
  || pg_temp.val(null, $$select string_agg(coalesce(public_about_he, '-') || coalesce(public_tagline_en, '-'), ',' order by slug) from public.organizations$$),
  'okokokabout-,--', 'only the administrators of an organization edit its profile');
select is(pg_temp.act('e', $$update public.organizations set is_verified_nonprofit = true$$)
  || pg_temp.act('e', $$update public.organizations set name = 'Other'$$)
  || pg_temp.act('e', $$select public.admin_set_org_verification(&helpers, 2::smallint, true)$$),
  '425014250142501', 'verification, name and status are not the organization''s to change');
select is(pg_temp.act('d', $$select public.admin_set_org_verification(&helpers, 2::smallint, true, 'document')$$)
  || pg_temp.val(null, $$select verification_level || '|' || is_verified_nonprofit || '|' || (verified_by = @d) from public.organizations where slug = 'helpers'$$)
  || '|' || pg_temp.audited('org_verification_set'), 'ok2|true|true|1', 'a platform admin sets the verification, audited');
select is(pg_temp.act('d', $$select public.admin_set_org_status(&helpers, 'suspended')$$)
  || pg_temp.val('1', 'select count(*) from public.organizations') || pg_temp.val('c', 'select count(*) from public.organizations')
  || pg_temp.val('b', 'select count(*) from public.organizations') || '|' || pg_temp.audited('org_status_changed'),
  'ok122|1', 'a suspended organization is hidden from members, not from its own members or staff');
select is(pg_temp.act('c', $$insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id, beneficiary_org_id)
    select @c, 'items', id, 'offer', 'suspended', 'c1', &helpers from public.post_kinds where slug = 'item'$$),
  '42501', 'nobody publishes for a suspended organization');
select is(pg_temp.act('d', $$select public.admin_set_org_status(&helpers, 'closed')$$)
  || '|' || pg_temp.act('e', $$select public.admin_set_org_status(&helpers, 'active')$$)
  || '|' || pg_temp.act('d', $$select public.admin_set_org_status(&helpers, 'active')$$),
  'unknown_state|42501|ok', 'only a platform admin reinstates it, along the machine');
select throws_ok($$update public.organizations set status = 'suspended' where slug = 'kc'$$, 'P0001', 'forbidden_role',
  'the status moves in the admin role only');
select throws_ok($$update public.organizations set sec46_status = 'active' where slug = 'kc'$$, '23514', null,
  'an active Section 46(a) approval needs its number and dates');

-- ── Foreign keys left open by earlier modules ───────────────────────────────
select throws_ok($$insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id, beneficiary_org_id)
    select '00000000-0000-4000-8000-000000000001', 'items', id, 'offer', 'fk', 'c1', gen_random_uuid() from public.post_kinds where slug = 'item'$$,
  '23503', null, 'a post names a real organization');
select throws_ok($$insert into public.user_profile_fields (user_id, field_key, visibility, affiliated_org_id)
    values ('00000000-0000-4000-8000-000000000001', 'affiliated_org', 'everyone', gen_random_uuid())$$,
  '23503', null, 'an affiliation names a real organization');
select throws_ok($$insert into public.admin_role_grants (user_id, role, scope_org_id)
    values ('00000000-0000-4000-8000-000000000001', 'org_admin', gen_random_uuid())$$,
  '23503', null, 'an organization role names a real organization');
select is((select count(*) from pg_indexes where indexname in ('posts_beneficiary_org_idx',
    'user_profile_fields_affiliated_org_idx', 'admin_role_grants_scope_idx')), 3::bigint, 'each of the three is indexed');

-- ── Publishing for an organization ──────────────────────────────────────────
select is(pg_temp.act('1', $$insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id, beneficiary_org_id)
    select @1, 'items', id, 'offer', 'outsider', 'c1', &helpers from public.post_kinds where slug = 'item'$$)
  || pg_temp.act('c', $$insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id, beneficiary_org_id)
    select @c, 'items', id, 'offer', 'volunteer', 'c1', &helpers from public.post_kinds where slug = 'item'$$),
  '4250142501', 'an outsider and a volunteer without the publishing right cannot publish for the organization');
select is(pg_temp.act('f', $$update public.org_memberships set can_post = true where user_id = @c$$)
  || pg_temp.act('c', $$insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id, beneficiary_org_id)
    select @c, 'items', id, 'offer', 'orgpost', 'c1', &helpers from public.post_kinds where slug = 'item'$$)
  || pg_temp.act('c', $$insert into public.posts (owner_id, world_slug, kind_id, direction, status, visibility, title, city_id, beneficiary_org_id)
    select @c, 'items', id, 'offer', 'draft', 'OnlyMe', 'orgdraft', 'c1', &helpers from public.post_kinds where slug = 'item'$$),
  'okokok', 'an administrator lets the volunteer publish, and they do');
select is(pg_temp.act('1', $$insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id)
    select @1, 'items', id, 'offer', 'own', 'c1' from public.post_kinds where slug = 'item'$$)
  || pg_temp.act('1', $$select public.set_post_organization(#own, &helpers)$$)
  || '|' || pg_temp.act('3', $$select public.set_post_organization(#own, &helpers)$$),
  'ok42501|post_not_found', 'a post is attached only by its manager, to an organization they may act for');
select is(pg_temp.act('3', $$insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id)
    select @3, 'items', id, 'offer', 'staffpost', 'c1' from public.post_kinds where slug = 'item'$$)
  || pg_temp.act('3', $$select public.set_post_organization(#staffpost, &helpers)$$)
  || pg_temp.val(null, $$select beneficiary_org_id = &helpers from public.posts where title = 'staffpost'$$)
  || pg_temp.act('3', $$select public.set_post_organization(#staffpost, null)$$)
  || pg_temp.val(null, $$select beneficiary_org_id is null from public.posts where title = 'staffpost'$$),
  'okoktrueoktrue', 'an employee attaches their post to the organization and detaches it');

-- ── Administrators edit and delete the organization's posts ─────────────────
select is(pg_temp.val('f', $$select count(*) from public.posts where title = 'orgdraft'$$)
  || pg_temp.val('3', $$select count(*) from public.posts where title = 'orgdraft'$$)
  || pg_temp.val('2', $$select count(*) from public.posts where title = 'orgdraft'$$),
  '100', 'the administrators see every post of the organization, drafts included; other members of it do not');
select is(pg_temp.act('f', $$update public.posts set description = 'by manager' where id = #orgpost$$)
  || pg_temp.act('3', $$update public.posts set description = 'by employee' where id = #orgpost$$)
  || pg_temp.act('2', $$update public.posts set description = 'by outsider' where id = #orgpost$$)
  || pg_temp.act('f', $$update public.posts set description = 'not ours' where id = #own$$)
  || pg_temp.val(null, $$select string_agg(coalesce(description, '-'), ',' order by title) from public.posts where title in ('orgpost', 'own')$$),
  'okokokokby manager,-', 'an administrator edits a post of the organization; an employee, an outsider and other posts are untouched');
select is(pg_temp.act('f', $$update public.posts set status = 'paused' where id = #orgpost$$), '42501', 'the status still moves through RPCs only');
select is(pg_temp.act('a', $$update public.posts set description = 'by super admin' where id = #own$$)
  || pg_temp.val(null, $$select description from public.posts where title = 'own'$$), 'okby super admin', 'the super admin edits every post');
select is(pg_temp.val('f', $$select kc_access.can_edit_post(#orgpost) || '|' || kc_access.can_edit_post(#own)$$)
  || '|' || pg_temp.val('c', $$select kc_access.can_edit_post(#orgpost)$$)
  || '|' || pg_temp.val('a', $$select kc_access.can_edit_post(#own)$$), 'true|false|false|true',
  'can_edit_post: an administrator for the organization''s posts, the super admin for all; the owner is not its subject');
select is(pg_temp.act('c', $$select public.create_post_with_details(
      jsonb_build_object('world_slug', 'time', 'post_type', 'event', 'direction', 'offer', 'title', 'orgevent', 'city_id', 'c1',
        'kind_id', (select id from public.post_kinds where slug = 'event')),
      jsonb_build_object('starts_at', now() + interval '1 day', 'ends_at', now() + interval '1 day 2 hours', 'capacity', 5))$$)
  || pg_temp.act('c', $$select public.set_post_organization(#orgevent, &helpers)$$), 'okok', 'a member publishes an event for the organization');
select is(pg_temp.act('f', $$update public.post_event_details set capacity = 7 where post_id = #orgevent$$)
  || pg_temp.val(null, $$select capacity from public.post_event_details where post_id = #orgevent$$)
  || pg_temp.act('3', $$update public.post_event_details set capacity = 8 where post_id = #orgevent$$)
  || pg_temp.act('2', $$update public.post_event_details set capacity = 9 where post_id = #orgevent$$)
  || pg_temp.val(null, $$select capacity from public.post_event_details where post_id = #orgevent$$)
  || pg_temp.act('a', $$update public.post_event_details set capacity = 10 where post_id = #orgevent$$)
  || pg_temp.val(null, $$select capacity from public.post_event_details where post_id = #orgevent$$),
  'ok7okok7ok10', 'the event''s details follow the same rule: administrators and the super admin, nobody else');
select is((select count(*) from pg_policies where policyname like '%\_editor' and qual like '%can_edit_post%'
    and tablename in ('posts', 'post_ride_details', 'post_housing_details', 'post_event_details', 'post_food_details', 'post_knowledge_slots')
    and cmd in ('UPDATE', 'DELETE')), 7::bigint, 'posts, the four detail tables and the knowledge slots share the one predicate');
select is(pg_temp.act('2', $$select public.delete_post(#orgpost)$$) || '|' || pg_temp.act('3', $$select public.delete_post(#orgpost)$$)
  || '|' || pg_temp.act('f', $$select public.pause_post(#orgpost)$$) || pg_temp.act('f', $$select public.delete_post(#orgpost)$$)
  || '|' || pg_temp.val(null, $$select status from public.posts where title = 'orgpost'$$),
  'post_not_found|post_not_found|okok|deleted_no_recipient', 'an administrator pauses and deletes a post of the organization; others cannot');
select is(pg_temp.act('f', $$update public.posts set description = 'late' where id = #orgpost$$)
  || pg_temp.val(null, $$select description from public.posts where title = 'orgpost'$$), 'okby manager',
  'a deleted post is no longer editable by the administrators');
select is(pg_temp.act('f', $$select public.delete_post(#own)$$), 'post_not_found', 'an administrator manages no post outside the organization');

-- ── Directory ───────────────────────────────────────────────────────────────
update public.organizations set is_verified_nonprofit = true where slug = 'kc';
insert into public.organizations (slug, name, is_verified_nonprofit) values ('aid', 'Aid', true), ('plain', 'Plain', false);
select is(pg_temp.val('1', $$select string_agg(slug, ',' order by name) from public.list_verified_nonprofits()$$)
  || '|' || pg_temp.val('1', $$select string_agg(slug, ',') from public.list_verified_nonprofits(1, 'Aid', &aid)$$)
  || '|' || pg_temp.act('anon', $$select public.list_verified_nonprofits()$$),
  'aid,helpers|helpers|42501', 'the directory lists verified nonprofits by name with keyset pages, for signed-in members');

-- ── Donation links ──────────────────────────────────────────────────────────
insert into public.donation_link_categories (slug, icon_name, sort_order) values ('food', 'restaurant-outline', 1);
select is(pg_temp.act('1', $$insert into public.donation_links (category_slug, url, display_name, submitted_by, validated_at)
    values ('food', 'https://example.org', 'Food bank', @1, now())$$), '42501', 'a device never writes a link');
select is(pg_temp.act('service_role', $$insert into public.donation_links (id, category_slug, url, display_name, submitted_by, validated_at, review_status)
    values ('80000000-0000-4000-8000-000000000001', 'food', 'https://example.org', 'Food bank', @1, now(), 'approved')$$)
  || pg_temp.val(null, 'select review_status from public.donation_links'), 'okpending', 'a link written by the Edge Function always starts in the queue');
select is(pg_temp.val('1', 'select count(*) from public.donation_links') || pg_temp.val('2', 'select count(*) from public.donation_links')
  || pg_temp.val('b', 'select count(*) from public.donation_links') || pg_temp.act('anon', 'select 1 from public.donation_links'),
  '10142501', 'a pending link is read by its submitter and by moderators only');
select is(pg_temp.act('2', $$select public.admin_review_donation_link('80000000-0000-4000-8000-000000000001', true)$$)
  || '|' || pg_temp.act('service_role', $$update public.donation_links set review_status = 'approved'$$)
  || '|' || pg_temp.act('b', $$select public.admin_review_donation_link('80000000-0000-4000-8000-000000000001', true)$$)
  || '|' || pg_temp.act('b', $$select public.admin_review_donation_link('80000000-0000-4000-8000-000000000001', false, 'no')$$)
  || '|' || pg_temp.val('2', 'select count(*) from public.donation_links') || '|' || pg_temp.audited('donation_link_review'),
  '42501|forbidden_role|ok|donation_link_not_pending|1|1', 'only a moderator approves, once, through the review RPC; then everyone sees the link');
select is(pg_temp.act('service_role', $$update public.donation_links set validated_at = now()$$)
  || pg_temp.val(null, 'select review_status from public.donation_links')
  || pg_temp.act('service_role', $$update public.donation_links set display_name = 'Food bank 2'$$)
  || pg_temp.val(null, $$select review_status || (reviewed_by is null) from public.donation_links$$),
  'okapprovedokpendingtrue', 'an edit of the content sends the link back to review; a revalidation does not');
select is(pg_temp.act('b', $$select public.admin_review_donation_link('80000000-0000-4000-8000-000000000001', false, ' broken ')$$)
  || pg_temp.val('1', $$select review_status || ':' || review_note from public.donation_links$$)
  || pg_temp.val('2', 'select count(*) from public.donation_links'), 'okrejected:broken0', 'a rejection shows its note to the submitter only');
select is(pg_temp.act('2', $$select public.report_donation_link('80000000-0000-4000-8000-000000000001')$$)
  || '|' || pg_temp.act('1', $$select public.report_donation_link('80000000-0000-4000-8000-000000000001')$$)
  || '|' || pg_temp.val(null, $$select m.system_payload ->> 'kind' from public.messages m join public.chats c on c.id = m.chat_id
       where c.kind = 'support' and c.support_user_id = @1$$),
  'donation_link_not_found|ok|donation_link_reported', 'a report of a visible link lands in the reporter''s support thread');
select is(pg_temp.act('2', 'delete from public.donation_links') || pg_temp.val(null, 'select count(*) from public.donation_links')
  || pg_temp.act('1', 'delete from public.donation_links') || pg_temp.val(null, 'select count(*) from public.donation_links'),
  'ok1ok0', 'the submitter removes their link; another member cannot');


-- ── Registration from the app and the team screen ───────────────────────────
select is(kc_private.org_slug_for('קהילת חסד') || '|' || kc_private.org_slug_for('') || '|' || kc_private.org_slug_for('KC')
  || '|' || kc_private.org_slug_for('a b c d e f g h i j k l'),
  'khylt-hsd|org|kc-2|a-b-c-d-e-f-g-h-i', 'a page slug is transliterated, never empty, never taken and short enough for the slug rule');
select is(pg_temp.act('1', $$select public.submit_org_application('Neighbors', 'We help.', 'n@host.test', null, null, true)$$),
  'org_application_resubmit_too_soon', 'after a rejection a new application waits 7 days');
update public.org_applications set reviewed_at = now() - interval '8 days' where applicant_id = '00000000-0000-4000-8000-000000000001';
select is(pg_temp.act('1', $$select public.submit_org_application('Neighbors', 'We help.', 'n@host.test', null, 'https://neighbors.example', true)$$)
  || pg_temp.act('d', $$select public.admin_org_application_approve((select id from public.org_applications where org_name = 'Neighbors'))$$)
  || pg_temp.val(null, $$select slug || ':' || website_url from public.organizations where name = 'Neighbors'$$),
  'okokneighbors:https://neighbors.example', 'later it is accepted, and an approval without a slug derives it from the name');
create function pg_temp.handle(p_who text) returns text language sql as
  $$ select share_handle from public.users where id = ('00000000-0000-4000-8000-00000000000' || p_who)::uuid $$;
select is(pg_temp.act('1', 'select public.org_add_member(&neighbors, ''@' || upper(pg_temp.handle('3')) || ''', ''org_employee'')')
  || '|' || pg_temp.val('3', $$select string_agg(right(user_id::text, 1) || ':' || role, ' ' order by user_id) from public.list_org_members(&neighbors)$$),
  'ok|1:org_admin 3:org_employee', 'an organization admin adds a member by handle (any case, with @) and the team lists both');
select is(pg_temp.act('1', 'select public.org_add_member(&neighbors, ''' || pg_temp.handle('3') || ''', ''org_manager'')')
  || '|' || pg_temp.val(null, $$select (select count(*) from kc_private.outbox_events e where e.topic = 'notification'
       and e.payload ->> 'kind' = 'org_member_added' and e.payload ->> 'recipient_id' = '00000000-0000-4000-8000-000000000003')
     || ':' || (select array_to_string(roles, ',') from public.org_memberships where user_id = @3 and org_id = &neighbors)$$),
  'ok|1:org_manager', 'a role change replaces the member''s role and tells nobody again; joining told them once');
select is(pg_temp.act('3', 'select public.org_add_member(&neighbors, ''' || pg_temp.handle('2') || ''', ''org_volunteer'')')
  || '|' || pg_temp.act('3', 'select public.org_add_member(&neighbors, ''' || pg_temp.handle('2') || ''', ''org_manager'')')
  || '|' || pg_temp.act('3', 'select public.org_remove_member(&neighbors, @1)'),
  'ok|42501|42501', 'a manager adds volunteers, never managers or admins, and removes no admin');
select is(pg_temp.act('2', 'select public.org_add_member(&neighbors, ''' || pg_temp.handle('f') || ''', ''org_volunteer'')')
  || '|' || pg_temp.act('f', 'select public.list_org_members(&neighbors)')
  || '|' || pg_temp.act('f', 'select public.org_add_member(&neighbors, ''' || pg_temp.handle('f') || ''', ''org_volunteer'')')
  || '|' || pg_temp.act('f', 'select public.org_remove_member(&neighbors, @2)')
  || '|' || pg_temp.act(null, 'select public.list_org_members(&neighbors)'),
  '42501|42501|42501|42501|42501', 'a volunteer, an outsider and a signed-out caller manage and read nothing');
select is(pg_temp.act('1', 'select public.org_add_member(&neighbors, ''nobody_here'', ''org_volunteer'')')
  || '|' || pg_temp.act('1', 'select public.org_add_member(&neighbors, ''' || pg_temp.handle('2') || ''', ''owner'')')
  || '|' || pg_temp.act('1', 'select public.org_remove_member(&neighbors, @f)')
  || '|' || pg_temp.act('1', 'select public.org_add_member(&neighbors, ''' || pg_temp.handle('1') || ''', ''org_volunteer'')')
  || '|' || pg_temp.act('1', 'select public.org_remove_member(&neighbors, @1)'),
  'org_member_user_not_found|org_role_invalid|org_member_not_found|org_last_admin|org_last_admin',
  'unknown handle, role and member are refused with their codes, and the last admin stays');
select is(pg_temp.act('1', 'select public.org_add_member(&neighbors, ''' || pg_temp.handle('3') || ''', ''org_admin'')')
  || '|' || pg_temp.act('1', 'select public.org_remove_member(&neighbors, @1)')
  || '|' || pg_temp.val(null, $$select string_agg(right(user_id::text, 1) || ':' || array_to_string(roles, ','), ' ' order by user_id)
       from public.org_memberships where org_id = &neighbors$$)
  || '|' || pg_temp.val(null, $$select count(*) from public.admin_role_grants where scope_org_id = &neighbors and user_id = @1 and revoked_at is null$$),
  'ok|ok|2:org_volunteer 3:org_admin|0', 'a second admin lets the first leave; the leaver''s grants end, the others stay');
select is(pg_temp.val('2', $$select string_agg(role, ',' order by user_id) from public.list_org_members(&neighbors)$$), 'org_volunteer,org_admin',
  'every member of the team reads it');
delete from public.organizations where slug = 'neighbors';

-- ── Removal ─────────────────────────────────────────────────────────────────
select is(pg_temp.val(null, $$select (select count(*) from public.posts where beneficiary_org_id = &helpers) || '|'
    || (select count(*) from public.org_memberships where org_id = &helpers)$$), '3|4', 'the organization has posts and members');
delete from public.organizations where slug = 'helpers';
select is((select count(*) from public.posts where title in ('orgpost', 'orgdraft', 'orgevent') and beneficiary_org_id is null)
  || '|' || (select count(*) from public.org_memberships) || '|' || (select count(*) from public.admin_role_grants where scope_org_id is not null)
  || '|' || (select organization_id is null from public.org_applications where org_name = 'Helpers'),
  '3|0|0|true', 'removing an organization releases its posts and ends its memberships and grants');
delete from auth.users where id = '00000000-0000-4000-8000-000000000002';
select is((select count(*) from public.org_applications where org_name = 'Third'), 0::bigint, 'an application leaves with its applicant');


select * from finish();
rollback;
