-- 0261_match_alerts | Issue #830
-- match_alert_subscriptions + outbox triggers for matches and saved searches.

begin;

create table public.match_alert_subscriptions (
  subscription_id uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(user_id) on delete cascade,
  world_slug      text references public.worlds(slug) on delete cascade,
  direction       text check (direction is null or direction in ('give','request')),
  city_id         text references public.cities(city_id),
  saved_query     text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index match_alert_subscriptions_active_idx
  on public.match_alert_subscriptions (user_id, world_slug)
  where is_active;

create trigger match_alert_subscriptions_set_updated_at
  before update on public.match_alert_subscriptions
  for each row execute function public.set_updated_at();

alter table public.match_alert_subscriptions enable row level security;

create policy match_alert_subscriptions_own on public.match_alert_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.listing_matches_enqueue_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_a uuid;
  v_owner_b uuid;
  v_world text;
begin
  if new.status <> 'suggested' then
    return new;
  end if;

  select la.owner_id, lb.owner_id, la.world_slug
    into v_owner_a, v_owner_b, v_world
    from public.listings la, public.listings lb
   where la.listing_id = new.listing_id
     and lb.listing_id = new.candidate_listing_id;

  perform public.enqueue_notification(
    v_owner_a, 'social', 'listing_match_found',
    'notifications.listingMatchTitle', 'notifications.listingMatchBody',
    jsonb_build_object('score', new.score, 'world', v_world),
    jsonb_build_object('listing_id', new.listing_id, 'candidate_listing_id', new.candidate_listing_id),
    'listing_match:' || new.match_id::text || ':a', false
  );

  perform public.enqueue_notification(
    v_owner_b, 'social', 'listing_match_found',
    'notifications.listingMatchTitle', 'notifications.listingMatchBody',
    jsonb_build_object('score', new.score, 'world', v_world),
    jsonb_build_object('listing_id', new.candidate_listing_id, 'candidate_listing_id', new.listing_id),
    'listing_match:' || new.match_id::text || ':b', false
  );

  return new;
end;
$$;

drop trigger if exists listing_matches_enqueue_notification on public.listing_matches;
create trigger listing_matches_enqueue_notification
  after insert on public.listing_matches
  for each row execute function public.listing_matches_enqueue_notification();

create or replace function public.listings_match_subscription_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub record;
begin
  if new.moderation_status <> 'published' or new.status <> 'open' then
    return new;
  end if;
  if new.world_slug = 'romantic_matchmaking' then
    return new;
  end if;

  for v_sub in
    select s.*
      from public.match_alert_subscriptions s
     where s.is_active
       and s.user_id <> new.owner_id
       and (s.world_slug is null or s.world_slug = new.world_slug)
       and (s.direction is null or s.direction = new.direction)
       and (s.city_id is null or s.city_id = new.city_id)
       and (
         s.saved_query is null
         or new.search_vector @@ plainto_tsquery('simple', s.saved_query)
         or extensions.similarity(new.title, s.saved_query) > 0.25
       )
  loop
    perform public.enqueue_notification(
      v_sub.user_id, 'social', 'listing_subscription_hit',
      'notifications.listingSubscriptionTitle', 'notifications.listingSubscriptionBody',
      jsonb_build_object('title', new.title, 'world', new.world_slug),
      jsonb_build_object('listing_id', new.listing_id, 'subscription_id', v_sub.subscription_id),
      'listing_sub:' || v_sub.subscription_id::text || ':' || new.listing_id::text,
      false
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists listings_match_subscription_notify on public.listings;
create trigger listings_match_subscription_notify
  after insert on public.listings
  for each row execute function public.listings_match_subscription_notify();

commit;
