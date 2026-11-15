-- Staff set a member's verification level (0032, FR-VERIFY): an admin raises a member to an
-- identity-document level with a reason and the change is audited; a moderator, the member
-- themselves and a signed-out caller cannot; the badge level needs the super admin.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who,
      'role', case when p_who is null then 'anon' else 'authenticated' end)::text, true);
    perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
    execute p_sql into v_value;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return coalesce(v_value, 'null');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case when sqlstate in ('P0001', '42501') then sqlerrm else sqlstate end;
  end;
end;
$$;

select plan(8);

-- Dov is the super admin, Ada an admin, Cai a moderator; Bea is a member.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd']) x;
insert into public.admin_role_grants (user_id, role) values
  ('00000000-0000-4000-8000-00000000000d', 'super_admin'),
  ('00000000-0000-4000-8000-00000000000a', 'admin'),
  ('00000000-0000-4000-8000-00000000000c', 'moderator');

select is(pg_temp.act('a', $$select public.admin_set_verification_level('00000000-0000-4000-8000-00000000000b', 2::smallint, 'ID checked')::text$$),
  '2', 'an admin raises a member to the identity-document level');
select is((select verification_level from public.users where id = '00000000-0000-4000-8000-00000000000b'), 2::smallint,
  '… and the member is verified from now on');
select is((select (e.metadata ->> 'from') || '>' || (e.metadata ->> 'to') || ':' || (e.metadata ->> 'reason')
             from audit.events e where e.action = 'verification_level_set'),
  '0>2:ID checked', 'the change is audited with its reason');
select is(pg_temp.act('c', $$select public.admin_set_verification_level('00000000-0000-4000-8000-00000000000b', 1::smallint, 'x')::text$$),
  'forbidden', 'a moderator cannot set a level');
select is(pg_temp.act('a', $$select public.admin_set_verification_level('00000000-0000-4000-8000-00000000000a', 2::smallint, 'me')::text$$),
  'self_verification', 'nobody verifies themselves');
select is(pg_temp.act('a', $$select public.admin_set_verification_level('00000000-0000-4000-8000-00000000000b', 3::smallint, 'badge')::text$$)
    || '|' || pg_temp.act('d', $$select public.admin_set_verification_level('00000000-0000-4000-8000-00000000000b', 3::smallint, 'badge')::text$$),
  'forbidden|3', 'the badge level is the super admin''s decision');
select is(pg_temp.act('a', $$select public.admin_set_verification_level('00000000-0000-4000-8000-00000000000b', 2::smallint, '  ')::text$$),
  'invalid_input', 'a reason is required');
select is(pg_temp.act(null, $$select public.admin_set_verification_level('00000000-0000-4000-8000-00000000000b', 2::smallint, 'x')::text$$),
  'permission denied for function admin_set_verification_level', 'signed out, nothing');

select * from finish();
rollback;
