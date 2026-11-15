-- Public nonprofit and transparency pages for signed-out visitors (0030, FR-ORG-001 AC4,
-- FR-FIN-020 AC4, FR-FIN-022 AC2): exactly the three public reads are open to `anon`, they
-- carry public fields and totals only, and a campaign shows its goal and summary.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- One value as `anon`, or the SQLSTATE.
create function pg_temp.as_anon(p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('role', 'anon', true);
    execute p_sql into v_value;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return coalesce(v_value, 'null');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return sqlstate;
  end;
end;
$$;

select plan(6);

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.test', '{"provider":"google"}');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('money', 'money', 'money');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'money', 'campaign', 'c', 'c', 'either');
insert into public.organizations (id, slug, name, is_verified_nonprofit) values
  ('50000000-0000-4000-8000-000000000001', 'aid', 'Aid', true),
  ('50000000-0000-4000-8000-000000000002', 'plain', 'Plain', false);
insert into public.posts (owner_id, beneficiary_org_id, world_slug, kind_id, direction, status, title, description, details, city_id)
values ('00000000-0000-4000-8000-00000000000a', '50000000-0000-4000-8000-000000000001', 'money',
        '20000000-0000-4000-8000-000000000001', 'request', 'open', 'Winter coats', 'Coats for 40 families',
        '{"goal_ils": 2500}', 'c1');

select is(pg_temp.as_anon($$select string_agg(slug, ',') from public.list_verified_nonprofits()$$), 'aid',
  'a signed-out visitor sees the directory of verified nonprofits');
select is(pg_temp.as_anon($$select (p -> 'campaigns' -> 0 ->> 'title') || '|' || (p -> 'campaigns' -> 0 ->> 'goal_agorot')
      || '|' || (p -> 'campaigns' -> 0 ->> 'summary') || '|' || (p -> 'campaigns' -> 0 ->> 'raised_agorot')
      from public.get_nonprofit_public_page('aid') p$$),
  'Winter coats|250000|Coats for 40 families|0', 'the nonprofit page shows each campaign with its goal, summary and progress');
select is(pg_temp.as_anon($$select public.get_nonprofit_public_page('plain')::text$$), 'null',
  'an unverified organization has no public page');
select is(pg_temp.as_anon($$select public.rpc_org_transparency('aid')::text$$), '{"enabled": false}',
  'transparency answers a signed-out visitor, and shows nothing until the organization switches a block on');
select is(pg_temp.as_anon($$select (p::text ~* '00000000-0000-4000-8000-00000000000a')::text
      from public.get_nonprofit_public_page('aid') p$$), 'false', 'no member id reaches the public page');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
              and p.proname in ('list_verified_nonprofits', 'get_nonprofit_public_page', 'rpc_org_transparency',
                                'create_donation_intent', 'list_my_donation_history', 'finance_ledger_summary',
                                'finance_donors_summary', 'post_cards', 'feed_page')),
  'get_nonprofit_public_page,list_verified_nonprofits,rpc_org_transparency',
  'only the three public reads are open to anon; donations, finance and posts stay closed');

select * from finish();
rollback;
