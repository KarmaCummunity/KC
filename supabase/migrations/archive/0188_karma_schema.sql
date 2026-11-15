-- 0188_karma_schema | FR-KARMA-001/002 — karma_points column, append-only ledger, award helpers
--
-- Mechanism: awards are anchored to exactly ONE trigger per event (0189) and the
-- ledger is append-and-sum, so reversible events (follow→unfollow, reopen, un-mark)
-- net to zero across two rows without a global unique key that would wrongly block
-- a legitimate re-follow. A PARTIAL unique index guards only the never-reversed
-- "once" events (registration, post_created, outreach, backfill). karma_points is
-- the denorm of sum(ledger), floored at 0.

-- ── 1. Denorm column on users ───────────────────────────────────────────────
-- Not in the users UPDATE column-grant, so clients cannot write it; the SECURITY
-- DEFINER helpers below are the only writers.
alter table public.users
  add column if not exists karma_points integer not null default 0
    check (karma_points >= 0);

-- Realtime (FR-KARMA-009): a filtered postgres_changes UPDATE subscription + RLS
-- re-check on broadcast need the FULL row image, not just the PK. An UPDATE that
-- touches only karma_points is the fragile case without this.
alter table public.users replica identity full;

-- ── 2. Append-only ledger ────────────────────────────────────────────────────
create table if not exists public.karma_ledger (
  ledger_id    bigserial primary key,
  user_id      uuid not null references public.users (user_id) on delete cascade,
  event_type   text not null,
  points_delta integer not null,
  ref_type     text not null,
  ref_id       text not null,
  created_at   timestamptz not null default now()
);

create index if not exists karma_ledger_user_idx on public.karma_ledger (user_id);
-- Covering index for the nightly recompute's per-user GROUP BY sum.
create index if not exists karma_ledger_user_delta_idx on public.karma_ledger (user_id, points_delta);

-- Idempotency guard for never-reversed events only.
create unique index if not exists karma_ledger_once_idx
  on public.karma_ledger (user_id, event_type, ref_id)
  where event_type in ('registration', 'post_created', 'outreach', 'backfill');

alter table public.karma_ledger enable row level security;

-- Public-ready: a user may read their own ledger (FE doesn't use it yet, but this
-- keeps a future karma-breakdown a display change only). No client writes.
create policy karma_ledger_select_self on public.karma_ledger
  for select to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.karma_ledger from authenticated, anon;
grant select on public.karma_ledger to authenticated;

-- ── 3. Value bonus (mirror of domain computeValueBonus / 0189 closure) ──────
create or replace function public.karma_value_bonus(p_value integer)
returns integer
language sql
immutable
as $$
  select case
    when p_value is null or p_value <= 0 then 0
    else round(least(p_value, 1000)::numeric / 50)::integer
  end;
$$;

-- ── 4. Award helpers (SECURITY DEFINER — only writers of karma_points) ──────
-- karma_grant_once: idempotent insert for never-reversed events. ON CONFLICT
-- against the partial index is race-safe (a concurrent duplicate is a no-op, not
-- a unique_violation that would abort the host transaction). Only bumps the denorm
-- when a ledger row was actually inserted.
create or replace function public.karma_grant_once(
  p_user uuid, p_event text, p_ref_type text, p_ref_id text, p_delta integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_inserted integer;
begin
  if p_user is null then return; end if;
  insert into public.karma_ledger (user_id, event_type, points_delta, ref_type, ref_id)
  values (p_user, p_event, p_delta, p_ref_type, p_ref_id)
  on conflict (user_id, event_type, ref_id)
    where event_type in ('registration', 'post_created', 'outreach', 'backfill')
    do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    update public.users set karma_points = greatest(0, karma_points + p_delta)
     where user_id = p_user;
  end if;
end;
$$;

-- karma_apply: append + adjust for reversible events (no dedupe; reversal is a
-- second row with a negative delta and a *_reverse event_type).
create or replace function public.karma_apply(
  p_user uuid, p_event text, p_ref_type text, p_ref_id text, p_delta integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then return; end if;
  insert into public.karma_ledger (user_id, event_type, points_delta, ref_type, ref_id)
  values (p_user, p_event, p_delta, p_ref_type, p_ref_id);
  update public.users set karma_points = greatest(0, karma_points + p_delta)
   where user_id = p_user;
end;
$$;

revoke all on function public.karma_grant_once(uuid, text, text, text, integer) from public;
revoke all on function public.karma_apply(uuid, text, text, text, integer) from public;

-- end of 0188_karma_schema
