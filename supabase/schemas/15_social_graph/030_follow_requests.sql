-- Social graph · follow_requests (FR-FOLLOW-003 … FR-FOLLOW-008)
--
-- Following a private profile needs its owner's approval. A request is pending until the
-- target accepts or rejects it or the requester cancels it; resolved rows are kept as
-- history. A rejection is silent and starts a 14-day cooldown for the same pair.

insert into kc_private.fsm_state (machine_id, status) values
  ('follow_request', 'pending'),
  ('follow_request', 'accepted'),
  ('follow_request', 'rejected'),
  ('follow_request', 'cancelled');

-- Who may make each move is part of the edge: the RPC states its role before it writes.
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('follow_request', 'pending', 'accepted', 'target'),
  ('follow_request', 'pending', 'rejected', 'target'),
  ('follow_request', 'pending', 'cancelled', 'requester'),
  -- A block between the two members withdraws the request (FR-MOD-003 AC4).
  ('follow_request', 'pending', 'cancelled', 'system');

create table public.follow_requests (
  id             uuid primary key default gen_random_uuid(),
  requester_id   uuid not null references public.users (id) on delete cascade,
  target_id      uuid not null references public.users (id) on delete cascade,
  status         text not null default 'pending',
  -- Set on rejection: the requester may ask again from this time (FR-FOLLOW-006 AC1).
  cooldown_until timestamptz,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  constraint follow_requests_not_self_chk check (requester_id <> target_id),
  constraint follow_requests_cooldown_chk check ((cooldown_until is not null) = (status = 'rejected')),
  constraint follow_requests_resolved_chk check ((resolved_at is null) = (status = 'pending'))
);
comment on table public.follow_requests is
  'Requests to follow a private profile. Visible to the two members; moved only by RPCs.';

-- At most one live request per ordered pair.
create unique index follow_requests_one_pending_idx
  on public.follow_requests (requester_id, target_id) where status = 'pending';
-- Follow button state and the cooldown check: the newest request of a pair. Also the
-- foreign key on requester_id.
create index follow_requests_pair_recent_idx
  on public.follow_requests (requester_id, target_id, created_at desc);
-- Follow Requests screen: pending requests of a target, newest first, keyset on
-- (created_at, id) (FR-FOLLOW-007 AC1). Also the foreign key on target_id.
create index follow_requests_target_status_idx
  on public.follow_requests (target_id, status, created_at desc, id desc);

create trigger follow_requests_status_fsm
  before insert or update of status on public.follow_requests
  for each row execute function kc_private.fsm_guard_status('follow_request', 'status');

-- Stamps the resolution time, and the cooldown when the request was rejected.
create function kc_private.follow_requests_stamp_resolution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.resolved_at := now();
  new.cooldown_until := case when new.status = 'rejected' then now() + interval '14 days' end;
  return new;
end;
$$;

create trigger follow_requests_stamp_resolution
  before update of status on public.follow_requests
  for each row
  when (old.status = 'pending' and new.status <> 'pending')
  execute function kc_private.follow_requests_stamp_resolution();

-- An accepted request becomes a follow edge in the same transaction (FR-FOLLOW-005 AC1).
create function kc_private.follow_requests_create_edge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.follows (follower_id, followed_id)
  values (new.requester_id, new.target_id)
  on conflict do nothing;
  return null;
end;
$$;

create trigger follow_requests_create_edge
  after update of status on public.follow_requests
  for each row
  when (old.status = 'pending' and new.status = 'accepted')
  execute function kc_private.follow_requests_create_edge();

-- Blocking withdraws pending requests between the two members, in both directions, so a
-- request can never be approved across a block.
create function kc_private.blocks_cancel_follow_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- A block may be inserted by code that acts under a role of its own: put it back after.
  v_outer_role constant text := coalesce(current_setting('kc.fsm_role', true), '');
begin
  perform set_config('kc.fsm_role', 'system', true);
  update public.follow_requests r
     set status = 'cancelled'
   where r.status = 'pending'
     and ((r.requester_id = new.blocker_id and r.target_id = new.blocked_id)
       or (r.requester_id = new.blocked_id and r.target_id = new.blocker_id));
  perform set_config('kc.fsm_role', v_outer_role, true);
  return null;
end;
$$;

create trigger blocks_cancel_follow_requests
  after insert on public.blocks
  for each row execute function kc_private.blocks_cancel_follow_requests();

alter table public.follow_requests enable row level security;
alter table public.follow_requests force row level security;

-- The requester sees their own requests (button state, cooldown end); the target sees the
-- requests addressed to them. Nobody else sees a request.
create policy follow_requests_select_party on public.follow_requests
  for select to authenticated
  using ((select auth.uid()) in (requester_id, target_id));

grant select on public.follow_requests to authenticated;
