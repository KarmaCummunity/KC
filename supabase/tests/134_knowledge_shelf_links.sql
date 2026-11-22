-- knowledge_shelf_links (FR-KNOW-012 AC2, #2038): everyone reads live rows; only a platform
-- admin writes. Requires the knowledge_shelf_links migration.
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

select plan(8);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(string_to_array('a,b', ',')) x;
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000a', 'admin');

-- Seeded Kol Zchut link is readable by guests and members.
select is(
  pg_temp.val('anon',
    $$select count(*)::text from public.knowledge_shelf_links
      where shelf_slug = 'rights_legal_aid' and link_slug = 'kol_zchut' and is_active$$),
  '1',
  'anon reads the seeded rights & legal aid Kol Zchut link');

select is(
  pg_temp.val('b',
    $$select count(*)::text from public.knowledge_shelf_links
      where shelf_slug = 'rights_legal_aid' and is_active$$),
  '1',
  'a member reads active shelf links');

-- Member cannot write; admin can.
select is(
  pg_temp.act('b',
    $$insert into public.knowledge_shelf_links
        (shelf_slug, link_slug, label_he, label_en, url)
      values ('rights_legal_aid', 'mine', 'שלי', 'Mine', 'https://example.test')$$),
  '42501',
  'an ordinary member cannot insert a shelf link');

select is(
  pg_temp.act('a',
    $$insert into public.knowledge_shelf_links
        (shelf_slug, link_slug, label_he, label_en, url, is_active)
      values ('rights_legal_aid', 'hidden', 'מוסתר', 'Hidden', 'https://example.test/h', false)$$),
  'ok',
  'a platform admin can insert a shelf link');

select is(
  pg_temp.val('b',
    $$select count(*)::text from public.knowledge_shelf_links where link_slug = 'hidden'$$),
  '0',
  'a member does not see an inactive shelf link');

select is(
  pg_temp.val('a',
    $$select count(*)::text from public.knowledge_shelf_links where link_slug = 'hidden'$$),
  '1',
  'a platform admin sees inactive shelf links');

select is(
  pg_temp.act('b',
    $$update public.knowledge_shelf_links set label_he = 'changed' where link_slug = 'kol_zchut'$$),
  '42501',
  'an ordinary member cannot update a shelf link');

select is(
  pg_temp.act('a',
    $$update public.knowledge_shelf_links set label_en = 'Kol Zchut Israel' where link_slug = 'kol_zchut'$$)
  || pg_temp.val('anon',
    $$select label_en from public.knowledge_shelf_links where link_slug = 'kol_zchut'$$),
  'okKol Zchut Israel',
  'a platform admin can update a shelf link and guests see it');

select * from finish();
rollback;
