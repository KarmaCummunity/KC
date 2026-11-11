-- The owner's own posts in every status (profile_posts_page, tab `mine`, FR-POST-016): every
-- status and audience, narrowed by p_statuses, paged by keyset; nobody else may ask for it.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as a member (anon when null) and returns its one value as text, the
-- P0001 or 42501 message, or the SQLSTATE.
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

select plan(8);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');

-- Alice's posts, oldest first: one of each status the owner can hold, and an "only me" post.
insert into public.posts (owner_id, world_slug, kind_id, direction, status, visibility, title, city_id, created_at)
select '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer', s, v, t, 'c1',
       now() - make_interval(hours => n)
  from (values
    (7, 'open', 'Public', 'p_open'),
    (6, 'draft', 'Public', 'p_draft'),
    (5, 'paused', 'Public', 'p_paused'),
    (4, 'expired', 'Public', 'p_expired'),
    (3, 'closed_delivered', 'Public', 'p_delivered'),
    (2, 'hidden_pending_review', 'Public', 'p_in_review'),
    (1, 'open', 'OnlyMe', 'p_only_me')
  ) as p (n, s, v, t);

select is(pg_temp.as_member('a', $$select string_agg((card).title, ',')
      from public.profile_posts_page('00000000-0000-4000-8000-00000000000a', null, 20, 'mine')$$),
  'p_only_me,p_in_review,p_delivered,p_expired,p_paused,p_draft,p_open',
  'the owner lists every post in every status and audience, newest first');
select is(pg_temp.as_member('a', $$select string_agg((card).status, ',')
      from public.profile_posts_page('00000000-0000-4000-8000-00000000000a', null, 20, 'mine', array['paused', 'expired', 'draft'])$$),
  'expired,paused,draft', 'p_statuses narrows the tab to the listed statuses');
select is(pg_temp.as_member('a', $$with p1 as (
        select * from public.profile_posts_page('00000000-0000-4000-8000-00000000000a', null, 3, 'mine')),
      last as (select next_cursor from p1 order by (card).created_at limit 1)
      select string_agg((card).title, ',') from (
        select p.card from last, public.profile_posts_page('00000000-0000-4000-8000-00000000000a',
          last.next_cursor, 3, 'mine') p) q$$),
  'p_expired,p_paused,p_draft', 'the next page starts after the last row of the previous one');
select is(pg_temp.as_member('a', $$select count(*)::text
      from public.profile_posts_page('00000000-0000-4000-8000-00000000000a', null, 20, 'mine', array['no_such_status'])$$),
  '0', 'an unknown status matches nothing');
select is(pg_temp.as_member('b', $$select count(*)::text
      from public.profile_posts_page('00000000-0000-4000-8000-00000000000a', null, 20, 'mine')$$),
  'forbidden', 'another member cannot list someone else''s posts in every status');
select is(pg_temp.as_member('b', $$select string_agg((card).title, ',')
      from public.profile_posts_page('00000000-0000-4000-8000-00000000000a', null, 20, 'open')$$),
  'p_open', 'the open tab of the same profile still shows that member only the public open post');
select is(pg_temp.as_member('a', $$select count(*)::text
      from public.profile_posts_page('00000000-0000-4000-8000-00000000000a', null, 20, 'everything')$$),
  'invalid_input', 'an unknown tab is refused');
select is(pg_temp.as_member(null, $$select count(*)::text
      from public.profile_posts_page('00000000-0000-4000-8000-00000000000a', null, 20, 'mine')$$),
  'permission denied for function profile_posts_page', 'a signed-out caller cannot call it');

select * from finish();
rollback;
