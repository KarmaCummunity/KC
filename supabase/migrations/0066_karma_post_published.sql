-- Karma · publishing a post earns points (spec 07 §7.6 "Publish post", FR-KARMA-005)
--
-- The baseline pays karma for closed giving, ratings, challenges and donations, but it seeded
-- no value for publishing a post and nothing recorded the event, so a member who published a
-- post (an organization's event, a ride, an item) earned nothing (KC#2289).
--
-- Like every other award, the points are not computed on the write path: a trigger records an
-- `award` event on outbox topic `karma` and the consumer (72_karma/030) pays the configured
-- value, once per post and within the daily cap.
--
--   published            a member's post leaves draft (or is created past it) for the first
--                        time: +5, at most 5 awards per Israel calendar day
--   removed by an admin  the points the member still holds for the post are taken back
--   restored by an admin the award is recorded again (the consumer pays a subject only while
--                        it holds no points, so a post never pays twice)
--
-- Not rewarded here:
--   * a post the scheduler publishes (the next date of a recurring ride or event): the member
--     took no action, and one series would otherwise pay every day;
--   * a challenge's post: opening a challenge has its own award (`challenge_opened`);
--   * an imported post: it is rewarded when a member claims it, which no flow does yet.

-- The value is configuration (D29): tuned by changing this row, never the code below.
-- Idempotent: a re-run leaves a tuned value as it is.
insert into kc_private.karma_values (event_type, context, points, unit, max_units, daily_cap) values
  ('post_published', '', 5, 'once', 1, 5)
on conflict do nothing;

-- Records the karma event of one post write, in the writing transaction. Definer rights: the
-- outbox is not writable by members. The subject `post:<id>:published` ties the award, its
-- reversal and a later re-award to the same post.
create function kc_private.posts_karma_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject constant text := 'post:' || new.id || ':published';
  -- The post is published by this write: created already published, or leaving draft.
  v_published constant boolean := new.published_at is not null
    and (tg_op = 'INSERT' or old.published_at is null);
  v_removed constant boolean := tg_op = 'UPDATE'
    and new.status = 'removed_admin' and old.status <> 'removed_admin';
  v_restored constant boolean := tg_op = 'UPDATE'
    and old.status = 'removed_admin' and new.status <> 'removed_admin';
begin
  if new.source <> 'native' or new.post_type = 'challenge' then
    return null;
  end if;

  if v_removed then
    perform kc_private.outbox_enqueue('karma', jsonb_build_object(
      'kind', 'revoke', 'user_id', new.owner_id, 'subject_prefix', v_subject));
  elsif v_restored
        -- `system` is the scheduler publishing an occurrence of a series.
        or (v_published and coalesce(current_setting('kc.fsm_role', true), '') <> 'system') then
    perform kc_private.outbox_enqueue('karma', jsonb_build_object(
      'kind', 'award', 'event_type', 'post_published', 'user_id', new.owner_id, 'subject', v_subject));
  end if;
  return null;
end;
$$;
comment on function kc_private.posts_karma_events() is
  'AFTER trigger on posts: records the karma event of publishing a post, and of its removal or restore by an admin.';

create trigger posts_karma_events
  after insert or update of status on public.posts
  for each row execute function kc_private.posts_karma_events();
