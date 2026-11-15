-- 0162_rate_limits_messages_reports | NFR-SEC-009 (TD-162)
--
-- Server-side rate limits: 10 user messages / second / sender, 5 reports / hour / reporter.

-- ---------------------------------------------------------------------------
-- Bucket store (internal; no client access)
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limit_buckets (
  key           text primary key,
  window_start  timestamptz not null,
  count         int not null default 0 check (count >= 0)
);

comment on table public.rate_limit_buckets is
  'Sliding-window counters for enforce_rate_limit(). Not client-readable. NFR-SEC-009, TD-162.';

alter table public.rate_limit_buckets enable row level security;

-- rls-lint.sql requires ≥1 policy on every RLS-enabled public table.
drop policy if exists rate_limit_buckets_deny_all on public.rate_limit_buckets;
create policy rate_limit_buckets_deny_all
  on public.rate_limit_buckets
  for all to anon, authenticated
  using (false) with check (false);

revoke all on table public.rate_limit_buckets from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- enforce_rate_limit(key, max, window_seconds)
-- ---------------------------------------------------------------------------

create or replace function public.enforce_rate_limit(
  p_key text,
  p_max int,
  p_window_seconds int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window interval;
  v_bucket public.rate_limit_buckets%rowtype;
begin
  if p_key is null or length(trim(p_key)) = 0
     or p_max is null or p_max < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'invalid_rate_limit_args' using errcode = '22023';
  end if;

  v_window := make_interval(secs => p_window_seconds);

  loop
    select * into v_bucket
      from public.rate_limit_buckets
     where key = p_key
     for update;

    if not found then
      begin
        insert into public.rate_limit_buckets (key, window_start, count)
        values (p_key, v_now, 1);
        return;
      exception
        when unique_violation then
          -- concurrent first insert; retry
      end;
    end if;

    if v_bucket.window_start + v_window <= v_now then
      update public.rate_limit_buckets
         set window_start = v_now,
             count = 1
       where key = p_key;
      return;
    end if;

    if v_bucket.count >= p_max then
      raise exception 'rate_limit_exceeded' using errcode = '22023';
    end if;

    update public.rate_limit_buckets
       set count = count + 1
     where key = p_key;
    return;
  end loop;
end;
$$;

revoke all on function public.enforce_rate_limit(text, int, int) from public, anon, authenticated;

comment on function public.enforce_rate_limit(text, int, int) is
  'Increments a fixed-window counter; raises rate_limit_exceeded (22023) when cap reached. NFR-SEC-009, TD-162.';

-- ---------------------------------------------------------------------------
-- messages: 10 user messages / second / sender
-- ---------------------------------------------------------------------------

create or replace function public.trg_messages_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'user' and new.sender_id is not null then
    perform public.enforce_rate_limit(
      'messages:' || new.sender_id::text,
      10,
      1
    );
  end if;
  return new;
end;
$$;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
  before insert on public.messages
  for each row
  execute function public.trg_messages_rate_limit();

comment on function public.trg_messages_rate_limit() is
  'BEFORE INSERT: NFR-SEC-009 cap of 10 user messages per second per sender. TD-162.';

-- ---------------------------------------------------------------------------
-- reports: 5 reports / hour / reporter
-- ---------------------------------------------------------------------------

create or replace function public.trg_reports_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reporter_id is not null then
    perform public.enforce_rate_limit(
      'reports:' || new.reporter_id::text,
      5,
      3600
    );
  end if;
  return new;
end;
$$;

drop trigger if exists reports_rate_limit on public.reports;
create trigger reports_rate_limit
  before insert on public.reports
  for each row
  execute function public.trg_reports_rate_limit();

comment on function public.trg_reports_rate_limit() is
  'BEFORE INSERT: NFR-SEC-009 cap of 5 reports per hour per reporter. TD-162.';
