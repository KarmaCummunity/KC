-- 0390: extend giving_handoffs for rides + knowledge (multi-seat / slots).

begin;

alter table public.giving_handoffs
  drop constraint if exists giving_handoffs_world_slug_check;

alter table public.giving_handoffs
  add constraint giving_handoffs_world_slug_check
  check (world_slug in ('items', 'food', 'rides', 'knowledge'));

-- Allow multiple active handoffs per listing for rides/knowledge (seats/slots).
drop index if exists public.giving_handoffs_active_listing_uidx;
create unique index giving_handoffs_active_listing_uidx
  on public.giving_handoffs (listing_id)
  where status in ('reserved', 'confirmed')
    and world_slug in ('items', 'food');

create unique index giving_handoffs_active_listing_recipient_uidx
  on public.giving_handoffs (listing_id, recipient_id)
  where status in ('reserved', 'confirmed')
    and world_slug in ('rides', 'knowledge');

alter table public.giving_handoffs
  add column if not exists seats int not null default 1
    check (seats >= 1 and seats <= 8);

alter table public.giving_handoffs
  add column if not exists slot_starts_at timestamptz;

alter table public.giving_handoffs
  add column if not exists slot_ends_at timestamptz;

commit;
