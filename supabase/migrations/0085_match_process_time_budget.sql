-- Matching · a time budget for each run of the `match` consumer (KC#2494)
--
-- `match_process` claimed up to 100 events at once and computed every one of them, so one
-- run could take as long as its backlog: 31 s runs were observed on kc-dev, long enough to
-- overlap the per-minute job fleet. A run now stops starting new posts once its budget is
-- spent and leaves the rest of the queue for the next run (every 2 minutes):
--   * events are claimed one at a time, so an event the run does not reach is never claimed
--     and keeps its place, attempt count and due time; nothing is dropped, only deferred;
--   * the budget is checked before each post, so a run ends at most one post's computation
--     past it, and always performs at least one event, so a slow post never stalls the queue;
--   * the budget is a row value of kc_private.matching_settings, tuned like the other knobs.
-- The announce step still runs at the end of every run; it is bounded by its own limit.

alter table kc_private.matching_settings
  add column run_budget_seconds integer not null default 20
    check (run_budget_seconds between 1 and 90);
comment on column kc_private.matching_settings.run_budget_seconds is
  'Seconds one match_process run may spend starting new posts; the rest waits for the next run. Below the job timeout (100 s).';

-- The signature gains the budget argument, so the one-argument function is replaced rather
-- than overloaded (`select kc_private.match_process()` must keep resolving to one function).
drop function kc_private.match_process(integer);

-- Worker entry point: performs due `match` events oldest first, one claim at a time, until
-- p_limit events, an empty queue or the time budget (p_budget, or the settings value when
-- null). Each named post is recomputed once per run. A failing post is released for a retry
-- with its error and does not stop the run. Then announces. Returns the number of events
-- performed. Needs no service outside the database, so it is run by a scheduled job.
create function kc_private.match_process(p_limit integer default 100, p_budget interval default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- clock_timestamp, not now(): now() is frozen at the start of the job's transaction.
  v_started constant timestamptz := clock_timestamp();
  v_budget interval := p_budget;
  v_event record;
  v_seen uuid[] := '{}';
  v_done integer := 0;
  v_attempted integer := 0;
begin
  if v_budget is null then
    select make_interval(secs => s.run_budget_seconds) into v_budget from kc_private.matching_settings s;
  end if;

  while v_attempted < greatest(p_limit, 1) loop
    -- Past the budget, stop before starting another post; the first event always runs.
    exit when v_attempted > 0 and clock_timestamp() - v_started >= v_budget;

    select e.id, (e.payload ->> 'post_id')::uuid as post_id
      into v_event
      from kc_private.outbox_claim('match', 1) e;
    exit when not found;
    v_attempted := v_attempted + 1;

    begin
      if v_event.post_id <> all (v_seen) then
        perform kc_private.match_compute_for_post(v_event.post_id);
        v_seen := v_seen || v_event.post_id;
      end if;
      perform kc_private.outbox_complete(v_event.id);
      v_done := v_done + 1;
    exception when others then
      -- A failed event is due again after the retry delay, so this run does not claim it twice.
      perform kc_private.outbox_complete(v_event.id, sqlerrm);
      update kc_private.match_state s set last_error = sqlerrm where s.post_id = v_event.post_id;
    end;
  end loop;

  perform kc_private.match_announce();
  return v_done;
end;
$$;
comment on function kc_private.match_process(integer, interval) is
  'Performs due match events one claim at a time within a time budget, then announces new pairs; run by a scheduled job.';
