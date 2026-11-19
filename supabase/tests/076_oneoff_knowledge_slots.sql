-- One-off knowledge slots (#2478). Full Supabase regression; requires the new migration.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Shorthand inside SQL text: @a … @d members, #name the post titled `name`.
create function pg_temp.expand(p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '#(\w+)', 'g') loop
    v_sql := regexp_replace(v_sql, '#' || v_match[1] || '\M', coalesce(quote_literal((
      select p.id from public.posts p where p.title = v_match[1])), 'null') || '::uuid');
  end loop;
  return regexp_replace(v_sql, '@([a-d])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
end;
$$;

-- Runs a statement as a member (anon when null): 'ok', the P0001 message, or the SQLSTATE.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who,
      'role', case when p_who is null then 'anon' else 'authenticated' end)::text, true);
    perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
    execute v_sql;
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

-- One value read as a member, or as the database owner when p_who is null.
create function pg_temp.val(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
  v_value text;
begin
  if p_who is not null then
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_value;
end;
$$;

-- FR-KNOW-004 AC1 (#2478): explicit one-off times reach the same rows the
-- learner reads/books, atomically, without changing recurring-series ownership.
-- Run after migrations through next-01_oneoff_knowledge_slots.sql.
create function pg_temp.windows(p_days integer[], p_capacity integer default 2)
returns jsonb language sql as $$
  select jsonb_build_object('capacity_per_slot', p_capacity, 'slots', jsonb_agg(
    jsonb_build_object('starts_at', now() + make_interval(days => d),
                      'ends_at', now() + make_interval(days => d, hours => 1)) order by d))
    from unnest(p_days) d;
$$;
create function pg_temp.make(p_title text, p_details jsonb, p_kind text default 'lesson_offer')
returns text language sql as $$
  select pg_temp.act('a', format($q$insert into public.posts
    (owner_id, world_slug, kind_id, direction, status, title, city_id, details)
    select @a, 'knowledge', id, 'offer', 'draft', %L, 'c1', %L::jsonb
      from public.post_kinds where slug = %L$q$, p_title, p_details, p_kind));
$$;
create function pg_temp.edit(p_title text, p_details jsonb)
returns text language sql as $$
  select pg_temp.act('a', format('update public.posts set details = %L::jsonb where id = #%s',p_details,p_title));
$$;
select plan(26);
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('knowledge', 'knowledge', 'knowledge');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction)
select 'knowledge', s, s, s, 'offer' from unnest(array['lesson_offer', 'consulting_hour', 'mentoring_offer']) s;

select is(pg_temp.make('oneoff', pg_temp.windows(array[2,3])), 'ok', 'create path writes the draft and its explicit times');
select is(pg_temp.val(null, $$select count(*) || '|' || bool_and(capacity = 2) from public.post_knowledge_slots where post_id = #oneoff$$),
  '2|true', 'one row per selected time with the selected capacity');
select is(pg_temp.act('a', $$select public.publish_post(#oneoff)$$), 'ok', 'the app draft publishes');
select is(pg_temp.val('b', $$select count(*) from public.knowledge_slot_seats(#oneoff)$$), '2', 'learner sees both actual slot rows through the app read RPC');
select is(pg_temp.act('b', $$select public.book_knowledge_seat((select id from public.post_knowledge_slots where post_id = #oneoff order by starts_at limit 1))$$),
  'ok', 'learner books a synced time through the app booking RPC');
select is(pg_temp.val(null, $$select expires_at = now() + interval '3 days 1 hour 30 minutes' from public.posts where id = #oneoff$$),
  'true', 'expiry follows the final slot');
select is(pg_temp.edit('oneoff', pg_temp.windows(array[3,4])), 'knowledge_slot_has_booking', 'booked time cannot be removed or moved');
select is(pg_temp.edit('oneoff', jsonb_set(pg_temp.windows(array[2,3]), '{slots,0,ends_at}', to_jsonb(now() + interval '2 days 2 hours'))),
  'knowledge_slot_has_booking', 'booked end cannot change');
-- Remember identities before editing a neighbouring, unbooked time.
create temp table slot_ids as select id, starts_at from public.post_knowledge_slots;
select is(pg_temp.edit('oneoff', pg_temp.windows(array[2,4,5])), 'ok', 'open offer edit adds, moves and removes unbooked times');
select is(pg_temp.val(null, $$select count(*) || '|' || count(*) filter (where s.id in (select id from pg_temp.slot_ids))
  from public.post_knowledge_slots s where post_id = #oneoff$$), '3|1', 'booked row identity stays; new times have their own rows');
select is(pg_temp.edit('oneoff', '{"note":"lost slots"}'), 'knowledge_slot_invalid', 'dropping the entire list is not a silent bypass');
select is(pg_temp.val(null, $$select jsonb_array_length(details->'slots') || '|' || count(s.*)
  from public.posts p join public.post_knowledge_slots s on s.post_id = p.id where p.id = #oneoff group by p.id$$),
  '3|3', 'failed edits roll back post details and all slot writes');
select is(pg_temp.make('pastfail', pg_temp.windows(array[2,-1])) || '|' ||
  pg_temp.val(null, $$select count(*) from public.posts where title = 'pastfail'$$),
  'knowledge_slot_in_past|0', 'one invalid time leaves neither a post nor partial slots');
select is(pg_temp.make('badshape', '{"slots":null}') || '|' || pg_temp.make('empty', '{"slots":[]}'),
  'knowledge_slot_invalid|knowledge_slot_invalid', 'explicit slot lists must be nonempty arrays');
select is(pg_temp.make('duplicate', pg_temp.windows(array[2,2])), 'knowledge_slots_overlap', 'duplicate and overlapping times are refused');
select is(pg_temp.make('badcap', pg_temp.windows(array[2],0)), 'knowledge_slot_invalid', 'invalid capacity is refused');
select is(pg_temp.make('consult', pg_temp.windows(array[2]), 'consulting_hour') || '|' ||
  pg_temp.val(null, $$select count(*) from public.post_knowledge_slots where post_id = #consult$$),
  'ok|1', 'consulting hours use the same one-off path');
select is(pg_temp.make('weekly', '{}') || '|' || pg_temp.val(null, $$select count(*) from public.post_knowledge_slots where post_id = #weekly$$),
  'ok|0', 'weekly create draft without explicit slots remains valid');
select is(pg_temp.act('a', $$select public.start_knowledge_slot_series(#weekly,127,'18:00',60,2,null)$$),
  'ok', 'weekly beforePublish RPC still starts its series');
select is(pg_temp.edit('weekly', pg_temp.windows(array[40])), 'knowledge_series_has_slots', 'active series refuses one-off injection');
select is(pg_temp.act('a', $$select public.set_knowledge_slot_series_status(#weekly,'paused')$$) || '|' ||
  pg_temp.edit('weekly', pg_temp.windows(array[40])), 'ok|knowledge_series_has_slots', 'paused series also refuses one-offs');
select is(pg_temp.act('a', $$select public.set_knowledge_slot_series_status(#weekly,'ended')$$) || '|' ||
  pg_temp.edit('weekly', pg_temp.windows(array[40])), 'ok|ok', 'ended series permits new one-offs under the existing policy');
select is(pg_temp.make('notimes', '{}', 'mentoring_offer') || '|' || pg_temp.val(null,
  $$select count(*) from public.post_knowledge_slots where post_id = #notimes$$), 'ok|0', 'non-slot kinds are unchanged');
select is(pg_temp.act('b', format($$update public.posts set details = %L::jsonb where id = #oneoff$$,
  pg_temp.windows(array[6]))) || '|' || pg_temp.val(null, $$select count(*) from public.post_knowledge_slots where post_id = #oneoff$$),
  'ok|3', 'nonowner update cannot alter post details or slots under RLS');
select is(pg_temp.edit('oneoff', jsonb_set(pg_temp.windows(array[2,4,5]), '{note}', '"text edit"')),
  'ok', 'unrelated details edit leaves booked slots intact');
select is(pg_temp.val(null, $$select count(*) from public.post_knowledge_slots where post_id = #oneoff and series_id is not null$$),
  '0', 'one-off sync never invents series membership');
select * from finish();
rollback;
