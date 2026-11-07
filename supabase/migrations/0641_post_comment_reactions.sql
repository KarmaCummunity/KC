-- 0641_post_comment_reactions | G12 / D25 — like on post comments (one per user).

create table if not exists public.post_comment_reactions (
  comment_id uuid not null references public.post_comments(comment_id) on delete cascade,
  user_id    uuid not null references public.users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists post_comment_reactions_comment_idx
  on public.post_comment_reactions (comment_id);

alter table public.post_comment_reactions enable row level security;
grant select, insert, delete on public.post_comment_reactions to authenticated;

create policy post_comment_reactions_select_visible on public.post_comment_reactions
  for select using (
    exists (
      select 1
        from public.post_comments c
       where c.comment_id = post_comment_reactions.comment_id
         and c.status = 'active'
         and public.is_post_engagement_visible(c.post_id, (select auth.uid()))
    )
  );

create policy post_comment_reactions_insert_self on public.post_comment_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_active_member((select auth.uid()))
    and exists (
      select 1
        from public.post_comments c
       where c.comment_id = post_comment_reactions.comment_id
         and c.status = 'active'
         and public.is_post_engagement_visible(c.post_id, (select auth.uid()))
    )
  );

create policy post_comment_reactions_delete_self on public.post_comment_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.rpc_set_post_comment_like(p_comment_id uuid, p_liked boolean)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_active_member((select auth.uid())) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from public.post_comments c
     where c.comment_id = p_comment_id
       and c.status = 'active'
       and public.is_post_engagement_visible(c.post_id, (select auth.uid()))
  ) then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  if coalesce(p_liked, false) then
    insert into public.post_comment_reactions (comment_id, user_id)
    values (p_comment_id, (select auth.uid()))
    on conflict (comment_id, user_id) do nothing;
    return true;
  end if;

  delete from public.post_comment_reactions
   where comment_id = p_comment_id
     and user_id = (select auth.uid());
  return false;
end;
$$;

revoke all on function public.rpc_set_post_comment_like(uuid, boolean) from public;
grant execute on function public.rpc_set_post_comment_like(uuid, boolean) to authenticated;
