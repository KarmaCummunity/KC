-- Organization entitlement (#2150): the paid plan belongs to the organization itself, is
-- closed to every client role, is reported by the store or granted by hand (the store never
-- overrides a hand grant), and is readable only by the managers of that organization.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

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
grant execute on function pg_temp.become(text) to public;

-- Runs a statement as a member, `anon` or `service_role`: 'ok', the P0001 message, or the SQLSTATE.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
begin
  begin
    perform pg_temp.become(p_who);
    execute p_sql;
    perform pg_temp.become('none');
    return 'ok';
  exception when others then
    perform pg_temp.become('none');
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- One value read as a member or role. Reads that follow a write go through here too: a STABLE
-- function called directly in the same SELECT would be evaluated before the write runs.
create function pg_temp.val(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform pg_temp.become(p_who);
  execute p_sql into v_value;
  perform pg_temp.become('none');
  return v_value;
end;
$$;

select plan(9);

-- a manager of `aid` · b manager of `other` · c a member of `aid` with no management role.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(string_to_array('a,b,c', ',')) x;
insert into public.organizations (slug, name) values ('aid', 'Aid'), ('other', 'Other');
insert into public.admin_role_grants (user_id, role, scope_org_id) values
  ('00000000-0000-4000-8000-00000000000a', 'org_admin', (select id from public.organizations where slug = 'aid')),
  ('00000000-0000-4000-8000-00000000000b', 'org_admin', (select id from public.organizations where slug = 'other')),
  ('00000000-0000-4000-8000-00000000000c', 'org_volunteer', (select id from public.organizations where slug = 'aid'));

select set_config('t.aid', (select id::text from public.organizations where slug = 'aid'), false);
select set_config('t.other', (select id::text from public.organizations where slug = 'other'), false);

-- ── Closed to clients ───────────────────────────────────────────────────────
select is(pg_temp.act('a', 'select 1 from billing.organization_entitlements')
  || pg_temp.act('anon', 'select 1 from billing.organization_entitlements')
  || pg_temp.act('a', format('select public.api_revenuecat_set_org_entitlement(%L, true, null)', current_setting('t.aid')))
  || pg_temp.act('a', format('select public.api_set_org_entitlement(%L, true)', current_setting('t.aid')))
  || pg_temp.act('a', format('select kc_private.org_entitlement_active(%L)', current_setting('t.aid'))),
  '4250142501425014250142501', 'no client role reads the table, sets an entitlement or calls the internal predicate');

-- ── The store reports the plan ──────────────────────────────────────────────
select is(pg_temp.val('service_role', format('select public.api_revenuecat_set_org_entitlement(%L, true, now() + interval ''1 month'') ->> ''status''', current_setting('t.aid')))
  || '|' || pg_temp.val('service_role', format('select public.api_revenuecat_set_org_entitlement(%L, true, null) ->> ''status''', gen_random_uuid())),
  'granted|unknown_organization', 'the store grants an organization its plan; an unknown organization is reported, not created');
select is(pg_temp.val('none', format('select kc_private.org_entitlement_active(%L)', current_setting('t.aid'))), 'true', 'the plan is active until its end date');
select is(pg_temp.val('service_role', format('select public.api_revenuecat_set_org_entitlement(%L, true, now() - interval ''1 minute'') ->> ''status''', current_setting('t.aid')))
  || '|' || pg_temp.val('none', format('select kc_private.org_entitlement_active(%L)', current_setting('t.aid'))),
  'granted|false', 'a plan past its end date is not active');
select is(pg_temp.val('service_role', format('select public.api_revenuecat_set_org_entitlement(%L, false, null) ->> ''status''', current_setting('t.aid')))
  || '|' || pg_temp.val('none', format('select kc_private.org_entitlement_active(%L)', current_setting('t.aid'))),
  'revoked|false', 'an expiration revokes the plan');

-- ── A hand grant wins over the store ────────────────────────────────────────
select is(pg_temp.val('service_role', format('select public.api_set_org_entitlement(%L, true, null, ''promo'') ->> ''status''', current_setting('t.aid')))
  || '|' || pg_temp.val('service_role', format('select public.api_revenuecat_set_org_entitlement(%L, false, null) ->> ''status''', current_setting('t.aid')))
  || '|' || pg_temp.val('none', format('select kc_private.org_entitlement_active(%L)', current_setting('t.aid'))),
  'granted|skipped_manual_grant|true', 'the store never overrides an active hand grant');

-- ── Only the managers of that organization read it ──────────────────────────
select is(pg_temp.val('a', format('select public.api_org_entitlement_status(%L) ->> ''has_plan''', current_setting('t.aid')))
  || '|' || pg_temp.val('a', format('select public.api_org_entitlement_status(%L) ->> ''source''', current_setting('t.aid'))),
  'true|promo', 'a manager reads the plan of their organization with its source');
select is(pg_temp.act('b', format('select public.api_org_entitlement_status(%L)', current_setting('t.aid')))
  || pg_temp.act('c', format('select public.api_org_entitlement_status(%L)', current_setting('t.aid')))
  || pg_temp.act('anon', format('select public.api_org_entitlement_status(%L)', current_setting('t.aid')))
  || pg_temp.act('a', 'select public.api_org_entitlement_status(null)'),
  '42501425014250142501', 'another organization''s manager, a member without a management role, anon and a null id are refused');

-- ── It leaves with the organization ─────────────────────────────────────────
delete from public.organizations where slug = 'aid';
select is((select count(*) from billing.organization_entitlements), 0::bigint,
  'deleting an organization removes its entitlement');

select * from finish();
rollback;
