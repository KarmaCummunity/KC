-- CRM contacts per organization (FR-ADMIN-032, migration 0035): each organization's book is
-- reached only by its org_admin / org_manager, and the platform organization's by platform
-- staff (moderator and above); patch semantics, validation, soft delete, search, keyset
-- order, and ids-only audit events.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.uid(p_who text)
returns uuid
language sql
as $$ select ('00000000-0000-4000-8000-0000000000' || to_hex(ascii(p_who)))::uuid; $$;

-- Runs `p_sql` as the member: its single value as text, 'ok' for no value, or the P0001
-- message / the SQLSTATE of the error.
create function pg_temp.run(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(p_who), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql into v_out;
    v_out := coalesce(nullif(v_out, ''), 'ok');
  exception when others then
    v_out := case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end;
$$;

create function pg_temp.org(p_slug text)
returns uuid
language sql
as $$ select o.id from public.organizations o where o.slug = p_slug; $$;

create function pg_temp.contact(p_name text)
returns uuid
language sql
as $$ select c.id from kc_private.crm_contacts c where c.name = p_name; $$;

select plan(33);

-- a org_admin of `aid`; g org_manager of `aid`; e org_employee of `aid`; b org_admin of `bee`;
-- m platform moderator; p platform support; x an ordinary member.
insert into auth.users (id, email, raw_app_meta_data)
select pg_temp.uid(x), 'u' || x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'g', 'e', 'b', 'm', 'p', 'x']) x;
insert into public.organizations (slug, name, is_platform) values ('kc', 'Karma Community', true), ('aid', 'Aid', false), ('bee', 'Bee', false);
insert into public.admin_role_grants (user_id, role, scope_org_id) values
  (pg_temp.uid('a'), 'org_admin', pg_temp.org('aid')), (pg_temp.uid('g'), 'org_manager', pg_temp.org('aid')),
  (pg_temp.uid('e'), 'org_employee', pg_temp.org('aid')), (pg_temp.uid('b'), 'org_admin', pg_temp.org('bee')),
  (pg_temp.uid('m'), 'moderator', null), (pg_temp.uid('p'), 'support', null);

-- ── Who reaches which book ──────────────────────────────────────────────────
select is(pg_temp.run('a', $$select string_agg(name, ',') from public.crm_my_orgs()$$), 'Aid', 'an org admin manages their organization''s book');
select is(pg_temp.run('m', $$select string_agg(name, ',') from public.crm_my_orgs()$$), 'Karma Community', 'a moderator manages the platform organization''s book only');
select is(pg_temp.run('p', $$select count(*) from public.crm_my_orgs()$$), '0', 'support staff manage no book');
select is(pg_temp.run('x', format('select public.crm_contact_upsert(%L, p_name => %L)', pg_temp.org('aid'), 'Dana')), '42501', 'an ordinary member cannot add a contact');
select is(pg_temp.run('e', format('select public.crm_contact_upsert(%L, p_name => %L)', pg_temp.org('aid'), 'Dana')), '42501', 'an employee of the organization cannot add a contact');
select is(pg_temp.run('b', format('select public.crm_contact_upsert(%L, p_name => %L)', pg_temp.org('aid'), 'Dana')), '42501', 'another organization''s admin cannot add a contact');
select is(pg_temp.run('m', format('select public.crm_contact_upsert(%L, p_name => %L)', pg_temp.org('aid'), 'Dana')), '42501', 'platform staff do not reach another organization''s book');

-- ── Creating and validating ─────────────────────────────────────────────────
select is(pg_temp.run('a', format('select public.crm_contact_upsert(%L, p_name => %L)', pg_temp.org('aid'), '  ')), 'invalid_name', 'a contact needs a name');
select is(pg_temp.run('a', format($$select public.crm_contact_upsert(%L, p_name => 'Dana', p_status => 'hot')$$, pg_temp.org('aid'))), 'invalid_status', 'an unknown status is refused');
select is(pg_temp.run('a', format($$select public.crm_contact_upsert(%L, p_name => 'Dana', p_email => 'dana')$$, pg_temp.org('aid'))), 'invalid_email', 'a malformed email is refused');
select is(pg_temp.run('a', format($$select public.crm_contact_upsert(%L, p_name => 'Dana', p_phone => 'call me')$$, pg_temp.org('aid'))), 'invalid_phone', 'a malformed phone is refused');
select is(pg_temp.run('a', format('select public.crm_contact_upsert(%L, p_name => %L, p_notes => %L)', pg_temp.org('aid'), 'Dana', repeat('n', 4001))), 'invalid_input', 'notes over 4000 characters are refused');
select isnt(pg_temp.run('a', format($$select public.crm_contact_upsert(%L, p_name => ' Dana ', p_organization => 'Acme', p_email => 'dana@acme.test', p_phone => '+972 50-000-0000', p_tags => array['donor'])$$, pg_temp.org('aid'))),
  null, 'the org admin adds a contact');
select is((select status || '|' || (created_by = pg_temp.uid('a'))::text from kc_private.crm_contacts where name = 'Dana'), 'cold|true', 'the name is trimmed and the status starts cold');
select isnt(pg_temp.run('m', format($$select public.crm_contact_upsert(%L, p_name => 'Platform partner')$$, pg_temp.org('kc'))), null, 'a moderator adds a contact to the platform book');
select is((select e.payload::text from kc_private.outbox_events e where e.topic = 'audit' and e.payload ->> 'action' = 'crm_contact_create' order by e.id limit 1),
  jsonb_build_object('action', 'crm_contact_create', 'actor_id', pg_temp.uid('a'), 'entity', jsonb_build_object('type', 'crm_contact', 'id', pg_temp.contact('Dana')),
                     'data', jsonb_build_object('org_id', pg_temp.org('aid'), 'status', 'cold'))::text,
  'the creation is audited without the contact''s name, email or phone');

-- ── Patching ────────────────────────────────────────────────────────────────
select is(pg_temp.run('g', format($$select public.crm_contact_upsert(%L, %L, p_role_title => 'CEO', p_organization => '', p_status => 'warm')$$, pg_temp.org('aid'), pg_temp.contact('Dana'))),
  pg_temp.contact('Dana')::text, 'the org manager patches the contact');
select is((select concat_ws('|', organization, email, role_title, status, (updated_by = pg_temp.uid('g'))::text) from kc_private.crm_contacts where name = 'Dana'),
  'dana@acme.test|CEO|warm|true', 'null keeps a field, an empty string clears it');
select is((select e.payload #> '{data,fields}' from kc_private.outbox_events e where e.topic = 'audit' and e.payload ->> 'action' = 'crm_contact_update'),
  '["organization", "role_title", "status"]'::jsonb, 'the patch is audited with the changed field names');
select is(pg_temp.run('b', format($$select public.crm_contact_upsert(%L, %L, p_status => 'active')$$, pg_temp.org('bee'), pg_temp.contact('Dana'))),
  '42501', 'a contact is not reachable through another organization');
select is(pg_temp.run('b', format('select public.crm_contact_mark_contacted(%L)', pg_temp.contact('Dana'))), '42501', 'another organization cannot touch the contact');
select is(pg_temp.run('a', format('select public.crm_contact_mark_contacted(%L)', pg_temp.contact('Dana'))), 'ok', 'the org admin records a contact');
select is((select (last_contacted_at is not null)::text from kc_private.crm_contacts where name = 'Dana'), 'true', 'the last contact time is stamped');

-- ── Listing ─────────────────────────────────────────────────────────────────
select lives_ok(format($$select pg_temp.run('a', format('select public.crm_contact_upsert(%%L, p_name => %%L, p_email => %%L)', %L::uuid, n, lower(n) || '@x.test')) from unnest(array['Eli', 'Noa', 'Omer']) n$$, pg_temp.org('aid')),
  'more contacts are added');
-- Spread the update times (the trigger would stamp now()).
alter table kc_private.crm_contacts disable trigger crm_contacts_set_updated_at;
update kc_private.crm_contacts set updated_at = now() - (array_position(array['Omer', 'Noa', 'Eli', 'Dana'], name) || ' minutes')::interval
 where org_id = pg_temp.org('aid');
alter table kc_private.crm_contacts enable trigger crm_contacts_set_updated_at;
select is(pg_temp.run('a', format($$select string_agg(l.contact ->> 'name', ',' order by n) from public.crm_contact_list(%L) with ordinality l(contact, cursor, n)$$, pg_temp.org('aid'))),
  'Omer,Noa,Eli,Dana', 'most recently updated first');
select is(pg_temp.run('a', format($$
  with p1 as (select * from public.crm_contact_list(%1$L, p_limit => 3) with ordinality l(contact, cursor, n))
  select string_agg(l.contact ->> 'name', ',') from public.crm_contact_list(%1$L, p_limit => 3, p_cursor => (select cursor from p1 order by n desc limit 1)) l$$, pg_temp.org('aid'))),
  'Dana', 'the cursor continues after the last row');
select is(pg_temp.run('a', format($$select string_agg(l.contact ->> 'name', ',') from public.crm_contact_list(%L, p_query => 'ACME') l$$, pg_temp.org('aid'))), 'Dana', 'the search matches the email, case-insensitively');
select is(pg_temp.run('a', format($$select string_agg(l.contact ->> 'name', ',') from public.crm_contact_list(%L, p_tag => 'donor', p_status => 'warm') l$$, pg_temp.org('aid'))), 'Dana', 'tag and status filters');
select is(pg_temp.run('a', format('select public.crm_contact_count(%L)', pg_temp.org('aid'))), '4', 'the count matches the list');
select is(pg_temp.run('m', format('select public.crm_contact_count(%L)', pg_temp.org('kc'))), '1', 'the platform book holds only its own contacts');

-- ── Deleting ────────────────────────────────────────────────────────────────
select is(pg_temp.run('g', format('select public.crm_contact_delete(%L)', pg_temp.contact('Dana'))), 'ok', 'the org manager deletes a contact');
select is(pg_temp.run('a', format('select public.crm_contact_count(%L)', pg_temp.org('aid'))) || '|' ||
          pg_temp.run('a', format('select public.crm_contact_mark_contacted(%L)', pg_temp.contact('Dana'))), '3|contact_not_found',
  'a deleted contact is hidden and no longer found');
select is(pg_temp.run('a', 'select count(*) from kc_private.crm_contacts'), '42501', 'the table is not readable directly');

select * from finish();
rollback;
