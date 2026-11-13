-- Organization page slug and the reason of a voided entry (migration 0014): only the super
-- admin changes a slug, which must follow the slug rule and be free, and the change is
-- audited; a void of an entry of the books needs a reason of 3 to 500 characters.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a one-column query as a member and returns its values joined by ' ', 'none', the
-- P0001 message or the SQLSTATE. &slug names an organization, %e the entry of `aid`.
create function pg_temp.rows_as(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := replace(p_sql, '%e', coalesce(quote_literal((select e.id from billing.org_finance_entries e limit 1)), 'null') || '::uuid');
  v_match text[];
  v_value text;
begin
  for v_match in select regexp_matches(p_sql, '&([a-z]+)', 'g') loop
    v_sql := replace(v_sql, '&' || v_match[1], coalesce(quote_literal((
      select o.id from public.organizations o where o.slug = v_match[1])), 'null') || '::uuid');
  end loop;
  begin
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute format('select string_agg(r.v::text, '' '') from (%s) r(v)', v_sql) into v_value;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return coalesce(v_value, 'none');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

select plan(8);

-- a super admin · d admin · f org_admin of `aid` · 1 a member.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(string_to_array('a,d,f,1', ',')) x;
insert into public.organizations (slug, name, is_platform, is_verified_nonprofit) values
  ('kc', 'Karma Community', true, false), ('aid', 'Aid', false, true), ('help', 'Help', false, false);
insert into public.admin_role_grants (user_id, role, scope_org_id) values
  ('00000000-0000-4000-8000-00000000000a', 'super_admin', null),
  ('00000000-0000-4000-8000-00000000000d', 'admin', null),
  ('00000000-0000-4000-8000-00000000000f', 'org_admin', (select id from public.organizations where slug = 'aid'));
insert into billing.org_finance_entries (org_id, kind, amount_agorot, occurred_at, counterparty, status, source)
select o.id, 'expense', 300, now() - interval '1 day', 'Printer', 'cleared', 'manual'
  from public.organizations o where o.slug = 'aid';

-- ── Void reason ─────────────────────────────────────────────────────────────
select is(pg_temp.rows_as('f', $$select public.finance_ledger_mark(&aid, %e, '')$$) || '|'
  || pg_temp.rows_as('f', $$select public.finance_ledger_mark(&aid, %e, '  x ')$$) || '|'
  || (select status from billing.org_finance_entries),
  'void_reason_required|void_reason_required|cleared', 'a void without a reason is refused and changes nothing');
select pg_temp.rows_as('f', $$select public.finance_ledger_mark(&aid, %e, ' typed twice ')$$);
select is((select status || ':' || void_reason from billing.org_finance_entries), 'cancelled:typed twice',
  'a void with a reason cancels the entry and keeps the trimmed reason');

-- ── Page slug ───────────────────────────────────────────────────────────────
select is(pg_temp.rows_as('d', $$select public.admin_set_org_slug(&aid, 'aid-new')$$) || '|'
  || pg_temp.rows_as('f', $$select public.admin_set_org_slug(&aid, 'aid-new')$$) || '|'
  || pg_temp.rows_as('1', $$select public.admin_set_org_slug(&aid, 'aid-new')$$),
  '42501|42501|42501', 'only the super admin changes a page slug');
select is(pg_temp.rows_as('a', $$select public.admin_set_org_slug(&aid, 'Bad Slug')$$) || '|'
  || pg_temp.rows_as('a', $$select public.admin_set_org_slug(&aid, 'help')$$) || '|'
  || pg_temp.rows_as('a', $$select public.admin_set_org_slug(gen_random_uuid(), 'fine')$$),
  'invalid_slug|slug_taken|org_not_found', 'a slug follows the rule, is free and names a real organization');
select is(pg_temp.rows_as('a', $$select public.admin_set_org_slug(&aid, '  Aid-Israel ')$$),
  'aid-israel', 'the super admin changes a slug, trimmed and lower-cased');
select is((select string_agg(slug, ',' order by slug) from public.organizations), 'aid-israel,help,kc',
  'the organization keeps its new slug');
select is((select e.metadata ->> 'previous_slug' || '>' || (e.metadata ->> 'slug') from audit.events e
            where e.action = 'org_slug_changed'),
  'aid>aid-israel', 'the change is audited with the previous slug');
select is(has_column_privilege('authenticated', 'public.organizations', 'slug', 'update'), false,
  'no client writes the slug column directly');

select * from finish();
rollback;
