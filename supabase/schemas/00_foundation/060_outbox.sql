-- Foundation · outbox (asynchronous side effects)
--
-- A write that has consequences outside its own table — a push notification, a matching
-- run, an embedding refresh, a karma entry — records one event here in the same transaction
-- and returns. Workers (Edge Functions running as the service role) claim events in batches
-- and perform the work, so a member's request never waits for it and a failed side effect
-- never rolls back the write. Delivery is at-least-once: consumers must be idempotent.

create table kc_private.outbox_events (
  id           bigint generated always as identity primary key,
  -- Consumer routing key, e.g. 'notification', 'match', 'embedding'.
  topic        text not null check (topic ~ '^[a-z][a-z0-9_.]{1,62}$'),
  payload      jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at   timestamptz not null default now(),
  -- Not before this time (retry back-off and delayed events).
  available_at timestamptz not null default now(),
  -- Set while a worker holds the event; a claim older than the visibility timeout is retried.
  claimed_at   timestamptz,
  attempts     integer not null default 0 check (attempts >= 0),
  -- Set when the consumer confirms success; processed rows are purged by retention.
  processed_at timestamptz,
  last_error   text
);
comment on table kc_private.outbox_events is 'Transactional outbox: side effects recorded with the write, performed later by workers.';

-- Claim query: unprocessed events of a topic that are due, oldest first.
create index outbox_events_due_idx on kc_private.outbox_events (topic, available_at, id)
  where processed_at is null;
-- Retention job: processed events older than the retention window.
create index outbox_events_processed_idx on kc_private.outbox_events (processed_at)
  where processed_at is not null;

alter table kc_private.outbox_events enable row level security;
alter table kc_private.outbox_events force row level security;

-- Records one event. Called from triggers and RPCs inside the writing transaction.
create function kc_private.outbox_enqueue(
  p_topic text,
  p_payload jsonb,
  p_available_at timestamptz default now()
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into kc_private.outbox_events (topic, payload, available_at)
  values (p_topic, p_payload, p_available_at)
  returning id;
$$;
comment on function kc_private.outbox_enqueue(text, jsonb, timestamptz) is
  'Records a side-effect event in the current transaction.';

-- Hands a worker up to p_limit due events of a topic and marks them claimed. Concurrent
-- workers never receive the same event (SKIP LOCKED); an event whose worker died becomes
-- claimable again after p_visibility_timeout.
create function kc_private.outbox_claim(
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
   where e.id in (
           select c.id
             from kc_private.outbox_events c
            where c.topic = p_topic
              and c.processed_at is null
              and c.available_at <= now()
              and (c.claimed_at is null or c.claimed_at <= now() - p_visibility_timeout)
            order by c.available_at, c.id
            limit least(greatest(p_limit, 1), 500)
              for update skip locked)
  returning e.*;
$$;
comment on function kc_private.outbox_claim(text, integer, interval) is
  'Claims a batch of due events for a worker; safe under concurrency.';

-- Confirms an event: success marks it processed; failure releases it for a retry after
-- p_retry_in and keeps the error for diagnosis.
create function kc_private.outbox_complete(
  p_event_id bigint,
  p_error text default null,
  p_retry_in interval default interval '1 minute'
)
returns void
language sql
security definer
set search_path = ''
as $$
  update kc_private.outbox_events e
     set processed_at = case when p_error is null then now() end,
         claimed_at = null,
         available_at = case when p_error is null then e.available_at else now() + p_retry_in end,
         last_error = p_error
   where e.id = p_event_id
     and e.processed_at is null;
$$;
comment on function kc_private.outbox_complete(bigint, text, interval) is
  'Marks a claimed event processed, or schedules its retry with the error recorded.';
