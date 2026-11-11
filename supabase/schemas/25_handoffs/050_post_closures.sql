-- Handoffs · closure bookkeeping of a post
--
-- What a closed post needs beyond its status: whether it counts as a delivery in its
-- owner's profile counter, when a post closed without a recipient is purged, and how often
-- it was reopened. A row appears the first time a post is closed or deleted.

create table public.post_closures (
  post_id       uuid primary key references public.posts (id) on delete cascade,
  -- The closure was a delivery — "close without marking" after handing the item over, or a
  -- recipient who removed their mark — as opposed to the owner deleting the post. Decides
  -- whether a `deleted_no_recipient` post counts in the owner's counter (FR-CLOSURE-009).
  delivered     boolean not null default false,
  -- End of the grace period of a `deleted_no_recipient` post (FR-CLOSURE-003 AC6): until
  -- then the owner may reopen it, afterwards the purge job deletes it (FR-CLOSURE-008).
  purge_after   timestamptz,
  -- Successful reopens; five or more flag the post for review (FR-CLOSURE-010).
  reopen_count  integer not null default 0 check (reopen_count >= 0),
  updated_at    timestamptz not null default now()
);
comment on table public.post_closures is
  'Closure state of a post: delivery flag, purge deadline, reopen count. Written only by server code.';

-- Purge job: posts whose grace period has ended.
create index post_closures_purge_due_idx on public.post_closures (purge_after) where purge_after is not null;

create trigger post_closures_set_updated_at
  before update on public.post_closures
  for each row execute function kc_private.set_updated_at();

alter table public.post_closures enable row level security;
alter table public.post_closures force row level security;

-- The owner sees how long a deleted post can still be restored. The subquery runs under
-- the caller's access to `posts`.
create policy post_closures_select_owner on public.post_closures
  for select to authenticated
  using (exists (select 1 from public.posts p
                  where p.id = post_closures.post_id and p.owner_id = (select auth.uid())));

-- The reopen count is an internal moderation signal (FR-CLOSURE-010 AC3) and is not readable.
grant select (post_id, delivered, purge_after) on public.post_closures to authenticated;

-- Follows every status change of a post, whoever makes it (owner RPC, sweep, moderation):
--   1. owner's counter — a post counts while it is `closed_delivered`, or
--      `deleted_no_recipient` after a delivery; on an offer the owner gave, on a request
--      the owner received (FR-CLOSURE-009 AC1)
--   2. purge deadline — seven days from entering `deleted_no_recipient`, cleared on leaving
--   3. reopen — counted; from the fifth on, a `moderation` event flags the post
--   4. chats — a `chat_system_message` event when an open post closes (FR-CLOSURE-001 AC4)
--   5. handoffs — a post that leaves the air takes its live handoffs with it
create function kc_private.posts_apply_closure_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closure public.post_closures;
  v_delta integer;
  v_reopened constant boolean :=
    old.status in ('closed_delivered', 'deleted_no_recipient') and new.status = 'open';
  v_handoff public.post_handoffs;
begin
  if new.status = old.status then
    return null;
  end if;

  if new.status = 'deleted_no_recipient' or v_reopened then
    insert into public.post_closures as c (post_id, delivered, purge_after, reopen_count)
    values (new.id, old.status = 'closed_delivered',
            case when not v_reopened then now() + interval '7 days' end, v_reopened::integer)
    on conflict (post_id) do update
      set delivered = c.delivered or excluded.delivered,
          purge_after = excluded.purge_after,
          reopen_count = c.reopen_count + excluded.reopen_count
    returning c.* into v_closure;
  else
    update public.post_closures c set purge_after = null
     where c.post_id = new.id returning c.* into v_closure;
  end if;

  -- 1. Owner's counter.
  v_delta := (new.status = 'closed_delivered'
              or (new.status = 'deleted_no_recipient' and coalesce(v_closure.delivered, false)))::integer
           - (old.status = 'closed_delivered'
              or (old.status = 'deleted_no_recipient' and coalesce(v_closure.delivered, false)))::integer;
  if v_delta <> 0 then
    update public.user_stats s
       set items_given_count = greatest(
             s.items_given_count + case new.direction when 'offer' then v_delta else 0 end, 0),
           items_received_count = greatest(
             s.items_received_count + case new.direction when 'request' then v_delta else 0 end, 0)
     where s.user_id = new.owner_id;
  end if;

  -- 3. A reopened post starts over as not delivered.
  if v_reopened then
    update public.post_closures c set delivered = false where c.post_id = new.id;
    if v_closure.reopen_count >= 5 then
      perform kc_private.outbox_enqueue('moderation', jsonb_build_object(
        'kind', 'excessive_reopens', 'post_id', new.id, 'owner_id', new.owner_id,
        'reopen_count', v_closure.reopen_count));
    end if;
  end if;

  -- 4. Chats anchored to the post get a closing line and lose their anchor.
  if old.status = 'open' and new.status in ('closed_delivered', 'deleted_no_recipient') then
    perform kc_private.outbox_enqueue('chat_system_message', jsonb_build_object(
      'kind', 'post_closed', 'post_id', new.id, 'status', new.status, 'owner_id', new.owner_id,
      'recipient_id', (select h.recipient_id from public.post_handoffs h
                        where h.post_id = new.id and h.status = 'handed_over'
                        order by h.handed_over_at desc limit 1)));
  end if;

  -- 5. Live handoffs end with the post. An event that already started keeps its
  --    registrations, so that attendance can still be marked (D128, D131). A pause only
  --    reaches event registrations: any other live handoff refuses the pause (D104).
  if new.status in ('paused', 'closed_delivered', 'deleted_no_recipient', 'expired', 'removed_admin') then
    for v_handoff in
      select h.* from public.post_handoffs h
       where h.post_id = new.id and h.status in ('waitlisted', 'reserved', 'confirmed')
         and (h.machine_id <> 'event_registration' or lower(new.time_window) > now()
              or new.time_window is null)
         and (new.status <> 'paused' or h.machine_id = 'event_registration')
    loop
      perform kc_private.handoff_move(
        v_handoff.id, 'cancelled', 'system',
        case when new.status = 'closed_delivered' then 'superseded'
             when coalesce(current_setting('kc.fsm_role', true), '') = 'owner' then 'host_cancelled'
             else 'system' end);
    end loop;
  end if;
  return null;
end;
$$;
comment on function kc_private.posts_apply_closure_effects() is
  'AFTER UPDATE OF status on posts: owner counter, purge deadline, reopen count, chat event, cancellation of live handoffs.';

create trigger posts_apply_closure_effects
  after update of status on public.posts
  for each row execute function kc_private.posts_apply_closure_effects();

-- Posts closed without a recipient whose grace period has ended, oldest first, for the
-- purge job (it removes the media files, then the post).
create function kc_private.posts_due_for_purge(p_limit integer default 100)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.post_id
    from public.post_closures c
    join public.posts p on p.id = c.post_id
   where c.purge_after <= now() and p.status = 'deleted_no_recipient'
   order by c.purge_after
   limit least(greatest(p_limit, 1), 1000);
$$;
comment on function kc_private.posts_due_for_purge(integer) is
  'Ids of deleted_no_recipient posts past their seven-day grace period.';
