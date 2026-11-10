-- Social · post_comments (comments and one level of replies, D25, S8)
--
-- A comment is written and edited as a plain row under RLS; triggers supply everything a
-- device must not decide (thread rule, write rate, mentions, edit stamp, notifications).
-- Deleting is a status move (machine `post_comment`) made by delete_post_comment, so the
-- row stays as evidence for moderation while nobody can read it any more.

insert into kc_private.fsm_state (machine_id, status) values
  ('post_comment', 'active'),
  ('post_comment', 'deleted');

-- Who may delete a comment (S9). `deleted` is final.
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('post_comment', 'active', 'deleted', 'author'),
  ('post_comment', 'active', 'deleted', 'post_owner'),
  ('post_comment', 'active', 'deleted', 'admin');

create table public.post_comments (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references public.posts (id) on delete cascade,
  author_id         uuid not null references public.users (id) on delete cascade,
  -- Null for a comment on the post; a reply points at a top-level comment of the same post.
  parent_comment_id uuid references public.post_comments (id) on delete cascade,
  body              text not null check (char_length(body) between 1 and 2000 and body = btrim(body)),
  -- Lifecycle, machine `post_comment`. Never written by a device.
  status            text not null default 'active',
  -- Members named in the body as @share_handle who can read the post; derived by trigger.
  mention_user_ids  uuid[] not null default '{}',
  edited_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.post_comments is 'Comments on a post, with one level of replies. Removal is a status move.';

-- Comments of a post, oldest first: top-level list (parent is null) and, by prefix, the
-- removal of a post's comments; covers the post foreign key.
create index post_comments_thread_idx on public.post_comments (post_id, parent_comment_id, created_at, id);
-- Replies of a comment, oldest first; covers the parent foreign key.
create index post_comments_replies_idx on public.post_comments (parent_comment_id, created_at, id)
  where parent_comment_id is not null;
-- Write-rate check and removal of a member's comments; covers the author foreign key.
create index post_comments_author_recent_idx on public.post_comments (author_id, created_at desc);

create trigger post_comments_status_fsm
  before insert or update of status on public.post_comments
  for each row execute function kc_private.fsm_guard_status('post_comment', 'status');
create trigger post_comments_set_updated_at
  before update on public.post_comments
  for each row execute function kc_private.set_updated_at();

-- Members named in a comment body as @share_handle, at most ten, who are active, are not in
-- a blocked pair with the author and can read the post. The audience test repeats the post
-- policy for another member, because a policy only ever answers for the caller.
create function kc_private.comment_mentions(p_body text, p_author_id uuid, p_post_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.id), '{}')
    from (select u.id
            from public.posts p
            join public.users u
              on u.share_handle in (select lower(t[1]) from regexp_matches(p_body, '@([A-Za-z0-9_]{3,30})', 'g') t)
           where p.id = p_post_id
             and u.is_active
             and u.id <> p_author_id
             and not kc_access.is_blocked_between(u.id, p_author_id)
             and not kc_access.is_blocked_between(u.id, p.owner_id)
             and (u.id = p.owner_id
                  or p.visibility = 'Public'
                  or (p.visibility = 'FollowersOnly'
                      and exists (select 1 from public.follows f
                                   where f.follower_id = u.id and f.followed_id = p.owner_id)))
           order by u.share_handle
           limit 10) m;
$$;
comment on function kc_private.comment_mentions(text, uuid, uuid) is
  'Resolves the @share_handle tokens of a comment body to members who can read the post.';

-- Server-side part of a comment write.
--   insert  at most 20 comments a minute per member; a reply must point at an active
--           top-level comment of the same post (one thread level, S8); mentions resolved
--   edit    the body changed: edit stamp and mentions refreshed
create function kc_private.post_comments_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.post_comments c
         where c.author_id = new.author_id and c.created_at > now() - interval '1 minute') >= 20 then
      raise exception 'rate_limited' using errcode = 'P0001', detail = 'at most 20 comments a minute';
    end if;
    if new.parent_comment_id is not null and not exists (
         select 1 from public.post_comments c
          where c.id = new.parent_comment_id and c.post_id = new.post_id
            and c.parent_comment_id is null and c.status = 'active') then
      raise exception 'comment_parent_invalid' using errcode = 'P0001';
    end if;
  else
    new.edited_at := now();
  end if;
  new.mention_user_ids := kc_private.comment_mentions(new.body, new.author_id, new.post_id);
  return new;
end;
$$;

create trigger post_comments_prepare_insert
  before insert on public.post_comments
  for each row execute function kc_private.post_comments_prepare();
create trigger post_comments_prepare_edit
  before update of body on public.post_comments
  for each row when (old.body is distinct from new.body)
  execute function kc_private.post_comments_prepare();

-- Keeps post_stats.comments_count (active comments) in step, once per statement: a new
-- comment counts, a comment that leaves `active` or is removed while active stops counting.
create function kc_private.post_comments_sync_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform kc_private.post_stats_add(
      'comments', 1, array(select c.post_id from changed c where c.status = 'active'));
  elsif tg_op = 'DELETE' then
    perform kc_private.post_stats_add(
      'comments', -1, array(select c.post_id from changed c where c.status = 'active'));
  else
    perform kc_private.post_stats_add(
      'comments', -1,
      array(select o.post_id from changed o join changed_new n on n.id = o.id
             where o.status = 'active' and n.status <> 'active'));
  end if;
  return null;
end;
$$;

create trigger post_comments_count_insert
  after insert on public.post_comments
  referencing new table as changed
  for each statement execute function kc_private.post_comments_sync_stats();
create trigger post_comments_count_delete
  after delete on public.post_comments
  referencing old table as changed
  for each statement execute function kc_private.post_comments_sync_stats();
create trigger post_comments_count_status
  after update on public.post_comments
  referencing old table as changed new table as changed_new
  for each statement execute function kc_private.post_comments_sync_stats();

-- A new comment notifies, each member at most once and never the author:
--   post_comment_reply   the author of the comment replied to
--   post_comment         the post's owner
--   post_mention         every member named in the body
create function kc_private.post_comments_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_author_id constant uuid :=
    (select c.author_id from public.post_comments c where c.id = new.parent_comment_id);
  v_owner_id constant uuid := (select p.owner_id from public.posts p where p.id = new.post_id);
  v_mentioned_id uuid;
begin
  perform kc_private.notify_engagement(
    'post_comment_reply', v_parent_author_id, new.author_id, new.post_id, 'post_comment', new.id);
  if v_owner_id is distinct from v_parent_author_id then
    perform kc_private.notify_engagement(
      'post_comment', v_owner_id, new.author_id, new.post_id, 'post_comment', new.id);
  end if;
  foreach v_mentioned_id in array new.mention_user_ids loop
    if v_mentioned_id is distinct from v_owner_id and v_mentioned_id is distinct from v_parent_author_id then
      perform kc_private.notify_engagement(
        'post_mention', v_mentioned_id, new.author_id, new.post_id, 'post_comment', new.id);
    end if;
  end loop;
  return null;
end;
$$;

create trigger post_comments_notify
  after insert on public.post_comments
  for each row execute function kc_private.post_comments_notify();

alter table public.post_comments enable row level security;
alter table public.post_comments force row level security;

-- An active comment is visible when its post is and its author is (both under the caller's
-- own access): comments on a post the caller cannot read do not exist for them, and members
-- in a blocked pair never see each other's comments. A deleted comment is visible to nobody.
create policy post_comments_select_visible on public.post_comments
  for select to authenticated
  using (
    status = 'active'
    and exists (select 1 from public.posts p where p.id = post_comments.post_id)
    and exists (select 1 from public.users u where u.id = post_comments.author_id));

-- A member with an active account comments, as themselves, on a published post they can read.
create policy post_comments_insert_self on public.post_comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'active'
    and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_active)
    and exists (select 1 from public.posts p
                 where p.id = post_comments.post_id and p.status in ('open', 'closed_delivered')));

-- The author edits the body of their own active comment; which column is decided by the grant.
create policy post_comments_update_author on public.post_comments
  for update to authenticated
  using (author_id = (select auth.uid()) and status = 'active')
  with check (author_id = (select auth.uid()));

grant select on public.post_comments to authenticated;
-- Not insertable: status, mention_user_ids, edited_at, timestamps — all server-written.
grant insert (id, post_id, author_id, parent_comment_id, body) on public.post_comments to authenticated;
grant update (body) on public.post_comments to authenticated;

-- Deletes a comment: its author or the owner of the post may (S9; moderators act through
-- the moderation module). The replies under a top-level comment go with it, so no reply is
-- left without its thread. An RPC because the status column is not writable by a device and
-- the move names the role it is made in. Idempotent on an already deleted comment.
create function public.delete_post_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_comment public.post_comments;
  v_role text;
begin
  select c.* into v_comment from public.post_comments c where c.id = p_comment_id for update;
  v_role := case
    when v_comment.author_id = v_user_id then 'author'
    when exists (select 1 from public.posts p where p.id = v_comment.post_id and p.owner_id = v_user_id)
      then 'post_owner' end;
  -- One answer for "no such comment" and "not yours to delete".
  if v_role is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  perform set_config('kc.fsm_role', v_role, true);
  update public.post_comments c
     set status = 'deleted'
   where (c.id = p_comment_id or c.parent_comment_id = p_comment_id) and c.status = 'active';
  perform set_config('kc.fsm_role', '', true);
end;
$$;
comment on function public.delete_post_comment(uuid) is
  'Deletes a comment and its replies; allowed to its author and to the owner of the post.';
grant execute on function public.delete_post_comment(uuid) to authenticated;
