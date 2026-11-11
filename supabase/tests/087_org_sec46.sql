-- Section 46(a) status of an organization (FR-FIN-007 AC2–AC3): the record moves only along
-- the `org_sec46` machine, `expired` is never recorded by hand, an approval recorded as active
-- is valid today, a renewal keeps the status, and the nightly job expires what has lapsed.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Records a status for the organization `aid` as a member: 'ok', the P0001 message, or the SQLSTATE.
create function pg_temp.record(p_who text, p_args text)
returns text
language plpgsql
as $$
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute format('select public.finance_sec46_set(%L, %s)', (select o.id from public.organizations o where o.slug = 'aid'), p_args);
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- The record of `aid`: status|number|valid until (relative to today), read as the database owner.
create function pg_temp.sec46()
returns text
language sql
as $$
  select o.sec46_status || '|' || coalesce(o.sec46_approval_number, '-') || '|'
         || coalesce((o.sec46_valid_until - (now() at time zone 'Asia/Jerusalem')::date)::text, '-')
    from public.organizations o where o.slug = 'aid';
$$;

select plan(16);

-- f is the treasurer of `aid`; d is a member with no role there.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['d', 'f']) x;
insert into public.organizations (slug, name, is_platform, is_verified_nonprofit) values ('aid', 'Aid', false, true);
insert into public.admin_role_grants (user_id, role, scope_org_id) values
  ('00000000-0000-4000-8000-00000000000f', 'org_treasurer', (select id from public.organizations where slug = 'aid'));

-- ── Recording ───────────────────────────────────────────────────────────────
select is(pg_temp.record('d', $$'pending'$$), '42501', 'only a finance manager of the organization records its approval');
select is(pg_temp.record('f', $$'pending'$$) || '|' || pg_temp.sec46(), 'ok|pending|-|-', 'an application is recorded');
select is(pg_temp.record('f', $$'expired'$$), 'illegal_transition', 'an application cannot be recorded as expired');
select is(pg_temp.record('f', $$'active', '580012345'$$), '23514', 'an active approval needs its number and both dates');
select is(pg_temp.record('f', $$'active', '580012345', current_date - 400, current_date - 30$$), 'sec46_not_valid_today',
  'an approval whose validity already ended is not recorded as active');
select is(pg_temp.record('f', $$'active', '580012345', current_date - 10, current_date + 300$$) || '|' || pg_temp.sec46(),
  'ok|active|580012345|300', 'the approval is recorded as active');
select is(pg_temp.record('f', $$'expired'$$), 'forbidden_role', 'an active approval is never marked expired by hand');
select is(pg_temp.record('f', $$'active', '580012345', current_date - 10, current_date + 700$$) || '|' || pg_temp.sec46(),
  'ok|active|580012345|700', 'recording active again with new dates is a renewal');

-- ── Expiry ──────────────────────────────────────────────────────────────────
select is(kc_private.org_tax_approval_expire() || '|' || pg_temp.sec46(), '0|active|580012345|700', 'a valid approval is left alone by the nightly job');
-- The validity ends (the table constraint only asks that it ends after it starts).
update public.organizations set sec46_valid_from = current_date - 400, sec46_valid_until = current_date - 2 where slug = 'aid';
select is(kc_private.org_tax_approval_expire() || '|' || pg_temp.sec46(), '1|expired|580012345|-2',
  'the nightly job expires a lapsed approval and keeps its number and dates');
select is(kc_private.org_tax_approval_expire(), 0, 'running the job again changes nothing');
select is((select count(*) from public.organizations o where o.sec46_status = 'active'
             and current_date between o.sec46_valid_from and o.sec46_valid_until), 0::bigint,
  'an expired approval no longer makes a receipt tax-eligible');
select is(pg_temp.record('f', $$'revoked'$$), 'illegal_transition', 'an expired approval is not revoked: it is renewed or cleared');
select is(pg_temp.record('f', $$'active', '580099999', current_date, current_date + 365$$) || '|' || pg_temp.sec46(),
  'ok|active|580099999|365', 'a renewed approval is active again');

-- ── Revoking and clearing ───────────────────────────────────────────────────
select is(pg_temp.record('f', $$'revoked'$$) || '|' || pg_temp.sec46(), 'ok|revoked|580099999|365',
  'a revoked approval keeps what was recorded');
select is(pg_temp.record('f', $$'none'$$) || '|' || pg_temp.sec46(), 'ok|none|-|-', 'clearing the record removes the number and the dates');

select * from finish();
rollback;
