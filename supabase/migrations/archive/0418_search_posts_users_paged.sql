-- 0418_search_posts_users_paged | Post / user text search without exact counts.
--
-- The PostgREST search ran `count=exact` plus `ilike` OR-filters under security-barrier RLS:
-- non-leakproof ilike can't become an index qual, so every search evaluated RLS on every
-- row twice (count + page). These RPCs return the next page of ids (callers ask limit+1 to
-- learn has-more), find candidates via trigram indexes, and check visibility lazily on
-- candidates only. Callers hydrate the ids through RLS-protected selects (defence in depth).

begin;

create index if not exists posts_open_search_text_trgm_idx
  on public.posts
  using gin ((coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(category, '')) extensions.gin_trgm_ops)
  where status = 'open';

create index if not exists users_search_text_trgm_idx
  on public.users
  using gin ((coalesce(display_name, '') || ' ' || coalesce(share_handle, '') || ' ' || coalesce(biography, '')) extensions.gin_trgm_ops);

create or replace function public.search_posts_page(
  p_query    text,
  p_type     text default null,
  p_category text default null,
  p_city     text default null,
  p_limit    integer default 21
)
returns table (post_id uuid, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_viewer uuid := auth.uid();
  v_lim    integer := least(greatest(coalesce(p_limit, 21), 1), 101);
  v_pat    text;
  v_n      integer := 0;
  r        public.posts;
begin
  if p_query is null or char_length(trim(p_query)) < 2 then
    return;
  end if;
  v_pat := '%' || public.escape_ilike(trim(p_query)) || '%';

  for r in
    select p.*
      from public.posts p
     where p.status = 'open'
       and (coalesce(p.title, '') || ' ' || coalesce(p.description, '') || ' ' || coalesce(p.category, ''))
           ilike v_pat escape '\'
       and (p_type is null or p.type = p_type)
       and (p_category is null or p.category = p_category)
       and (p_city is null or p.city = p_city)
     order by p.created_at desc, p.post_id desc
  loop
    continue when not public.is_post_visible_to(r, v_viewer);
    post_id := r.post_id;
    created_at := r.created_at;
    return next;
    v_n := v_n + 1;
    exit when v_n >= v_lim;
  end loop;
end;
$$;

comment on function public.search_posts_page(text, text, text, text, integer) is
  'Text search over open posts: next page of visible post ids (newest first). Ask limit+1 for has-more.';

revoke all on function public.search_posts_page(text, text, text, text, integer) from public;
grant execute on function public.search_posts_page(text, text, text, text, integer) to anon, authenticated, service_role;

create or replace function public.search_users_page(
  p_query         text,
  p_city          text default null,
  p_min_followers integer default null,
  p_sort          text default 'followers',
  p_limit         integer default 21
)
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_viewer uuid := auth.uid();
  v_lim    integer := least(greatest(coalesce(p_limit, 21), 1), 101);
  v_pat    text;
  v_n      integer := 0;
  r        record;
begin
  if p_query is null or char_length(trim(p_query)) < 2 then
    return;
  end if;
  v_pat := '%' || public.escape_ilike(trim(p_query)) || '%';

  for r in
    select u.user_id as uid, u.account_status
      from public.users u
     where (coalesce(u.display_name, '') || ' ' || coalesce(u.share_handle, '') || ' ' || coalesce(u.biography, ''))
           ilike v_pat escape '\'
       and (p_city is null or u.city = p_city)
       and (coalesce(p_min_followers, 0) <= 0 or u.followers_count >= p_min_followers)
     order by
       case when p_sort = 'newest' then u.created_at end desc nulls last,
       case when p_sort = 'newest' then null else u.followers_count end desc nulls last,
       u.user_id desc
  loop
    -- Mirrors users SELECT RLS (users_select_active / users_select_self).
    continue when not (
      r.uid = v_viewer
      or (r.account_status = 'active' and not public.is_blocked(v_viewer, r.uid))
    );
    user_id := r.uid;
    return next;
    v_n := v_n + 1;
    exit when v_n >= v_lim;
  end loop;
end;
$$;

comment on function public.search_users_page(text, text, integer, text, integer) is
  'Text search over users: next page of visible user ids. Ask limit+1 for has-more.';

revoke all on function public.search_users_page(text, text, integer, text, integer) from public;
grant execute on function public.search_users_page(text, text, integer, text, integer) to anon, authenticated, service_role;

commit;
