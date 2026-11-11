-- Staff reads the admin screens rely on: a moderator reads member accounts and the role
-- roster directly; an ordinary member reads neither; the caller's own roles come from
-- get_my_admin_roles().
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs one query as member a (ordinary), b (moderator) or c (suspended-account moderator)
-- and returns its single value as text, or the SQLSTATE of an error.
create function pg_temp.q(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute p_sql into v_value;
    perform set_config('role', 'none', true);
    return v_value;
  exception when others then
    perform set_config('role', 'none', true);
    return sqlstate;
  end;
end;
$$;

select plan(7);

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.test', '{"provider":"google"}'),
  ('00000000-0000-4000-8000-00000000000b', 'b@example.test', '{"provider":"google"}'),
  ('00000000-0000-4000-8000-00000000000c', 'c@example.test', '{"provider":"email"}');
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000b', 'moderator');

select is(pg_temp.q('b', 'select count(*) from public.user_account'), '3', 'a moderator reads every member account');
select is(pg_temp.q('a', 'select count(*) from public.user_account'), '1', 'an ordinary member reads only their own');
select is(pg_temp.q('b', 'select count(*) from public.admin_role_grants'), '1', 'a moderator reads the role roster');
select is(pg_temp.q('a', 'select count(*) from public.admin_role_grants'), '0', 'an ordinary member sees no grant');
select is(pg_temp.q('b', 'select count(*) from public.users where not is_active'), '1',
  'a moderator also reads members whose account is not active');
select is(pg_temp.q('b', $$select (public.get_my_admin_roles())::text$$) like '%moderator%', true,
  'get_my_admin_roles returns the caller''s role');
select is(pg_temp.q('a', $$select (public.get_my_admin_roles())::text$$) in ('[]', '{}', '') or
          pg_temp.q('a', $$select (public.get_my_admin_roles())::text$$) is null, true,
  'and nothing for an ordinary member');

select * from finish();
rollback;
