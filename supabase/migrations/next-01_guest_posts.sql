-- KC #2511 / D178: basic guest browsing after the Apple 5.1.1(v) rejection. Explicit projection only: title, description and city. The id is
-- an opaque detail/pagination key. No author, contact, media, location or details.
-- Existing tables, member RPCs and their RLS/grants remain unchanged.
create function public.guest_posts(
  p_post_id uuid default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns table (id uuid, title text, description text, city_name_he text, city_name_en text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.title, p.description, c.name_he, c.name_en
    from public.posts p
    join public.users u on u.id = p.owner_id and u.is_active
    join public.worlds w on w.slug = p.world_slug and w.is_active
    join public.post_kinds k on k.id = p.kind_id and k.world_slug = p.world_slug and k.is_active
    join public.cities c on c.city_id = p.city_id
   where p.status = 'open' and p.visibility = 'Public'
     and p.published_at is not null
     and (p.expires_at is null or p.expires_at > now())
     and (p_post_id is null or p.id = p_post_id)
     and (p_before_id is null or p.id < p_before_id)
   order by p.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 20);
$$;
revoke all on function public.guest_posts(uuid, uuid, integer) from public;
grant execute on function public.guest_posts(uuid, uuid, integer) to anon, authenticated;
comment on function public.guest_posts(uuid, uuid, integer) is
  'Guest read-only open Public posts: title, description, city only. No member identity or account actions.';
