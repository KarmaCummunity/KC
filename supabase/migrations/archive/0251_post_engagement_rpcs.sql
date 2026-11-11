-- 0251_post_engagement_rpcs | KC#867 — SECURITY INVOKER RPCs for engagement mutations.

set search_path = public;

-- ── Rate limits (engagement) ───────────────────────────────────────────────────

create or replace function public.trg_post_comments_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enforce_rate_limit(
    'post_comments:' || new.author_id::text,
    20,
    60
  );
  return new;
end;
$$;

drop trigger if exists tg_post_comments_rate_limit on public.post_comments;
create trigger tg_post_comments_rate_limit
  before insert on public.post_comments
  for each row execute function public.trg_post_comments_rate_limit();

create or replace function public.trg_post_reactions_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enforce_rate_limit(
    'post_reactions:' || new.user_id::text,
    60,
    60
  );
  return new;
end;
$$;

drop trigger if exists tg_post_reactions_rate_limit on public.post_reactions;
create trigger tg_post_reactions_rate_limit
  before insert on public.post_reactions
  for each row execute function public.trg_post_reactions_rate_limit();

create or replace function public.trg_post_shares_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enforce_rate_limit(
    'post_shares:' || new.user_id::text,
    30,
    3600
  );
  return new;
end;
$$;

drop trigger if exists tg_post_shares_rate_limit on public.post_shares;
create trigger tg_post_shares_rate_limit
  before insert on public.post_shares
  for each row execute function public.trg_post_shares_rate_limit();

-- ── Mention resolution (@share_handle tokens in body) ──────────────────────────

create or replace function public.resolve_comment_mentions(p_body text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct u.user_id), '{}'::uuid[])
    from public.users u
   where u.account_status = 'active'
     and lower(u.share_handle) in (
       select lower(m[1])
         from regexp_matches(coalesce(p_body, ''), '@([a-z0-9_]{3,32})', 'gi') as m
     );
$$;

revoke all on function public.resolve_comment_mentions(text) from public;
grant execute on function public.resolve_comment_mentions(text) to authenticated, service_role;

-- ── rpc_set_post_reaction ────────────────────────────────────────────────────

create or replace function public.rpc_set_post_reaction(
  p_post_id uuid,
  p_reaction_type text
)
returns public.post_reactions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.post_reactions;
begin
  if not public.is_active_member((select auth.uid())) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  if p_reaction_type is null then
    delete from public.post_reactions
     where post_id = p_post_id and user_id = (select auth.uid());
    return null;
  end if;
  if p_reaction_type not in ('like', 'support', 'thanks') then
    raise exception 'invalid_reaction_type' using errcode = '22023';
  end if;

  insert into public.post_reactions (post_id, user_id, reaction_type)
  values (p_post_id, (select auth.uid()), p_reaction_type)
  on conflict (post_id, user_id) do update
    set reaction_type = excluded.reaction_type
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.rpc_set_post_reaction(uuid, text) to authenticated;

-- ── rpc_create_post_comment ──────────────────────────────────────────────────

create or replace function public.rpc_create_post_comment(
  p_post_id uuid,
  p_body text,
  p_parent_comment_id uuid default null
)
returns public.post_comments
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.post_comments;
  v_mentions uuid[];
begin
  if not public.is_active_member((select auth.uid())) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  if p_body is null or char_length(trim(p_body)) < 1 then
    raise exception 'comment_body_required' using errcode = '22023';
  end if;

  v_mentions := public.resolve_comment_mentions(p_body);

  insert into public.post_comments (
    post_id, author_id, parent_comment_id, body, mention_user_ids
  ) values (
    p_post_id,
    (select auth.uid()),
    p_parent_comment_id,
    trim(p_body),
    v_mentions
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.rpc_create_post_comment(uuid, text, uuid) to authenticated;

-- ── rpc_update_post_comment ──────────────────────────────────────────────────

create or replace function public.rpc_update_post_comment(
  p_comment_id uuid,
  p_body text
)
returns public.post_comments
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.post_comments;
begin
  if not public.is_active_member((select auth.uid())) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  if p_body is null or char_length(trim(p_body)) < 1 then
    raise exception 'comment_body_required' using errcode = '22023';
  end if;

  update public.post_comments
     set body = trim(p_body),
         mention_user_ids = public.resolve_comment_mentions(trim(p_body)),
         edited_at = now()
   where comment_id = p_comment_id
     and author_id = (select auth.uid())
     and status = 'active'
  returning * into v_row;

  if v_row.comment_id is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

grant execute on function public.rpc_update_post_comment(uuid, text) to authenticated;

-- ── rpc_delete_post_comment (soft) ───────────────────────────────────────────

create or replace function public.rpc_delete_post_comment(p_comment_id uuid)
returns public.post_comments
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.post_comments;
begin
  if not public.is_active_member((select auth.uid())) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;

  update public.post_comments
     set status = 'deleted'
   where comment_id = p_comment_id
     and author_id = (select auth.uid())
     and status = 'active'
  returning * into v_row;

  if v_row.comment_id is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

grant execute on function public.rpc_delete_post_comment(uuid) to authenticated;

-- ── rpc_log_post_share ───────────────────────────────────────────────────────

create or replace function public.rpc_log_post_share(
  p_post_id uuid,
  p_share_kind text,
  p_external_channel text default null,
  p_repost_post_id uuid default null
)
returns public.post_shares
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.post_shares;
begin
  if not public.is_active_member((select auth.uid())) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  if p_share_kind not in ('in_app', 'external') then
    raise exception 'invalid_share_kind' using errcode = '22023';
  end if;

  insert into public.post_shares (
    post_id, user_id, share_kind, external_channel, repost_post_id
  ) values (
    p_post_id,
    (select auth.uid()),
    p_share_kind,
    case when p_share_kind = 'external' then p_external_channel else null end,
    p_repost_post_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.rpc_log_post_share(uuid, text, text, uuid) to authenticated;

-- ── rpc_get_post_engagement_stats ─────────────────────────────────────────────

create or replace function public.rpc_get_post_engagement_stats(p_post_id uuid)
returns public.post_stats
language sql
stable
security invoker
set search_path = public
as $$
  select s.*
    from public.post_stats s
   where s.post_id = p_post_id
     and public.is_post_engagement_visible(p_post_id, (select auth.uid()));
$$;

grant execute on function public.rpc_get_post_engagement_stats(uuid) to authenticated, anon;
