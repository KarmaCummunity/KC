-- 0323_listing_user_signals | Epic #893 / #908
-- Personalization signals + ranking RPC.

begin;

create table if not exists public.listing_user_signals (
  signal_id    uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(user_id) on delete cascade,
  listing_id   uuid not null references public.listings(listing_id) on delete cascade,
  signal_type  text not null check (signal_type in ('view', 'save', 'response')),
  weight       numeric(4, 2) not null default 1.00 check (weight > 0),
  created_at   timestamptz not null default now()
);

create index listing_user_signals_user_recent_idx
  on public.listing_user_signals (user_id, created_at desc);

create unique index listing_user_signals_save_uidx
  on public.listing_user_signals (user_id, listing_id)
  where signal_type = 'save';

alter table public.listing_user_signals enable row level security;

create policy listing_user_signals_select_own on public.listing_user_signals
  for select to authenticated using (user_id = auth.uid());

create policy listing_user_signals_insert_own on public.listing_user_signals
  for insert to authenticated with check (user_id = auth.uid());

create or replace function public.record_listing_signal(
  p_listing_id uuid,
  p_signal_type text,
  p_weight numeric default 1.0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if p_signal_type not in ('view', 'save', 'response') then
    raise exception 'invalid_signal' using errcode = '22023';
  end if;

  if p_signal_type = 'save' then
    insert into public.listing_user_signals (user_id, listing_id, signal_type, weight)
    values (v_uid, p_listing_id, 'save', coalesce(p_weight, 1))
    on conflict do nothing;
    return;
  end if;

  insert into public.listing_user_signals (user_id, listing_id, signal_type, weight)
  values (v_uid, p_listing_id, p_signal_type, coalesce(p_weight, 1));
end;
$$;

revoke all on function public.record_listing_signal(uuid, text, numeric) from public;
grant execute on function public.record_listing_signal(uuid, text, numeric) to authenticated;

create or replace function public.recommend_listings_for_user(
  p_limit int default 12,
  p_viewer uuid default auth.uid()
)
returns table (
  listing_id uuid,
  score numeric,
  reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 12), 1), 30);
begin
  if p_viewer is null then
    return;
  end if;

  return query
  with recent_worlds as (
    select l.world_slug, max(s.created_at) as last_at
      from public.listing_user_signals s
      join public.listings l on l.listing_id = s.listing_id
     where s.user_id = p_viewer
     group by l.world_slug
     order by last_at desc
     limit 5
  ),
  candidates as (
    select l.*,
           case when rw.world_slug is not null then 0.35 else 0.1 end
             + case when l.urgency_level = 3 then 0.15 else 0 end
             + case when l.created_at > now() - interval '7 days' then 0.1 else 0 end as base_score
      from public.listings l
      left join recent_worlds rw on rw.world_slug = l.world_slug
     where l.status = 'open'
       and l.moderation_status = 'published'
       and l.world_slug <> 'romantic_matchmaking'
       and public.is_listing_visible_to(l, p_viewer)
       and l.owner_id <> p_viewer
  )
  select c.listing_id,
         c.base_score::numeric as score,
         case when rw.world_slug is not null then 'world_affinity' else 'fresh' end as reason
    from candidates c
    left join recent_worlds rw on rw.world_slug = c.world_slug
   order by score desc, c.created_at desc
   limit v_lim;
end;
$$;

revoke all on function public.recommend_listings_for_user(int, uuid) from public;
grant execute on function public.recommend_listings_for_user(int, uuid) to authenticated, service_role;

commit;
