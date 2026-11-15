-- 0413_list_my_listings_keyset | perf: keyset cursor for "My listings".
-- Adds (p_cursor_updated_at, p_cursor_id); p_offset stays for old clients and is
-- ignored when a cursor is passed. Backed by an (owner_id, updated_at, listing_id) index.

begin;

create index if not exists listings_owner_updated_keyset_idx
  on public.listings (owner_id, updated_at desc, listing_id desc);

drop function if exists public.list_my_listings(int, int);

create or replace function public.list_my_listings(
  p_limit int default 50,
  p_offset int default 0,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  listing_id uuid,
  world_slug text,
  kind_slug text,
  direction text,
  status text,
  title text,
  summary text,
  urgency_level smallint,
  availability_status text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.listing_id,
    l.world_slug,
    lk.slug,
    l.direction,
    l.status,
    l.title,
    l.summary,
    l.urgency_level,
    l.availability_status,
    l.updated_at
  from public.listings l
  join public.listing_kinds lk on lk.kind_id = l.kind_id
  where l.owner_id = auth.uid()
    and l.status <> 'removed_admin'
    and (
      p_cursor_id is null
      or (l.updated_at, l.listing_id) < (p_cursor_updated_at, p_cursor_id)
    )
  order by l.updated_at desc, l.listing_id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset case when p_cursor_id is null then greatest(coalesce(p_offset, 0), 0) else 0 end;
$$;

revoke all on function public.list_my_listings(int, int, timestamptz, uuid) from public;
grant execute on function public.list_my_listings(int, int, timestamptz, uuid) to authenticated;

commit;
