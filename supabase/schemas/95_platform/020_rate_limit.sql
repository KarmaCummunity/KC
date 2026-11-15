-- Platform · rate limiting (design §4 "Abuse", NFR-SEC-009)
--
-- One counter table and one function for every write a member can repeat. A limit is a
-- row of kc_private.rate_limits (vocabulary, like the state machines): the action, how many
-- times, in which window. A write path enforces it with one line:
--
--   perform kc_private.rate_limit_enforce('<action>', <member id>);
--
-- Windows are fixed and start at the first counted write: after `window` has passed the
-- next write opens a new one. The counter moves in the writing transaction, so a write
-- that is rolled back is not counted.

create table kc_private.rate_limits (
  action      text primary key check (action ~ '^[a-z][a-z0-9_]{1,62}$'),
  max_count   integer not null check (max_count > 0),
  "window"    interval not null check ("window" > interval '0'),
  description text not null
);
comment on table kc_private.rate_limits is 'Configuration: how often a member may repeat each limited action.';
alter table kc_private.rate_limits enable row level security;
alter table kc_private.rate_limits force row level security;

-- One row per key that was counted recently. Unlogged: the counters are worth nothing after
-- a crash, and a limited write should cost as little as possible.
create unlogged table kc_private.rate_limit_counters (
  key          text primary key check (char_length(key) between 1 and 200),
  window_start timestamptz not null,
  -- End of the window; the row is dead after it and removed by retention.
  expires_at   timestamptz not null,
  hits         integer not null check (hits > 0)
);
comment on table kc_private.rate_limit_counters is 'Fixed-window counters of kc_private.rate_limit; expired rows are purged.';
-- Retention: rows whose window ended.
create index rate_limit_counters_expires_idx on kc_private.rate_limit_counters (expires_at);
alter table kc_private.rate_limit_counters enable row level security;
alter table kc_private.rate_limit_counters force row level security;
revoke all on kc_private.rate_limit_counters from service_role;

-- Counts one hit of p_key and tells whether it is still within p_max per p_window. One
-- statement: the row lock of the upsert makes concurrent hits of one key count one after
-- the other, and different keys never wait for each other.
create function kc_private.rate_limit(p_key text, p_max integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  if p_key is null or p_key = '' or p_max is null or p_max < 1
     or p_window is null or p_window <= interval '0' then
    raise exception 'invalid_rate_limit_args' using errcode = '22023';
  end if;
  insert into kc_private.rate_limit_counters as c (key, window_start, expires_at, hits)
  values (p_key, now(), now() + p_window, 1)
  on conflict (key) do update
    set hits = case when c.expires_at <= now() then 1 else c.hits + 1 end,
        window_start = case when c.expires_at <= now() then now() else c.window_start end,
        expires_at = case when c.expires_at <= now() then now() + p_window else c.expires_at end
  returning c.hits into v_hits;
  return v_hits <= p_max;
end;
$$;
comment on function kc_private.rate_limit(text, integer, interval) is
  'Counts a hit of the key; false once more than p_max hits fall in the current window. Atomic.';

-- Enforces the configured limit of an action for a member; raises rate_limited (P0001, the
-- action in DETAIL) when it is exceeded. Only a member's own request is counted: work done
-- by a scheduled job, the service role or staff on a member's behalf passes, and so does a
-- transaction that declared itself exempt (`kc.rate_limit_exempt`, set by server code
-- that writes many rows for one member action). An action without a configured row passes
-- and leaves a warning, so a missing row is visible but never blocks members.
create function kc_private.rate_limit_enforce(p_action text, p_subject uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit kc_private.rate_limits;
begin
  if p_subject is null or (select auth.uid()) is distinct from p_subject
     or coalesce(current_setting('kc.rate_limit_exempt', true), '') = 'on' then
    return;
  end if;
  select l.* into v_limit from kc_private.rate_limits l where l.action = p_action;
  if not found then
    perform kc_private.ops_warn('rate_limit_unconfigured:' || p_action, 'no kc_private.rate_limits row');
    return;
  end if;
  if not kc_private.rate_limit(p_action || ':' || p_subject, v_limit.max_count, v_limit."window") then
    raise exception 'rate_limited' using errcode = 'P0001', detail = p_action;
  end if;
end;
$$;
comment on function kc_private.rate_limit_enforce(text, uuid) is
  'Applies the configured limit of an action to a member''s own request; raises rate_limited.';

-- The same, as a BEFORE INSERT row trigger for tables members insert into directly.
-- Arguments: the action, and the column holding the writing member.
create function kc_private.rate_limit_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.rate_limit_enforce(tg_argv[0], (to_jsonb(new) ->> tg_argv[1])::uuid);
  return new;
end;
$$;
comment on function kc_private.rate_limit_guard() is
  'BEFORE INSERT trigger: rate limit of action tg_argv[0] for the member in column tg_argv[1].';

-- The limits. Where a number comes from the spec or the deployed rules it is named;
-- adding a limit for a new write path is one row here and one line in that path.
insert into kc_private.rate_limits (action, max_count, "window", description) values
  ('post_create',     20,  interval '1 hour',   'New posts, drafts included (deployed rule R-SEC-Listing-Write). Enforced in kc_private.posts_apply_status_rules.'),
  ('handoff_request', 30,  interval '1 hour',   'Reservations, bookings and registrations (deployed rule R-SEC-Handoff-Write). Enforced in kc_private.handoff_open.'),
  ('follow',          100, interval '1 hour',   'Follows and follow requests (deployed rule R-SEC-Follow-Write). Enforced in public.follow_user.'),
  ('message_send',    10,  interval '1 second', 'Chat messages (NFR-SEC-009). Enforced in public.send_message.'),
  ('comment_create',  20,  interval '1 minute', 'Comments and replies. Enforced in kc_private.post_comments_prepare.'),
  ('post_reaction',   60,  interval '1 minute', 'Reactions to posts. Enforced by trigger post_reactions_rate_limit.'),
  ('post_share',      30,  interval '1 hour',   'Shares of posts. Enforced by trigger post_shares_rate_limit.'),
  ('report_create',   5,   interval '1 hour',   'Reports (NFR-SEC-009). Enforced in kc_private.reports_validate.'),
  ('donation_intent', 20,  interval '1 hour',   'New donation checkouts. Enforced in public.create_donation_intent.');

-- Tables members insert into directly and that have no row trigger of their own to carry
-- the one-line call.
create trigger post_reactions_rate_limit
  before insert on public.post_reactions
  for each row execute function kc_private.rate_limit_guard('post_reaction', 'user_id');
create trigger post_shares_rate_limit
  before insert on public.post_shares
  for each row execute function kc_private.rate_limit_guard('post_share', 'user_id');
