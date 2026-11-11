-- M07: a rater reads back their own ratings; the ratee never reads a rating, only the public
-- summary on user_stats (count always, average from three ratings), kept by a trigger.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.expand(p_sql text)
returns text language sql as $$
  select regexp_replace(regexp_replace(p_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g'),
                        '#(\d\d)', '''10000000-0000-4000-8000-0000000000\1''::uuid', 'g');
$$;

-- One value of a query run as a member; an error returns its SQLSTATE or P0001 message.
create function pg_temp.q(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
  v_sql constant text := pg_temp.expand(p_sql);
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return coalesce(v_value, '~');
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;

select plan(15);

-- a owns three posts handed over to b, c and d, and one to e. e does not rate.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'items_kind', 'items', 'items', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, post_type, direction, status, title, city_id)
select ('10000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001',
       'standard', 'offer', 'open', 'post ' || n, 'c1'
  from generate_series(1, 4) n;
insert into public.post_handoffs (post_id, recipient_id, status)
select ('10000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       ('00000000-0000-4000-8000-00000000000' || x)::uuid, 'handed_over'
  from unnest(array['b', 'c', 'd', 'e']) with ordinality t (x, n);

select is(pg_temp.q('b', $$select public.rate_handoff((select id from public.post_handoffs where recipient_id = @b), 5)::text$$), '', 'the first member rates the owner');
select is(pg_temp.q('a', $$select public.rate_handoff((select id from public.post_handoffs where recipient_id = @b), 2, 'ok')::text$$), '', 'the owner rates back');
select is(pg_temp.q('b', $$select count(*)::text from public.post_ratings$$), '1', 'the rater reads back the rating they gave');
select is(pg_temp.q('b', $$select stars::text from public.post_ratings where ratee_id = @a$$), '5', 'with its stars, for "rated by me" on a booking list');
select is(pg_temp.q('a', $$select count(*)::text from public.post_ratings where ratee_id = @a$$), '0', 'the ratee cannot read the rating written about them');
select is(pg_temp.q('c', $$select count(*)::text from public.post_ratings$$), '0', 'a stranger reads no rating');
select is(pg_temp.q('c', $$select ratings_stars_total::text from public.user_stats where user_id = @a$$), '42501', 'the star total is not a readable column');
select is(pg_temp.q('c', $$select ratings_count || '|' || coalesce(ratings_avg::text, '~') from public.user_stats where user_id = @a$$), '1|~',
  'the count is public and the average stays hidden under three ratings');
select is(pg_temp.q('c', $$select public.rate_handoff((select id from public.post_handoffs where recipient_id = @c), 4)::text$$), '', 'a second member rates the owner');
select is(pg_temp.q('d', $$select public.rate_handoff((select id from public.post_handoffs where recipient_id = @d), 3)::text$$), '', 'and a third');
select is(pg_temp.q('e', $$select ratings_count || '|' || ratings_avg from public.user_stats where user_id = @a$$), '3|4.0', 'from three ratings the average is shown, to one decimal');
select is(pg_temp.q('e', $$select ratings_count || '|' || coalesce(ratings_avg::text, '~') from public.user_stats where user_id = @b$$), '1|~', 'the owner''s rating of b counts for b');
delete from public.post_ratings where rater_id = '00000000-0000-4000-8000-00000000000d';
select is(pg_temp.q('e', $$select ratings_count || '|' || coalesce(ratings_avg::text, '~') from public.user_stats where user_id = @a$$), '2|~', 'removing a rating takes it out of the summary');
update public.users set privacy_mode = 'Private' where id = '00000000-0000-4000-8000-00000000000a';
select is(pg_temp.q('e', $$select count(*)::text from public.user_stats where user_id = @a$$), '1',
  'the summary is visible exactly when the profile is (a private profile is still listed)');
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000e');
select is(pg_temp.q('e', $$select count(*)::text from public.user_stats where user_id = @a$$), '0', 'and hidden from a member the owner blocked');

select * from finish();
rollback;
