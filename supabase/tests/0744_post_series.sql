-- supabase/tests/0744_post_series.sql
-- FR-POST-024: a recurring organization event publishes one event post per date, idempotently;
-- edit all keeps a registered date; cancel one, pause / resume and end behave as the spec says and
-- tell registrants; the schedule and ownership checks hold; the clock-change rule.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('ps_organizer') as organizer,
       kc_test.create_user('ps_guest')     as guest,
       kc_test.create_user('ps_outsider')  as outsider,
       gen_random_uuid()                   as org_id;

insert into public.organizations (org_id, name, slug)
select org_id, 'Post series test org', 'post-series-test-org' from personas;
insert into public.org_memberships (org_id, user_id, role)
select org_id, organizer, 'org_admin' from personas;

-- Three hours from now, as an Israel wall-clock time.
create temp table clock as
select ((now() + interval '3 hours') at time zone 'Asia/Jerusalem')::time as at3h;

-- Creates a series of the organization's event as the organizer.
create function pg_temp.series(p_weekdays int default 127, p_time time default null) returns uuid
language plpgsql as $$
declare
  p personas;
  v uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.organizer);
  select s.series_id into v from public.create_post_series(
    p_kind_id => kc_test.listing_kind_id('time', 'org_event'),
    p_title => 'Weekly garden day',
    p_details => jsonb_build_object('org_id', p.org_id::text, 'registration_policy', 'automatic', 'capacity', 5),
    p_start_time => coalesce(p_time, (select at3h from clock)),
    p_duration_minutes => 120,
    p_weekdays => p_weekdays,
    p_city_id => 'tel-aviv') s;
  return v;
end $$;

create function pg_temp.scheduled(p_series uuid) returns bigint language sql as $$
  select count(*) from public.post_series_occurrences where series_id = p_series and status = 'scheduled'
$$;

-- The dates of the coming 30 days whose start is still ahead.
create function pg_temp.expected_days(p_time time) returns bigint language sql as $$
  select count(*) from generate_series((now() at time zone 'Asia/Jerusalem')::date,
                                       (now() at time zone 'Asia/Jerusalem')::date + 30, interval '1 day') d
   where kc_private.series_local_instant(d::date, p_time, 'Asia/Jerusalem') > now()
$$;

-- ── 1. Publishing: one event post per date, the marker, the feed, idempotency ───
do $$
declare
  v_series uuid := pg_temp.series();
  v_first public.posts;
  v_n bigint;
begin
  v_n := pg_temp.expected_days((select at3h from clock));
  perform kc_test.assert_eq(pg_temp.scheduled(v_series), v_n, 'every date of the coming month is published');

  select p.* into v_first from public.posts p
    join public.post_series_occurrences o on o.post_id = p.post_id
   where o.series_id = v_series order by o.starts_at limit 1;
  perform kc_test.assert_eq(v_first.post_type, 'event', 'a date is an event post');
  perform kc_test.assert_eq(v_first.details -> 'post_series' ->> 'id', v_series::text, 'it names its series');
  perform kc_test.assert_true(exists (select 1 from public.event_post_details e where e.post_id = v_first.post_id),
    'it takes registrations like any event');
  perform kc_test.assert_eq(
    (select count(*) from public.posts p join public.post_series_occurrences o on o.post_id = p.post_id
      where o.series_id = v_series and not p.feed_hidden and o.post_id <> v_first.post_id),
    0::bigint, 'only the soonest date can reach the main feed');

  perform kc_test.act_as_anon();
  perform public.post_series_sweep();
  perform kc_test.assert_eq(pg_temp.scheduled(v_series), v_n, 'a second run publishes nothing twice');
  perform kc_test.assert_true(
    (select count(*) from public.list_post_series_occurrences(v_series, 31)) >= 1,
    'anyone sees the upcoming dates of a public event');
end $$;

-- ── 2. Edit all keeps a registered date; cancel one tells its registrant ────────
do $$
declare
  p personas;
  v_series uuid := pg_temp.series();
  v_reg public.post_series_occurrences;
  v_other public.post_series_occurrences;
  v_n bigint;
begin
  select * into p from personas;
  select * into v_reg from public.post_series_occurrences where series_id = v_series order by starts_at limit 1;
  perform kc_test.act_as(p.guest);
  perform public.register_for_event(v_reg.post_id);

  perform kc_test.act_as(p.organizer);
  perform public.update_post_series(v_series, 'Weekly garden day, later', '{"registration_policy":"automatic"}'::jsonb
      || jsonb_build_object('org_id', p.org_id::text), (select at3h from clock) + interval '1 hour', 120, 127);
  perform kc_test.assert_eq(
    (select starts_at from public.post_series_occurrences where series_id = v_series and occurrence_on = v_reg.occurrence_on),
    v_reg.starts_at, 'a date with a registration keeps its time');
  select * into v_other from public.post_series_occurrences
   where series_id = v_series and occurrence_on <> v_reg.occurrence_on order by starts_at limit 1;
  perform kc_test.assert_eq(
    (v_other.starts_at at time zone 'Asia/Jerusalem')::time, (select at3h from clock) + interval '1 hour',
    'a date nobody registered for is published again at the new time');

  perform public.cancel_post_series_occurrence(v_reg.post_id);
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox where user_id = p.guest and kind = 'event_registration_cancelled'),
    1::bigint, 'the registrant of a cancelled date is told');
  perform kc_test.assert_eq(
    (select status from public.post_series_occurrences where series_id = v_series and occurrence_on = v_reg.occurrence_on),
    'cancelled', 'the date stays as a tombstone');
  v_n := pg_temp.scheduled(v_series);
  perform kc_test.act_as_anon();
  perform public.post_series_sweep();
  perform kc_test.assert_eq(pg_temp.scheduled(v_series), v_n, 'a cancelled date is never published again');
end $$;

-- ── 3. Pause keeps a registered date; resume republishes; end cancels everything ─
do $$
declare
  p personas;
  v_series uuid := pg_temp.series();
  v_reg public.post_series_occurrences;
  v_n bigint;
begin
  select * into p from personas;
  v_n := pg_temp.scheduled(v_series);
  select * into v_reg from public.post_series_occurrences where series_id = v_series order by starts_at desc limit 1;
  perform kc_test.act_as(p.guest);
  perform public.register_for_event(v_reg.post_id);

  perform kc_test.act_as(p.organizer);
  perform public.set_post_series_status(v_series, 'paused');
  perform kc_test.assert_eq(pg_temp.scheduled(v_series), 1::bigint, 'a pause keeps only the registered date');
  perform public.set_post_series_status(v_series, 'active');
  perform kc_test.assert_eq(pg_temp.scheduled(v_series), v_n, 'a resume publishes the dates again');

  perform public.set_post_series_status(v_series, 'ended');
  perform kc_test.assert_eq(pg_temp.scheduled(v_series), 0::bigint, 'ending leaves no upcoming date');
  perform kc_test.assert_eq(
    (select p2.status from public.posts p2 where p2.post_id = v_reg.post_id), 'deleted_no_recipient',
    'the registered date is closed');
  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox where user_id = p.guest and kind = 'event_registration_cancelled'),
    2::bigint, 'and its registrant is told');
  perform kc_test.assert_raises(format('select public.set_post_series_status(%L, %L)', v_series, 'active'),
    'post_series_ended', 'an ended series cannot be resumed');
  perform kc_test.assert_raises(format('update public.post_series set status = %L where series_id = %L', 'active', v_series),
    'post_series_transition_invalid', 'the kernel refuses any move out of ended');
end $$;

-- ── 4. Checks: kind, schedule, membership, ownership ──────────────────────────
do $$
declare
  p personas;
  v_series uuid := pg_temp.series(2);  -- Mondays only
  v_kind uuid := kc_test.listing_kind_id('time', 'org_event');
  v_details jsonb;
begin
  select * into p from personas;
  v_details := jsonb_build_object('org_id', p.org_id::text, 'registration_policy', 'automatic');
  perform kc_test.act_as(p.organizer);
  perform kc_test.assert_raises(
    format('select * from public.create_post_series(%L, %L, %L, %L, 60, 127)',
           kc_test.listing_kind_id('items', 'give_item'), 'x', '{}', '10:00'),
    'post_series_kind_unsupported', 'only an organization event recurs in this slice');
  perform kc_test.assert_raises(
    format('select * from public.create_post_series(%L, %L, %L, %L, 60, 0)', v_kind, 'x', v_details, '10:00'),
    'post_series_weekdays_invalid', 'at least one weekday');
  perform kc_test.assert_raises(
    format('select * from public.create_post_series(%L, %L, %L, %L, 5, 127)', v_kind, 'x', v_details, '10:00'),
    'post_series_duration_invalid', 'a sensible duration');
  perform kc_test.assert_raises(
    format('select * from public.create_post_series(%L, %L, %L, %L, 60, 127, null, null, null, %L)',
           v_kind, 'x', v_details, '10:00', 'Mars/Olympus'),
    'post_series_time_zone_invalid', 'a real time zone');

  perform kc_test.act_as(p.outsider);
  perform kc_test.assert_raises(
    format('select * from public.create_post_series(%L, %L, %L, %L, 60, 127)', v_kind, 'x', v_details, '10:00'),
    'event_org_required', 'only a member publishes the organization''s series');
  perform kc_test.assert_raises(format('select public.set_post_series_status(%L, %L)', v_series, 'paused'),
    'post_series_not_found', 'another member''s series is not theirs to manage');

  -- Row security: only the owner reads a series (the test runs as the table owner otherwise).
  set local role authenticated;
  perform kc_test.assert_eq(
    (select count(*) from public.post_series where series_id = v_series), 0::bigint,
    'and they cannot read it');
  reset role;
end $$;

-- ── 5. Clock changes (Israel 2026: forward on 27 March, back on 25 October) ────
do $$
begin
  perform kc_test.assert_eq(kc_private.series_local_instant('2026-03-27', '02:30', 'Asia/Jerusalem'),
    '2026-03-27 00:30:00+00'::timestamptz, 'a time in the spring gap moves forward by the jump (03:30)');
  perform kc_test.assert_eq(kc_private.series_local_instant('2026-10-25', '01:30', 'Asia/Jerusalem'),
    '2026-10-24 22:30:00+00'::timestamptz, 'a time that occurs twice takes the first');
  perform kc_test.assert_eq(kc_private.series_local_instant('2026-11-01', '01:30', 'America/New_York'),
    '2026-11-01 05:30:00+00'::timestamptz, 'the same rule in another time zone');
end $$;

rollback;
