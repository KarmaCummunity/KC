-- Foundation · an outbox claim never takes more than its limit (KC#2494)
--
-- outbox_claim picked its rows with `id IN (SELECT … LIMIT n FOR UPDATE SKIP LOCKED)`. When the
-- planner runs that subquery on the inner side of a nested loop it re-executes it for each
-- outer row, and the row this statement had just claimed is then skipped as locked, so the next
-- run returns the next row: every due event of the topic was claimed, whatever the limit. Batch
-- consumers processed what they got, but a consumer that claims one event at a time (the
-- time-budgeted match_process) left the extra events claimed and idle until the visibility
-- timeout. `= ANY (ARRAY (…))` makes the subquery an init plan, evaluated exactly once.

create or replace function kc_private.outbox_claim(
  p_topic text,
  p_limit integer default 50,
  p_visibility_timeout interval default interval '2 minutes'
)
returns setof kc_private.outbox_events
language sql
security definer
set search_path = ''
as $$
  update kc_private.outbox_events e
     set claimed_at = now(),
         attempts = e.attempts + 1
   where e.id = any (array(
           select c.id
             from kc_private.outbox_events c
            where c.topic = p_topic
              and c.processed_at is null
              and c.available_at <= now()
              and (c.claimed_at is null or c.claimed_at <= now() - p_visibility_timeout)
            order by c.available_at, c.id
            limit least(greatest(p_limit, 1), 500)
              for update skip locked))
  returning e.*;
$$;
comment on function kc_private.outbox_claim(text, integer, interval) is
  'Claims a batch of due events for a worker; safe under concurrency; never more than the limit.';
