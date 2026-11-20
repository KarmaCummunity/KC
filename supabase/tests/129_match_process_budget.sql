-- Matching · the time budget of the `match` consumer (KC#2494): a run that spent its budget
-- still performs one event, leaves the events it did not reach unclaimed with their place and
-- attempts, and the next run performs them, so a backlog is deferred and never dropped; the
-- event limit holds; the budget is a bounded settings value; one function answers the job.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(9);

-- Events for posts that do not exist: the engine skips such a post and the event completes,
-- so the run's bookkeeping is all that is measured here.
create function pg_temp.enqueue(p_count integer, p_tag text)
returns void
language sql
as $$
  select kc_private.outbox_enqueue('match', jsonb_build_object('post_id', md5(p_tag || n)::uuid))
    from generate_series(1, p_count) n;
$$;

create function pg_temp.match_events(p_state text)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = 'match'
     and case p_state
           when 'processed' then e.processed_at is not null
           when 'waiting' then e.processed_at is null and e.claimed_at is null and e.attempts = 0
         end;
$$;

-- Only this test's events are in the queue (a scheduler cannot see uncommitted rows).
delete from kc_private.outbox_events where topic = 'match';
select pg_temp.enqueue(5, 'backlog-');

-- ── A spent budget defers, it does not drop ─────────────────────────────────
select is(kc_private.match_process(100, interval '0 seconds'), 1,
  'a run past its budget still performs one event, so the queue always moves');
select is(pg_temp.match_events('waiting'), 4::bigint,
  'the events it did not reach were never claimed: they keep their place and their attempts');
select is(kc_private.match_process(), 4, 'the next run performs the rest');
select is(pg_temp.match_events('processed') || '/' || pg_temp.match_events('waiting'), '5/0',
  'every event of the backlog was performed once; none was dropped');

-- ── The event limit holds ───────────────────────────────────────────────────
select pg_temp.enqueue(3, 'limit-');
select is(kc_private.match_process(2), 2, 'a run performs at most p_limit events');
select is(pg_temp.match_events('waiting'), 1::bigint, 'the event past the limit stays unclaimed');

-- ── The budget setting ──────────────────────────────────────────────────────
select is((select s.run_budget_seconds from kc_private.matching_settings s), 20,
  'a run spends at most 20 seconds starting new posts by default');
select throws_ok($$update kc_private.matching_settings set run_budget_seconds = 91$$, '23514', null,
  'the budget stays below the job timeout');

select is((select count(*) from pg_catalog.pg_proc p
            where p.pronamespace = 'kc_private'::regnamespace and p.proname = 'match_process'), 1::bigint,
  'one match_process function answers the scheduled job''s call');

select * from finish();
rollback;
