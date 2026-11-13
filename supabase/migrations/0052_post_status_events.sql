-- Posts · the status history of a post (issue #2082, product decision D142; spec 07 §7.1)
--
-- A post has no `cancelled` state: an event its owner calls off, a date of a series that is
-- cancelled and a post the owner simply deletes all end as `deleted_no_recipient`. What tells
-- them apart is why the status changed. That was written nowhere: the audit trail keeps
-- moderation moves only, on purpose, and a post row holds its current status alone.
--
-- `post_status_events` keeps one row per status change of a post, whoever made it (an owner
-- RPC, a sweep, the review queue, staff): the two statuses, the role that moved it, the member
-- who acted when there is one, and a reason code when the writer gives one. The history
-- belongs to the post and is deleted with it, so it outlives a post no longer than the post's
-- own purge. The owner reads the history of their own posts.

create table public.post_status_events (
  id          bigint generated always as identity primary key,
  post_id     uuid not null references public.posts (id) on delete cascade,
  from_status text not null,
  to_status   text not null,
  -- The role of the kernel that made the move: owner, system, admin.
  role        text,
  -- The member who acted; null for a sweep, a trigger of an automatic rule and the service role.
  actor_id    uuid references public.users (id) on delete set null,
  -- Why, when the status alone does not say (a code, never free text), e.g. `series_cancelled`.
  reason      text check (reason ~ '^[a-z][a-z0-9_]{2,40}$'),
  occurred_at timestamptz not null default now(),
  constraint post_status_events_is_a_change check (from_status <> to_status)
);
comment on table public.post_status_events is
  'One row per status change of a post: from, to, the kernel role, the acting member and a reason code. Written by a trigger only; deleted with its post.';

-- The history of one post in order; covers the post foreign key.
create index post_status_events_post_idx on public.post_status_events (post_id, occurred_at, id);
-- A member being deleted: their rows lose the actor.
create index post_status_events_actor_idx on public.post_status_events (actor_id) where actor_id is not null;

alter table public.post_status_events enable row level security;
alter table public.post_status_events force row level security;

-- The owner reads the history of their own posts. The subquery runs under the caller's
-- access to `posts`. Nobody writes through the API: the trigger below is the only writer.
create policy post_status_events_select_owner on public.post_status_events
  for select to authenticated
  using (exists (select 1 from public.posts p
                  where p.id = post_status_events.post_id and p.owner_id = (select auth.uid())));
grant select on public.post_status_events to authenticated;

-- Records a status change of a post. The role and the reason are the ones the writer set for
-- this move (kc_private.post_move); a move in the role `system` has no acting member.
create function kc_private.posts_record_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role constant text := nullif(current_setting('kc.fsm_role', true), '');
begin
  insert into public.post_status_events (post_id, from_status, to_status, role, actor_id, reason)
  values (new.id, old.status, new.status, v_role,
          case when v_role = 'system' then null else (select auth.uid()) end,
          nullif(current_setting('kc.fsm_reason', true), ''));
  return null;
end;
$$;
comment on function kc_private.posts_record_status_event() is
  'AFTER UPDATE OF status on posts: one post_status_events row per real status change.';

create trigger posts_record_status_event
  after update of status on public.posts
  for each row when (old.status is distinct from new.status)
  execute function kc_private.posts_record_status_event();

-- post_move takes an optional reason for the history. A function cannot gain a parameter by
-- `create or replace`, so the three-argument form is dropped and created again with four;
-- every existing call passes three and keeps working.
drop function kc_private.post_move(uuid, text, text);
create function kc_private.post_move(p_post_id uuid, p_to text, p_role text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outer_role constant text := coalesce(current_setting('kc.fsm_role', true), '');
  v_outer_reason constant text := coalesce(current_setting('kc.fsm_reason', true), '');
begin
  perform set_config('kc.fsm_role', p_role, true);
  perform set_config('kc.fsm_reason', coalesce(p_reason, ''), true);
  update public.posts p set status = p_to where p.id = p_post_id;
  -- The role and the reason belong to this move only; a caller's own are put back.
  perform set_config('kc.fsm_role', v_outer_role, true);
  perform set_config('kc.fsm_reason', v_outer_reason, true);
end;
$$;
comment on function kc_private.post_move(uuid, text, text, text) is
  'Moves a post to a status in a kernel role, with an optional reason code for its status history.';

-- A date its series cancels (the series ended, one date was cancelled, a recurring ride was
-- cancelled) is deleted like any post; the history says it was the series.
create or replace function kc_private.post_cancel_by_owner(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff_id uuid;
begin
  for v_handoff_id in
    select h.id from public.post_handoffs h
     where h.post_id = p_post_id and h.status in ('waitlisted', 'reserved', 'confirmed')
  loop
    perform kc_private.handoff_move(v_handoff_id, 'cancelled', 'owner', 'post_deleted');
  end loop;
  perform kc_private.post_move(p_post_id, 'deleted_no_recipient', 'owner', 'series_cancelled');
end;
$$;
