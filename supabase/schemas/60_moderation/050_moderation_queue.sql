-- Moderation · the review queue (FR-MOD-008; design §8: replaces operator_cases and
-- moderation_queue_entries)
--
-- Work items for staff that are not a single report: a target the report threshold acted
-- on, a post reopened suspiciously often, a keyword hit, a manual flag, a post that needs
-- an operator. An entry is open until a staff member resolves it; it may be assigned on
-- the way. One open entry per target and reason.

insert into kc_private.fsm_state (machine_id, status) values
  ('moderation_queue', 'open'),
  ('moderation_queue', 'resolved');
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('moderation_queue', 'open', 'resolved', 'admin');

create table public.moderation_queue (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post', 'user', 'comment', 'chat')),
  target_id   uuid not null,
  reason      text not null check (reason in (
                'report_threshold', 'excessive_reopens', 'forbidden_keyword', 'manual_flag', 'operator_case')),
  -- Lifecycle, machine `moderation_queue`.
  status      text not null default 'open',
  -- Staff member working on the entry, if any.
  assignee_id uuid references public.users (id) on delete set null,
  -- Ids and counters that explain the entry (for example the reopen count).
  metadata    jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  resolved_at timestamptz,
  resolved_by uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint moderation_queue_resolution_chk check ((status = 'open') = (resolved_at is null))
);
comment on table public.moderation_queue is 'Review work items for staff. Written only by server code.';

-- One open entry per target and reason; also "is this target queued".
create unique index moderation_queue_open_key on public.moderation_queue (target_type, target_id, reason)
  where status = 'open';
-- Staff queue: open entries, oldest first.
create index moderation_queue_open_idx on public.moderation_queue (created_at, id) where status = 'open';
-- "Assigned to me", and the assignee foreign key.
create index moderation_queue_assignee_idx on public.moderation_queue (assignee_id, created_at)
  where assignee_id is not null;
-- Foreign key to the staff member who resolved.
create index moderation_queue_resolved_by_idx on public.moderation_queue (resolved_by)
  where resolved_by is not null;

create trigger moderation_queue_status_fsm
  before insert or update of status on public.moderation_queue
  for each row execute function kc_private.fsm_guard_status('moderation_queue', 'status');

alter table public.moderation_queue enable row level security;
alter table public.moderation_queue force row level security;

create policy moderation_queue_select_staff on public.moderation_queue
  for select to authenticated
  using ((select kc_access.is_admin()));
grant select on public.moderation_queue to authenticated;

-- Opens an entry unless the same target is already queued for the same reason. Called by
-- the report threshold, by the outbox consumer below and by any later module.
create function kc_private.moderation_enqueue(
  p_target_type text, p_target_id uuid, p_reason text, p_metadata jsonb default '{}'::jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.moderation_queue (target_type, target_id, reason, metadata)
  values (p_target_type, p_target_id, p_reason, coalesce(p_metadata, '{}'::jsonb))
  on conflict (target_type, target_id, reason) where status = 'open' do nothing;
  return found;
end;
$$;
comment on function kc_private.moderation_enqueue(text, uuid, text, jsonb) is
  'Queues a target for staff review; returns false while the same entry is already open.';

-- Resolves the open entries of a target (all reasons, or one) in the name of a staff
-- member, or of the system when p_resolved_by is null.
create function kc_private.moderation_queue_close(
  p_target_type text, p_target_id uuid, p_resolved_by uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outer_role constant text := coalesce(current_setting('kc.fsm_role', true), '');
begin
  perform set_config('kc.fsm_role', 'admin', true);
  update public.moderation_queue q
     set status = 'resolved', resolved_at = now(), resolved_by = p_resolved_by
   where q.target_type = p_target_type and q.target_id = p_target_id and q.status = 'open'
     and (p_reason is null or q.reason = p_reason);
  perform set_config('kc.fsm_role', v_outer_role, true);
end;
$$;

-- Consumer of outbox topic `moderation`. Payload: { "kind": "excessive_reopens",
-- "post_id": uuid, "owner_id": uuid, "reopen_count": int } → a queue entry for the post
-- (FR-MOD-008 AC1). An unknown kind is released with an error and retried in an hour.
create function kc_private.moderation_consume_outbox(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event kc_private.outbox_events;
  v_queued integer := 0;
begin
  for v_event in select * from kc_private.outbox_claim('moderation', p_limit) loop
    if v_event.payload ->> 'kind' = 'excessive_reopens' and v_event.payload ? 'post_id' then
      perform kc_private.moderation_enqueue(
        'post', (v_event.payload ->> 'post_id')::uuid, 'excessive_reopens',
        jsonb_build_object('reopen_count', v_event.payload -> 'reopen_count'));
      perform kc_private.outbox_complete(v_event.id);
      v_queued := v_queued + 1;
    else
      perform kc_private.outbox_complete(v_event.id, 'unknown moderation kind', interval '1 hour');
    end if;
  end loop;
  return v_queued;
end;
$$;
comment on function kc_private.moderation_consume_outbox(integer) is
  'Scheduled job: turns queued `moderation` outbox events into review queue entries.';

-- A staff member takes an open entry, or hands it to another staff member.
create function public.admin_assign_queue_entry(p_entry_id uuid, p_assignee_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
  v_assignee constant uuid := coalesce(p_assignee_id, v_actor);
begin
  if not exists (select 1 from public.admin_role_grants g
                  where g.user_id = v_assignee and g.revoked_at is null and g.is_platform) then
    raise exception 'assignee_not_staff' using errcode = 'P0001';
  end if;
  update public.moderation_queue q set assignee_id = v_assignee
   where q.id = p_entry_id and q.status = 'open';
  if not found then
    raise exception 'queue_entry_not_open' using errcode = 'P0001';
  end if;
  perform kc_private.audit_record('assign_queue_entry', 'moderation_queue', p_entry_id,
                                  jsonb_build_object('assignee_id', v_assignee));
end;
$$;
comment on function public.admin_assign_queue_entry(uuid, uuid) is
  'Assigns an open review entry to the caller or to another staff member.';
grant execute on function public.admin_assign_queue_entry(uuid, uuid) to authenticated;

-- A staff member closes an open entry. What was done about the target (remove, restore,
-- nothing) is its own action with its own audit row.
create function public.admin_resolve_queue_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
begin
  perform set_config('kc.fsm_role', 'admin', true);
  update public.moderation_queue q
     set status = 'resolved', resolved_at = now(), resolved_by = v_actor
   where q.id = p_entry_id and q.status = 'open';
  if not found then
    raise exception 'queue_entry_not_open' using errcode = 'P0001';
  end if;
  perform set_config('kc.fsm_role', '', true);
  perform kc_private.audit_record('resolve_queue_entry', 'moderation_queue', p_entry_id);
end;
$$;
comment on function public.admin_resolve_queue_entry(uuid) is 'Marks an open review entry resolved.';
grant execute on function public.admin_resolve_queue_entry(uuid) to authenticated;
