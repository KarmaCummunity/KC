-- KC support channels (FR-DONATE-011, M20): everyone lists the active channels, the payee
-- phone reaches signed-in members only, only the super admin writes, and a bad link or
-- phone is refused.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as a member (anon when null); its one value as text, 'ok', or the
-- error message / SQLSTATE.
create function pg_temp.as_member(p_who text, p_sql text)
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
    return coalesce(v_value, 'ok');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case when sqlstate in ('P0001', '42501') then sqlerrm else sqlstate end;
  end;
end;
$$;

select plan(9);

-- a super admin · b moderator · c member.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c']) x;
insert into public.admin_role_grants (user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'super_admin'),
  ('00000000-0000-4000-8000-00000000000b', 'moderator');

select is(pg_temp.as_member(null, $$select string_agg(channel || ':' || provider_label, ',') from public.list_kc_support_channels()$$),
  'bit:Bit,paybox:PayBox', 'guests list the seeded interim channels');
select is(pg_temp.as_member('a', $$update public.kc_support_channels set payee_phone = '0501234567'
    where channel in ('bit', 'paybox') returning 'ok'$$), 'ok', 'the super admin sets the payee phone');
select is(pg_temp.as_member('c', $$select string_agg(coalesce(payee_phone, '-'), ',') from public.list_kc_support_channels()$$)
    || ' ' || pg_temp.as_member(null, $$select string_agg(coalesce(payee_phone, '-'), ',') from public.list_kc_support_channels()$$),
  '0501234567,0501234567 -,-', 'a signed-in member gets the phone, a guest never does');
select is(pg_temp.as_member('a', $$insert into public.kc_support_channels (channel, url, provider_label)
    values ('card_one_time', 'https://pay.example.test/kc', 'Grow') returning 'ok'$$)
    || ' ' || pg_temp.as_member('a', $$update public.kc_support_channels set is_active = false where channel = 'paybox' returning 'ok'$$),
  'ok ok', 'the super admin adds a card page and pauses a channel');
select is(pg_temp.as_member('c', $$select string_agg(channel, ',') from public.list_kc_support_channels()$$),
  'bit,card_one_time', 'a paused channel is not listed');
select is(pg_temp.as_member('b', $$update public.kc_support_channels set url = 'https://evil.example.test' returning 'x'$$)
    || ' ' || pg_temp.as_member('c', $$select count(*) from public.kc_support_channels$$),
  'ok 0', 'nobody but the super admin changes or reads the rows directly');
select is(pg_temp.as_member('a', $$update public.kc_support_channels set url = 'http://x.test' where channel = 'bit' returning 'x'$$)
    || ' ' || pg_temp.as_member('a', $$update public.kc_support_channels set url = 'https://user:pw@x.test' where channel = 'bit' returning 'x'$$),
  '23514 23514', 'a plain-http or credentialed link is refused');
select is(pg_temp.as_member('a', $$update public.kc_support_channels set payee_phone = '0501234567' where channel = 'card_one_time' returning 'x'$$),
  '23514', 'a payee phone belongs to a phone-addressed channel only');
select is((select count(*) from audit.events where action like 'kc_support_channel_%'), 4::bigint,
  'every row change is audited: two phones, one page, one pause');

select * from finish();
rollback;
