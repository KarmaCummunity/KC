-- Organization finance summaries: the period totals count cleared income and expenses only,
-- transfers aside, and are open to the finance roles of the organization; the donors
-- overview groups in-app donations by member and typed ones by party name, folds unnamed
-- donors into one anonymous group, and is open to organization administrators only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as a member (anon when 'anon') and returns its rows joined by ' ', the
-- P0001 message, or the SQLSTATE. &slug names an organization.
create function pg_temp.rows_as(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
  v_value text;
begin
  for v_match in select regexp_matches(p_sql, '&([a-z]+)', 'g') loop
    v_sql := regexp_replace(v_sql, '&' || v_match[1] || '\M', coalesce(quote_literal((
      select o.id from public.organizations o where o.slug = v_match[1])), 'null') || '::uuid');
  end loop;
  begin
    perform set_config('request.jwt.claims', case when p_who = 'anon' then '{"role":"anon"}'
      else jsonb_build_object('sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text end, true);
    perform set_config('role', case when p_who = 'anon' then 'anon' else 'authenticated' end, true);
    execute format('select string_agg(r::text, '' '') from (%s) r', v_sql) into v_value;
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

-- One entry of the books of `aid`, written as the database owner.
create function pg_temp.entry(
  p_kind text, p_agorot bigint, p_party text, p_status text default 'cleared', p_days_ago integer default 1,
  p_donor text default null, p_source_ref text default null)
returns void
language sql
as $$
  insert into billing.org_finance_entries (org_id, kind, amount_agorot, occurred_at, counterparty, status, void_reason,
                                           source, source_ref, donor_user_id)
  select o.id, p_kind, p_agorot, now() - make_interval(days => p_days_ago), p_party, p_status,
         case p_status when 'cancelled' then 'typed twice' end,
         case when p_source_ref is null then 'manual' else 'payment_sync' end, p_source_ref,
         ('00000000-0000-4000-8000-00000000000' || p_donor)::uuid
    from public.organizations o where o.slug = 'aid';
$$;

select plan(8);

-- a platform admin · c accountant of `aid` · f treasurer of `aid` · e administrator of
-- `aid` · d a donor · 1 a member with no role.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(string_to_array('a,c,d,e,f,1', ',')) x;
update public.users set display_name = 'Dan' where id = '00000000-0000-4000-8000-00000000000d';
insert into public.organizations (slug, name, is_platform, is_verified_nonprofit) values
  ('kc', 'Karma Community', true, false), ('aid', 'Aid', false, true);
insert into public.admin_role_grants (user_id, role, scope_org_id) values
  ('00000000-0000-4000-8000-00000000000a', 'admin', null),
  ('00000000-0000-4000-8000-00000000000c', 'org_accountant', (select id from public.organizations where slug = 'aid')),
  ('00000000-0000-4000-8000-00000000000f', 'org_treasurer', (select id from public.organizations where slug = 'aid')),
  ('00000000-0000-4000-8000-00000000000e', 'org_admin', (select id from public.organizations where slug = 'aid'));

select pg_temp.entry('donation_in', 500, ' dana  LEVI ', 'cleared', 5);
select pg_temp.entry('donation_in', 1000, 'Dana Levi', 'cleared', 2);
select pg_temp.entry('grant_in', 2000, 'Fund', 'cleared', 40);
select pg_temp.entry('donation_in', 700, 'Grow', 'cleared', 3, 'd', 'payment:1');
select pg_temp.entry('donation_in', 200, 'Grow', 'cleared', 3, null, 'payment:2');
select pg_temp.entry('donation_in', 100, null);
select pg_temp.entry('expense', 300, 'Printer');
select pg_temp.entry('transfer', 50, null);
select pg_temp.entry('donation_in', 9999, 'Pending', 'pending');
select pg_temp.entry('donation_in', 8888, 'Voided', 'cancelled');

-- ── Period totals ───────────────────────────────────────────────────────────
select is(pg_temp.rows_as('c', $$select * from public.finance_ledger_summary(&aid)$$), '(ILS,4500,300,4200,7)',
  'cleared income and expenses; transfers, pending and voided entries count nowhere');
select is(pg_temp.rows_as('c', $$select * from public.finance_ledger_summary(&aid, now() - interval '30 days', now())$$),
  '(ILS,2500,300,2200,6)', 'the period bounds limit the entries');
select is(pg_temp.rows_as('f', $$select entry_count from public.finance_ledger_summary(&aid)$$)
    || pg_temp.rows_as('a', $$select entry_count from public.finance_ledger_summary(&aid)$$), '(7)(7)',
  'the treasurer and a platform admin read the totals');
select is(pg_temp.rows_as('1', $$select * from public.finance_ledger_summary(&aid)$$)
    || pg_temp.rows_as('c', $$select * from public.finance_ledger_summary(&kc)$$)
    || pg_temp.rows_as('anon', $$select * from public.finance_ledger_summary(&aid)$$), '425014250142501',
  'a member without a role, another organization and signed-out callers are refused');

-- ── Donors overview ─────────────────────────────────────────────────────────
select is(pg_temp.rows_as('e', $$select * from public.finance_donors_summary(&aid)$$) like
    '(Fund,1,2000,%) ("Dana Levi",2,1500,%) (Dan,1,700,%) (,2,300,%)', true,
  'donors by member and by party name, unnamed donors together, largest total first');
select is(pg_temp.rows_as('e', $$select donor_name from public.finance_donors_summary(&aid, 1)$$), '(Fund)',
  'the list is limited');
select is(pg_temp.rows_as('a', $$select count(*) from public.finance_donors_summary(&aid)$$), '(4)',
  'a platform admin reads the donors');
select is(pg_temp.rows_as('c', $$select * from public.finance_donors_summary(&aid)$$)
    || pg_temp.rows_as('f', $$select * from public.finance_donors_summary(&aid)$$)
    || pg_temp.rows_as('anon', $$select * from public.finance_donors_summary(&aid)$$), '425014250142501',
  'the accountant, the treasurer and signed-out callers do not read the donors');

select * from finish();
rollback;
