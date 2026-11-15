-- 0189_karma_triggers | FR-KARMA-002/003/005/006 — single-anchor award triggers
--
-- Each scored event has exactly ONE trigger (no double counting). Reversible
-- events append a negative *_reverse row. The numeric schedule here is the
-- authoritative source; the domain TS constants (packages/domain/src/karma.ts)
-- mirror only the value-bonus divisor for the slider preview.

-- ── 1. registration (+1) — users AFTER INSERT ───────────────────────────────
create or replace function public.karma_on_user_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.karma_grant_once(new.user_id, 'registration', 'user', new.user_id::text, 1);
  return null;
end;
$$;
drop trigger if exists karma_users_after_insert on public.users;
create trigger karma_users_after_insert
  after insert on public.users
  for each row execute function public.karma_on_user_insert();

-- ── 2. post_created (+5) / removed (-5) / closure (both roles) — posts ───────
-- Anchored to the AUTHORITATIVE delivery signal: the posts.status transition,
-- NOT recipients-row existence (a recipient row can precede the status flip — see
-- close_post_with_recipient — or be deleted in a different order on un-mark, see
-- rpc_recipient_unmark_self). Mirrors how items_given is anchored, and yields the
-- product-required end-states: closure karma exists iff the post is currently
-- closed_delivered with a marked recipient. Reversal zeroes the post's closure
-- ledger balance per user (robust to recipient-row deletion order). Give:
-- owner=giver, recipient=receiver, bonus to giver. Request: recipient=giver,
-- owner=receiver, no bonus.
create or replace function public.karma_on_post_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rid   text;
  v_rec   uuid;
  v_giver uuid;
  v_recv  uuid;
  v_bonus integer;
begin
  if tg_op = 'INSERT' then
    perform public.karma_grant_once(new.owner_id, 'post_created', 'post', new.post_id::text, 5);
    return null;
  end if;

  v_rid := new.post_id::text;

  -- admin removal reverses the creation award
  if new.status = 'removed_admin' and old.status is distinct from 'removed_admin' then
    perform public.karma_apply(new.owner_id, 'post_removed', 'post', v_rid, -5);
  end if;

  -- entering closed_delivered → award both economic roles
  if new.status = 'closed_delivered' and old.status is distinct from 'closed_delivered' then
    select r.recipient_user_id into v_rec
      from public.recipients r where r.post_id = new.post_id
      order by r.marked_at desc limit 1;
    if v_rec is not null then
      if new.type = 'Give' then
        v_giver := new.owner_id; v_recv := v_rec; v_bonus := public.karma_value_bonus(new.estimated_value);
      else
        v_giver := v_rec; v_recv := new.owner_id; v_bonus := 0;
      end if;
      perform public.karma_apply(v_giver, 'closure_giver', 'post', v_rid, 20 + v_bonus);
      perform public.karma_apply(v_recv,  'closure_receiver', 'post', v_rid, 15);
    end if;
  end if;

  -- leaving closed_delivered (reopen / un-mark) → zero the post's closure balance.
  -- `bal` snapshots each user's pre-reversal closure balance (CTE sees the table as
  -- of statement start); `ins` posts the negation; the UPDATE applies it.
  if old.status = 'closed_delivered' and new.status is distinct from 'closed_delivered' then
    with bal as (
      select l.user_id, sum(l.points_delta) as b
        from public.karma_ledger l
       where l.ref_id = v_rid and l.event_type like 'closure%'
       group by l.user_id
      having sum(l.points_delta) <> 0
    ),
    ins as (
      insert into public.karma_ledger (user_id, event_type, points_delta, ref_type, ref_id)
      select user_id, 'closure_reverse', -b, 'post', v_rid from bal
      returning user_id, points_delta
    )
    update public.users u
       set karma_points = greatest(0, u.karma_points + i.points_delta)
      from ins i
     where u.user_id = i.user_id;
  end if;

  return null;
end;
$$;
drop trigger if exists karma_posts_after_insert on public.posts;
create trigger karma_posts_after_insert
  after insert on public.posts
  for each row execute function public.karma_on_post_change();
drop trigger if exists karma_posts_after_status_update on public.posts;
create trigger karma_posts_after_status_update
  after update of status on public.posts
  for each row execute function public.karma_on_post_change();

-- ── 3. follower (+1 / -1) — follow_edges INSERT/DELETE ──────────────────────
create or replace function public.karma_on_follow_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ref text;
begin
  if tg_op = 'INSERT' then
    v_ref := new.follower_id::text || ':' || new.followed_id::text;
    perform public.karma_apply(new.followed_id, 'follower_gained', 'follow', v_ref, 1);
    return null;
  end if;
  v_ref := old.follower_id::text || ':' || old.followed_id::text;
  perform public.karma_apply(old.followed_id, 'follower_gained_reverse', 'follow', v_ref, -1);
  return null;
end;
$$;
drop trigger if exists karma_follow_after_insert on public.follow_edges;
create trigger karma_follow_after_insert
  after insert on public.follow_edges
  for each row execute function public.karma_on_follow_change();
drop trigger if exists karma_follow_after_delete on public.follow_edges;
create trigger karma_follow_after_delete
  after delete on public.follow_edges
  for each row execute function public.karma_on_follow_change();

-- ── 4. outreach (+1, once per sender+anchor-post, soft daily cap) — messages ─
-- First message a non-owner sends in a post-anchored chat. Per-post dedupe via the
-- once-index; a soft daily cap (FR-KARMA-006) blocks mass-DM farming + inbox spam.
-- System messages (sender null) ignored. Cheap short-circuits run first, so the
-- ~99% of messages that aren't first-contact skip the count query.
create or replace function public.karma_on_message_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_anchor uuid; v_owner uuid; v_today integer;
begin
  if new.sender_id is null then return null; end if;
  select c.anchor_post_id into v_anchor from public.chats c where c.chat_id = new.chat_id;
  if v_anchor is null then return null; end if;
  select p.owner_id into v_owner from public.posts p where p.post_id = v_anchor;
  if v_owner is null or v_owner = new.sender_id then return null; end if;
  select count(*) into v_today from public.karma_ledger
   where user_id = new.sender_id and event_type = 'outreach'
     and created_at >= date_trunc('day', now());
  if v_today >= 10 then return null; end if;  -- KARMA_OUTREACH_DAILY_CAP
  perform public.karma_grant_once(new.sender_id, 'outreach', 'post', v_anchor::text, 1);
  return null;
end;
$$;
drop trigger if exists karma_messages_after_insert on public.messages;
create trigger karma_messages_after_insert
  after insert on public.messages
  for each row execute function public.karma_on_message_insert();

-- end of 0189_karma_triggers
