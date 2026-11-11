-- 0284_search_all_rpc | KC#872 — unified search (people, orgs, hashtags, posts).

create extension if not exists pg_trgm;

create table if not exists public.search_hashtags (
  tag        text primary key check (char_length(tag) between 2 and 40),
  use_count  integer not null default 0 check (use_count >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.search_hashtags is
  'KC#872: discoverable hashtags; use_count from post category/title tokens.';

alter table public.search_hashtags enable row level security;
create policy search_hashtags_read on public.search_hashtags for select using (true);

-- Seed tags from open post categories (idempotent).
insert into public.search_hashtags (tag, use_count)
select lower(replace(p.category, ' ', '-')), count(*)::integer
  from public.posts p
 where p.status = 'open'
 group by 1
on conflict (tag) do update
  set use_count = excluded.use_count, updated_at = now();

create or replace function public.search_all(
  p_query text,
  p_types text[] default array['people','orgs','hashtags','posts'],
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_q text := trim(coalesce(p_query, ''));
  v_lim int := greatest(1, least(coalesce(p_limit, 20), 50));
  v_esc text;
  v_viewer uuid := (select auth.uid());
  v_out jsonb := '{}'::jsonb;
begin
  if char_length(v_q) < 2 then
    return jsonb_build_object(
      'people', '[]'::jsonb,
      'orgs', '[]'::jsonb,
      'hashtags', '[]'::jsonb,
      'posts', '[]'::jsonb,
      'suggested', to_jsonb(array(select s.tag from public.search_hashtags s order by s.use_count desc limit 8))
    );
  end if;

  v_esc := public.escape_ilike(v_q);

  if 'people' = any (p_types) then
    v_out := v_out || jsonb_build_object(
      'people',
      coalesce((
        select jsonb_agg(row_to_json(t))
          from (
            select u.user_id, u.display_name, u.share_handle, u.avatar_url,
                   u.city, u.city_name, u.followers_count,
                   greatest(
                     similarity(coalesce(u.display_name, ''), v_q),
                     similarity(u.share_handle, v_q)
                   ) as rank
              from public.users u
             where u.account_status = 'active'
               and u.onboarding_state = 'completed'
               and u.privacy_mode = 'Public'
               and (v_viewer is null or not public.is_blocked(v_viewer, u.user_id))
               and (
                 u.display_name ilike '%' || v_esc || '%' escape '\'
                 or u.share_handle ilike '%' || v_esc || '%' escape '\'
                 or similarity(u.share_handle, v_q) > 0.2
               )
             order by rank desc, u.followers_count desc
             limit v_lim
          ) t
      ), '[]'::jsonb)
    );
  end if;

  if 'orgs' = any (p_types) then
    v_out := v_out || jsonb_build_object(
      'orgs',
      coalesce((
        select jsonb_agg(row_to_json(t))
          from (
            select o.org_id, o.name, o.slug,
                   similarity(o.name, v_q) as rank
              from public.organizations o
             where o.name ilike '%' || v_esc || '%' escape '\'
                or o.slug ilike '%' || v_esc || '%' escape '\'
             order by rank desc, o.name
             limit v_lim
          ) t
      ), '[]'::jsonb)
    );
  end if;

  if 'hashtags' = any (p_types) then
    v_out := v_out || jsonb_build_object(
      'hashtags',
      coalesce((
        select jsonb_agg(row_to_json(t))
          from (
            select h.tag, h.use_count,
                   similarity(h.tag, v_q) as rank
              from public.search_hashtags h
             where h.tag ilike '%' || v_esc || '%' escape '\'
                or similarity(h.tag, v_q) > 0.25
             order by rank desc, h.use_count desc
             limit v_lim
          ) t
      ), '[]'::jsonb)
    );
  end if;

  if 'posts' = any (p_types) then
    v_out := v_out || jsonb_build_object(
      'posts',
      coalesce((
        select jsonb_agg(row_to_json(t))
          from (
            select p.post_id, p.title, p.type, p.category, p.created_at,
                   p.owner_id
              from public.posts p
             where p.status = 'open'
               and public.is_post_visible_to(p.*, v_viewer)
               and (
                 p.title ilike '%' || v_esc || '%' escape '\'
                 or p.description ilike '%' || v_esc || '%' escape '\'
               )
             order by p.created_at desc
             limit v_lim
          ) t
      ), '[]'::jsonb)
    );
  end if;

  return v_out;
end;
$$;

grant execute on function public.search_all(text, text[], integer) to anon, authenticated;

create or replace function public.rpc_search_suggested_queries()
returns text[]
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(array_agg(tag order by use_count desc), '{}'::text[])
    from (select tag, use_count from public.search_hashtags order by use_count desc limit 10) s;
$$;

grant execute on function public.rpc_search_suggested_queries() to authenticated;
