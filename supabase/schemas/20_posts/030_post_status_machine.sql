-- Posts · lifecycle (machine `post`: spec state machine S1 plus `draft`)
--
--   draft ─► open ◄─► paused
--             ├─► closed_delivered ─► open            (reopen, owner only)
--             ├─► deleted_no_recipient ─► open        (reopen, owner only)
--             └─► expired                             (never reopened: republish is a new post, D127)
--   live ─► hidden_pending_review ─► open | removed_admin
--   any published ─► removed_admin ─► the status held before the removal (D129)
--
-- Each edge names who may take it. The RPC performing a move states its role in the
-- transaction-local setting `kc.fsm_role`; a write without a role (or with the wrong one)
-- is refused, and a device has no UPDATE privilege on the column at all.
--   owner   the member who owns the post (D104)
--   admin   a moderator acting on the post
--   system  sweeps and automatic moderation (expiry D21 / D128, review hide D33, handoff completion)

insert into kc_private.fsm_state (machine_id, status) values
  ('post', 'draft'),
  ('post', 'open'),
  ('post', 'paused'),
  ('post', 'closed_delivered'),
  ('post', 'deleted_no_recipient'),
  ('post', 'expired'),
  ('post', 'hidden_pending_review'),
  ('post', 'removed_admin');

insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  -- Owner management (D104).
  ('post', 'draft', 'open', 'owner'),
  ('post', 'open', 'paused', 'owner'),
  ('post', 'paused', 'open', 'owner'),
  ('post', 'open', 'closed_delivered', 'owner'),
  ('post', 'open', 'deleted_no_recipient', 'owner'),
  ('post', 'paused', 'deleted_no_recipient', 'owner'),
  ('post', 'expired', 'deleted_no_recipient', 'owner'),
  ('post', 'hidden_pending_review', 'deleted_no_recipient', 'owner'),
  ('post', 'closed_delivered', 'open', 'owner'),
  ('post', 'deleted_no_recipient', 'open', 'owner'),
  -- A handoff completed by the other side closes the post; a recipient who removes their
  -- mark turns a delivered post into one closed without a recipient (FR-CLOSURE-007).
  ('post', 'open', 'closed_delivered', 'system'),
  ('post', 'hidden_pending_review', 'closed_delivered', 'system'),
  ('post', 'closed_delivered', 'deleted_no_recipient', 'system'),
  -- Expiry sweeps.
  ('post', 'open', 'expired', 'system'),
  ('post', 'paused', 'expired', 'system'),
  -- Automatic hide while reports are reviewed, and its automatic lift.
  ('post', 'open', 'hidden_pending_review', 'system'),
  ('post', 'paused', 'hidden_pending_review', 'system'),
  ('post', 'closed_delivered', 'hidden_pending_review', 'system'),
  ('post', 'expired', 'hidden_pending_review', 'system'),
  ('post', 'hidden_pending_review', 'open', 'system'),
  -- Moderation: a review outcome, a removal from any published status, and its restore.
  ('post', 'hidden_pending_review', 'open', 'admin'),
  ('post', 'open', 'removed_admin', 'admin'),
  ('post', 'paused', 'removed_admin', 'admin'),
  ('post', 'closed_delivered', 'removed_admin', 'admin'),
  ('post', 'deleted_no_recipient', 'removed_admin', 'admin'),
  ('post', 'expired', 'removed_admin', 'admin'),
  ('post', 'hidden_pending_review', 'removed_admin', 'admin'),
  ('post', 'removed_admin', 'open', 'admin'),
  ('post', 'removed_admin', 'paused', 'admin'),
  ('post', 'removed_admin', 'closed_delivered', 'admin'),
  ('post', 'removed_admin', 'deleted_no_recipient', 'admin'),
  ('post', 'removed_admin', 'expired', 'admin');

create trigger posts_status_fsm
  before insert or update of status on public.posts
  for each row execute function kc_private.fsm_guard_status('post', 'status');

-- Rules of a status write that the graph alone cannot express. Fires after posts_status_fsm
-- (triggers run in name order), so the move itself is already known to be legal.
--   insert   the kind must be active and admit the post's direction
--   publish  stamps the first time the post leaves draft
--   → open   an owner may hold at most 20 open posts (FR-POST-011); a paused post is not
--            resumed after its own expiry (D104)
--   removal  remembers the status the post is removed from, and a restore may only return
--            to it (D129); a post hidden for review counts as open
-- Definer rights: it reads the catalog and locks the owner's counter row, which a member
-- may not write.
create function kc_private.posts_apply_status_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from constant text := case tg_op when 'UPDATE' then old.status end;
  v_open_limit constant integer := 20;
begin
  if tg_op = 'INSERT' and not exists (
       select 1 from public.post_kinds k
        where k.id = new.kind_id and k.is_active and k.direction in (new.direction, 'either')) then
    raise exception 'post_kind_not_allowed' using errcode = 'P0001',
      detail = 'the post kind is inactive or does not admit this direction';
  end if;

  if v_from is not distinct from new.status then
    return new;
  end if;

  -- Leaving draft (or being created past it, as an imported post is) is the publish moment.
  if new.status <> 'draft' then
    new.published_at := coalesce(new.published_at, now());
  end if;

  if new.status = 'open' then
    if v_from = 'paused' and new.expires_at <= now() then
      raise exception 'post_expired' using errcode = 'P0001', detail = 'a post is not resumed after its expiry';
    end if;
    -- Moderation and sweeps return a post to open regardless of the owner's quota.
    if coalesce(current_setting('kc.fsm_role', true), '') not in ('admin', 'system') then
      -- The counter row is the per-owner lock: two concurrent publishes cannot both pass.
      perform 1 from public.user_stats s where s.user_id = new.owner_id for update;
      if (select count(*) from public.posts p where p.owner_id = new.owner_id and p.status = 'open')
         >= v_open_limit then
        raise exception 'post_limit_exceeded' using errcode = 'P0001',
          detail = format('at most %s open posts per member', v_open_limit);
      end if;
    end if;
  end if;

  if new.status = 'removed_admin' then
    new.status_before_removal := case v_from when 'hidden_pending_review' then 'open' else v_from end;
  elsif v_from = 'removed_admin' then
    if new.status is distinct from old.status_before_removal then
      raise exception 'illegal_transition' using errcode = 'P0001',
        detail = format('post: a removed post is restored to %s', old.status_before_removal);
    end if;
    new.status_before_removal := null;
  end if;

  return new;
end;
$$;
comment on function kc_private.posts_apply_status_rules() is
  'BEFORE INSERT OR UPDATE OF status on posts: kind check, publish time, open-post quota, removal memory.';

create trigger posts_status_rules
  before insert or update of status on public.posts
  for each row execute function kc_private.posts_apply_status_rules();
