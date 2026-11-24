-- Recurring knowledge lessons (FR-KNOW-003 AC2-AC3, FR-KNOW-004 AC1, issue #2035): a lesson
-- offer runs a weekly series whose slots are kept 30 days ahead, idempotently; the giver
-- pauses, resumes or ends it, upcoming unbooked slots go and booked ones stay; a running
-- series never expires its offer, an ended one falls back to the one-off rule.
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

-- Starts a series on a post as a member: every day at 18:00 Israel time unless told otherwise.
create function pg_temp.start(p_who text, p_post text, p_weekdays integer default 127,
                              p_minutes integer default 60, p_ends_on date default null)
returns text
language sql
as $$
  select pg_temp.act(p_who, format(
    'select public.start_knowledge_slot_series(#%s, %s, %L, %s, 2, %L)',
    p_post, p_weekdays, '18:00', p_minutes, p_ends_on));
$$;

-- Sets the state of a post's series as a member.
create function pg_temp.set_status(p_who text, p_post text, p_status text)
returns text
language sql
as $$
  select pg_temp.act(p_who, format('select public.set_knowledge_slot_series_status(#%s, %L)', p_post, p_status));
$$;

-- Upcoming slots of a post, and how many of them belong to a series.
create function pg_temp.upcoming(p_post text)
returns text
language sql
as $$
  select count(*) || '|' || count(s.series_id)
    from public.post_knowledge_slots s join public.posts p on p.id = s.post_id
   where p.title = p_post and s.starts_at > now();
$$;

-- Lesson days a daily 18:00 series holds from today: today too unless 18:00 already passed.
create function pg_temp.daily_count()
returns text
language sql
as $$
  select count(*) || '|' || count(*)
    from generate_series((now() at time zone 'Asia/Jerusalem')::date,
                         (now() at time zone 'Asia/Jerusalem')::date + 30, interval '1 day') d (day)
   where kc_private.series_local_instant(d.day::date, '18:00', 'Asia/Jerusalem') > now();
$$;

select plan(26);

-- Alice teaches. Bob learns. Carol is another member.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c']) x;
-- D184 / #2038: consulting hours need a complete profile (level ≥ 1), not ID verification.
update public.users set verification_level = 1
  where id = '00000000-0000-4000-8000-00000000000a';
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('knowledge', 'knowledge', 'knowledge');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction)
select 'knowledge', s, s, s, 'offer' from unnest(array['lesson_offer', 'consulting_hour']) s;
insert into public.posts (owner_id, world_slug, kind_id, direction, title, city_id)
select '00000000-0000-4000-8000-00000000000a', 'knowledge', k.id, 'offer', t.title, 'c1'
  from (values ('weekly', 'lesson_offer'), ('oneoff', 'lesson_offer'), ('short', 'lesson_offer'),
               ('consult', 'consulting_hour')) t (title, kind)
  join public.post_kinds k on k.slug = t.kind;
insert into public.post_knowledge_slots (post_id, starts_at, ends_at)
select p.id, now() + interval '2 days', now() + interval '2 days 1 hour' from public.posts p where p.title = 'oneoff';

-- ── Starting a series ───────────────────────────────────────────────────────
select is(pg_temp.start('c', 'weekly'), 'knowledge_series_not_allowed', 'only the giver makes an offer recurring');
select is(pg_temp.start('a', 'consult'), 'knowledge_series_not_allowed', 'only a lesson offer is recurring');
select is(pg_temp.start('a', 'oneoff'), 'knowledge_series_has_slots', 'an offer with upcoming one-off slots is not made recurring');
select is(pg_temp.start('a', 'weekly', 0) || '|' || pg_temp.start('a', 'weekly', 127, 5) || '|'
    || pg_temp.start('a', 'weekly', 127, 60, ((now() at time zone 'Asia/Jerusalem')::date - 1)),
  'knowledge_series_schedule_invalid|knowledge_series_schedule_invalid|knowledge_series_schedule_invalid',
  'weekdays, session length and the last day are checked');
-- Only tomorrow's weekday, but the series ends today: no lesson day at all.
select is(pg_temp.start('a', 'weekly',
    1 << extract(dow from (now() at time zone 'Asia/Jerusalem')::date + 1)::integer, 60,
    (now() at time zone 'Asia/Jerusalem')::date)
    || '|' || pg_temp.val(null, $$select count(*) from public.knowledge_slot_series$$),
  'knowledge_series_no_occurrence|0', 'a series without a lesson day is refused and leaves nothing');
select is(pg_temp.start('a', 'weekly'), 'ok', 'the giver makes a lesson offer recurring');
select is(pg_temp.upcoming('weekly'), pg_temp.daily_count(), 'every lesson day of the next 30 days has its slot');
select is(pg_temp.val(null, $$select count(distinct series_on) || '|' || bool_and(ends_at - starts_at = interval '1 hour')
    || '|' || bool_and(capacity = 2) || '|' || bool_and((starts_at at time zone 'Asia/Jerusalem')::time = '18:00')
    from public.post_knowledge_slots where post_id = #weekly$$),
  split_part(pg_temp.daily_count(), '|', 1) || '|true|true|true',
  'one slot per day, at 18:00 Israel time, with the series length and places');
select is(pg_temp.val(null, $$select expires_at is null from public.posts where title = 'weekly'$$), 'true',
  'a recurring offer never expires');
select is(pg_temp.start('a', 'weekly'), 'knowledge_series_exists', 'an offer has one series');

-- ── The sweep ───────────────────────────────────────────────────────────────
select is(kc_private.knowledge_slot_series_materialize() || '|' || kc_private.knowledge_slot_series_materialize()
    || '|' || pg_temp.upcoming('weekly'), '0|0|' || pg_temp.daily_count(), 'the sweep is idempotent');
select is(pg_temp.val(null, $$select schedule from kc_private.scheduled_jobs where name = 'knowledge_slot_series_materialize'$$),
  '*/10 * * * *', 'the sweep runs every 10 minutes');

-- ── Series slots belong to the schedule ─────────────────────────────────────
select is(pg_temp.act('a', $$delete from public.post_knowledge_slots where post_id = #weekly$$)
    || pg_temp.act('a', $$update public.post_knowledge_slots set capacity = 5 where post_id = #weekly$$)
    || '|' || pg_temp.val(null, $$select count(*) filter (where capacity = 2) from public.post_knowledge_slots where post_id = #weekly$$),
  'okok|' || split_part(pg_temp.daily_count(), '|', 1), 'the giver neither removes nor changes a series slot');
select is(pg_temp.act('a', format($$insert into public.post_knowledge_slots (post_id, starts_at, ends_at)
    values (#weekly, %L, %L)$$, now() + interval '40 days', now() + interval '40 days 1 hour')),
  '42501', 'no one-off slot beside a running series');
select is(pg_temp.val('b', $$select count(*) from public.knowledge_slot_series$$) || '|'
    || pg_temp.act(null, $$select 1 from public.knowledge_slot_series$$),
  '1|42501', 'members read the schedule of a visible offer; guests do not');

-- ── Pause, resume, end ──────────────────────────────────────────────────────
select is(pg_temp.act('b', $$select public.book_knowledge_seat((select id from public.post_knowledge_slots
    where post_id = #weekly order by starts_at offset 1 limit 1))$$), 'ok', 'a learner books a series slot');
select is(pg_temp.set_status('b', 'weekly', 'paused'), 'knowledge_series_not_found', 'only the giver pauses the series');
select is(pg_temp.set_status('a', 'weekly', 'paused') || '|' || pg_temp.upcoming('weekly'), 'ok|1|1',
  'pausing removes the upcoming unbooked slots and keeps the booked one');
select is(kc_private.knowledge_slot_series_materialize() || '|'
    || pg_temp.val(null, $$select expires_at is null from public.posts where title = 'weekly'$$),
  '0|true', 'a paused series adds nothing and its offer still never expires');
select is(pg_temp.set_status('a', 'weekly', 'active') || '|' || pg_temp.upcoming('weekly'), 'ok|' || pg_temp.daily_count(),
  'resuming brings the next 30 days back, the booked day once');
select is(pg_temp.set_status('a', 'weekly', 'someday'), 'unknown_state', 'the series has three states');
select is(pg_temp.set_status('a', 'weekly', 'ended') || '|' || pg_temp.upcoming('weekly') || '|'
    || pg_temp.val(null, $$select p.expires_at = max(s.ends_at) + interval '30 minutes'
         from public.posts p join public.post_knowledge_slots s on s.post_id = p.id where p.title = 'weekly' group by p.expires_at$$),
  'ok|1|1|true', 'ending keeps the booked slot, and the offer expires 30 minutes after it');
select is(pg_temp.set_status('a', 'weekly', 'active'), 'illegal_transition', 'an ended series is never resumed');
select is(pg_temp.act('a', format($$insert into public.post_knowledge_slots (post_id, starts_at, ends_at)
    values (#weekly, %L, %L)$$, now() + interval '40 days', now() + interval '40 days 1 hour')),
  'ok', 'after the series ended the giver adds one-off slots again');

-- ── A series past its last day ──────────────────────────────────────────────
select is(pg_temp.start('a', 'short', 127, 60, (now() at time zone 'Asia/Jerusalem')::date + 7), 'ok',
  'a series may have a last day');
update public.knowledge_slot_series k
   set starts_on = (now() at time zone 'Asia/Jerusalem')::date - 10,
       ends_on = (now() at time zone 'Asia/Jerusalem')::date - 1
  from public.posts p where p.id = k.post_id and p.title = 'short';
select is(kc_private.knowledge_slot_series_materialize() || '|' || pg_temp.val(null,
    $$select k.status || '|' || (p.expires_at is not null) from public.knowledge_slot_series k
        join public.posts p on p.id = k.post_id where p.title = 'short'$$),
  '0|ended|true', 'the sweep ends a series past its last day and its offer expires again');

select * from finish();
rollback;
