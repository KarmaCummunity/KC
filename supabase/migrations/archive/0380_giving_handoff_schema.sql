-- 0380_giving_handoff_schema | Items/food handoff reservations + ratings.

begin;

create table public.giving_handoffs (
  handoff_id           uuid primary key default gen_random_uuid(),
  listing_id           uuid not null references public.listings(listing_id) on delete cascade,
  owner_id             uuid not null references public.users(user_id) on delete cascade,
  recipient_id         uuid not null references public.users(user_id) on delete cascade,
  world_slug           text not null check (world_slug in ('items', 'food')),
  status               text not null default 'reserved'
    check (status in ('reserved','confirmed','handed_over','cancelled','no_show')),
  pickup_mode          text not null default 'pickup'
    check (pickup_mode in ('pickup','delivery')),
  pickup_window_start  timestamptz,
  pickup_window_end    timestamptz,
  confirm_by           timestamptz,
  reserved_at          timestamptz not null default now(),
  confirmed_at         timestamptz,
  handed_over_at       timestamptz,
  cancelled_at         timestamptz,
  no_show_at           timestamptz,
  constraint giving_handoffs_distinct_users check (owner_id <> recipient_id)
);

create unique index giving_handoffs_active_listing_uidx
  on public.giving_handoffs (listing_id)
  where status in ('reserved', 'confirmed');

create index giving_handoffs_recipient_idx on public.giving_handoffs (recipient_id, reserved_at desc);
create index giving_handoffs_owner_idx on public.giving_handoffs (owner_id, reserved_at desc);

create table public.giving_handoff_ratings (
  rating_id    uuid primary key default gen_random_uuid(),
  handoff_id   uuid not null references public.giving_handoffs(handoff_id) on delete cascade,
  rater_id     uuid not null references public.users(user_id) on delete cascade,
  ratee_id     uuid not null references public.users(user_id) on delete cascade,
  rating       smallint not null check (rating between 1 and 5),
  comment      text,
  created_at   timestamptz not null default now(),
  constraint giving_handoff_ratings_once unique (handoff_id, rater_id)
);

create index giving_handoff_ratings_handoff_idx on public.giving_handoff_ratings (handoff_id);
create index giving_handoff_ratings_rater_idx on public.giving_handoff_ratings (rater_id);
create index giving_handoff_ratings_ratee_idx on public.giving_handoff_ratings (ratee_id);

alter table public.giving_handoffs enable row level security;
alter table public.giving_handoff_ratings enable row level security;

create policy giving_handoffs_participant_read on public.giving_handoffs
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or recipient_id = (select auth.uid())
  );

create policy giving_handoff_ratings_participant_read on public.giving_handoff_ratings
  for select to authenticated
  using (
    exists (
      select 1 from public.giving_handoffs h
       where h.handoff_id = giving_handoff_ratings.handoff_id
         and (
           h.owner_id = (select auth.uid())
           or h.recipient_id = (select auth.uid())
         )
    )
  );

commit;
