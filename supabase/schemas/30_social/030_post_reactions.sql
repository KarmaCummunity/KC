-- Social · post_reactions (a member's reaction to a post, D25)
--
-- At most one reaction per member per post. Adding and removing are plain row writes under
-- RLS; switching the type of an existing reaction goes through set_post_reaction below.

create table public.post_reactions (
  post_id       uuid not null references public.posts (id) on delete cascade,
  user_id       uuid not null references public.users (id) on delete cascade,
  reaction_type text not null default 'like' check (reaction_type in ('like', 'support', 'thanks')),
  created_at    timestamptz not null default now(),
  primary key (post_id, user_id)
);
comment on table public.post_reactions is 'One reaction per member per post.';

-- Removal of a member's reactions with their account; covers the user foreign key.
create index post_reactions_user_idx on public.post_reactions (user_id, created_at desc);

-- Keeps post_stats.reactions_count in step, once per statement.
create function kc_private.post_reactions_sync_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.post_stats_add(
    'reactions', case tg_op when 'INSERT' then 1 else -1 end, array(select c.post_id from changed c));
  return null;
end;
$$;

create trigger post_reactions_count_insert
  after insert on public.post_reactions
  referencing new table as changed
  for each statement execute function kc_private.post_reactions_sync_stats();
create trigger post_reactions_count_delete
  after delete on public.post_reactions
  referencing old table as changed
  for each statement execute function kc_private.post_reactions_sync_stats();

-- A new reaction notifies the post's owner (kind `post_reaction`). A type switch does not.
create function kc_private.post_reactions_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.notify_engagement(
    'post_reaction', (select p.owner_id from public.posts p where p.id = new.post_id),
    new.user_id, new.post_id, 'post', new.post_id);
  return null;
end;
$$;

create trigger post_reactions_notify
  after insert on public.post_reactions
  for each row execute function kc_private.post_reactions_notify();

alter table public.post_reactions enable row level security;
alter table public.post_reactions force row level security;

-- A reaction is visible when its post is and its author is: both subqueries run under the
-- caller's own access, so a post the caller cannot read shows no reactions, and members in
-- a blocked pair (or with an inactive account) never see each other's.
create policy post_reactions_select_visible on public.post_reactions
  for select to authenticated
  using (
    exists (select 1 from public.posts p where p.id = post_reactions.post_id)
    and exists (select 1 from public.users u where u.id = post_reactions.user_id));

-- A member with an active account reacts, as themselves, to a published post they can read.
create policy post_reactions_insert_self on public.post_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_active)
    and exists (select 1 from public.posts p
                 where p.id = post_reactions.post_id and p.status in ('open', 'closed_delivered')));

-- Only the type of one's own reaction changes; which column is decided by the grant.
create policy post_reactions_update_self on public.post_reactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy post_reactions_delete_self on public.post_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.post_reactions to authenticated;
grant update (reaction_type) on public.post_reactions to authenticated;

-- Sets the caller's reaction on a post: a type adds the reaction or switches its type, null
-- removes it. Returns the type now held. An RPC because "insert, or change the type of the
-- one I have" is an upsert, which the REST layer can only express with update rights on the
-- key columns. Runs with the caller's rights: every rule is enforced by the policies above.
create function public.set_post_reaction(p_post_id uuid, p_reaction_type text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id constant uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_reaction_type is null then
    delete from public.post_reactions r where r.post_id = p_post_id and r.user_id = v_user_id;
    return null;
  end if;
  if p_reaction_type not in ('like', 'support', 'thanks') then
    raise exception 'invalid_reaction_type' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.users u where u.id = v_user_id and u.is_active) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.posts p
                  where p.id = p_post_id and p.status in ('open', 'closed_delivered')) then
    raise exception 'post_not_found' using errcode = 'P0001';
  end if;

  insert into public.post_reactions as r (post_id, user_id, reaction_type)
  values (p_post_id, v_user_id, p_reaction_type)
  on conflict (post_id, user_id) do update set reaction_type = excluded.reaction_type
    where r.reaction_type <> excluded.reaction_type;
  return p_reaction_type;
end;
$$;
comment on function public.set_post_reaction(uuid, text) is
  'Adds, switches or (with null) removes the caller''s reaction on a post; returns the type now held.';
grant execute on function public.set_post_reaction(uuid, text) to authenticated;
