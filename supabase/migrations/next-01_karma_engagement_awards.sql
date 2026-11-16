-- Karma · signing up, gaining a follower and a first contact on a post earn points
-- (spec 07 §7.6 "existing" awards, FR-KARMA-002, FR-KARMA-006, KC#2391)
--
-- The project book lists these three awards as existing, and the app's "how to earn"
-- explainer promises them, but the baseline karma module seeded no value for them and
-- nothing recorded the events. Like every other award they are not computed on the write
-- path: a trigger records an `award` (or `revoke`) event on outbox topic `karma` and the
-- consumer (72_karma/030) pays the configured value, once per subject and within the cap.
--
--   registration     a new member: +1, once
--   follower_gained  the followed member: +1 per follower; taken back when the edge goes
--                    (an unfollow, a removed follower), paid again on a new follow
--   outreach         the first message a member sends in a chat pinned to another member's
--                    post: +1, once per post and sender, at most 10 awards per Israel day
--
-- Members who signed up before this migration get no retroactive points.

-- The values are configuration (D29). Idempotent: a re-run leaves a tuned value as it is.
insert into kc_private.karma_values (event_type, context, points, unit, max_units, daily_cap) values
  ('registration', '', 1, 'once', 1, null),
  ('follower_gained', '', 1, 'once', 1, null),
  ('outreach', '', 1, 'once', 1, 10)
on conflict do nothing;

-- ── Sign-up ─────────────────────────────────────────────────────────────────────────────

create function kc_private.users_karma_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.outbox_enqueue('karma', jsonb_build_object(
    'kind', 'award', 'event_type', 'registration', 'user_id', new.id,
    'subject', 'user:' || new.id || ':registration'));
  return null;
end;
$$;
comment on function kc_private.users_karma_registration() is
  'AFTER INSERT on users: records the karma award of signing up.';

create trigger users_karma_registration
  after insert on public.users
  for each row execute function kc_private.users_karma_registration();

-- ── Followers ───────────────────────────────────────────────────────────────────────────

-- One subject per edge, so the award of a follow and the reversal of its removal meet.
create function kc_private.follows_karma_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edge constant public.follows := case tg_op when 'INSERT' then new else old end;
  v_subject constant text := 'follow:' || v_edge.followed_id || ':' || v_edge.follower_id;
begin
  if tg_op = 'INSERT' then
    perform kc_private.outbox_enqueue('karma', jsonb_build_object(
      'kind', 'award', 'event_type', 'follower_gained', 'user_id', v_edge.followed_id, 'subject', v_subject));
  else
    perform kc_private.outbox_enqueue('karma', jsonb_build_object(
      'kind', 'revoke', 'user_id', v_edge.followed_id, 'subject_prefix', v_subject));
  end if;
  return null;
end;
$$;
comment on function kc_private.follows_karma_events() is
  'AFTER INSERT OR DELETE on follows: records the karma award of a new follower, or its reversal.';

create trigger follows_karma_events
  after insert or delete on public.follows
  for each row execute function kc_private.follows_karma_events();

-- ── First contact on a post ─────────────────────────────────────────────────────────────

-- A member's message in a chat pinned to someone else's post is a contact on that post. Only
-- the first one earns: the ledger is checked here so a long conversation does not record an
-- event per message (the consumer would refuse the repeats anyway; a second message sent
-- before the first event is performed records one more event that pays nothing).
create function kc_private.messages_karma_outreach()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id uuid;
  v_subject text;
begin
  -- System messages have no sender.
  if new.sender_id is null then
    return null;
  end if;
  select p.id into v_post_id
    from public.chats c
    join public.posts p on p.id = c.anchor_post_id
   where c.id = new.chat_id and p.owner_id <> new.sender_id;
  if not found then
    return null;
  end if;

  v_subject := 'outreach:' || v_post_id || ':' || new.sender_id;
  if not exists (select 1 from public.karma_ledger l
                  where l.user_id = new.sender_id and l.subject = v_subject) then
    perform kc_private.outbox_enqueue('karma', jsonb_build_object(
      'kind', 'award', 'event_type', 'outreach', 'user_id', new.sender_id, 'subject', v_subject));
  end if;
  return null;
end;
$$;
comment on function kc_private.messages_karma_outreach() is
  'AFTER INSERT on messages: records the karma award of a member''s first message about another member''s post.';

create trigger messages_karma_outreach
  after insert on public.messages
  for each row execute function kc_private.messages_karma_outreach();
