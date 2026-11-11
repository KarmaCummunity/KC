-- Worlds · post_food_details (what a food offer must state, D21, D28)
--
-- One row per food offer: when the food itself stops being good, what it is and what it
-- contains. The expiry drives the post — it closes by itself at that time and its urgency
-- follows from how close that is. A food request has no row and never expires (D21). The
-- generic claim flow (public.claim_food_giving) hands the food over.

create table public.post_food_details (
  post_id           uuid primary key references public.posts (id) on delete cascade,
  -- Until when the food is good to eat, as stated by the giver.
  expires_at        timestamptz not null,
  food_type         text check (food_type in ('cooked', 'packaged', 'fresh', 'frozen', 'dry', 'beverage')),
  -- Declared allergens; an empty list is the giver's statement that there are none (D28).
  allergens         text[] not null default '{}' check (coalesce(array_length(allergens, 1), 0) <= 20),
  -- Null = not stated.
  kosher            boolean,
  dietary_tags      text[] not null default '{}' check (coalesce(array_length(dietary_tags, 1), 0) <= 20),
  -- When the owner was told the offer is about to expire (S4); set by the sweep.
  expiry_alerted_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.post_food_details is
  'Expiry, type and declared contents of a food offer; the expiry closes the post and sets its urgency.';

-- Expiry alert sweep and urgency refresh: offers nearing their expiry, soonest first.
create index post_food_details_expiry_idx on public.post_food_details (expires_at);

-- Urgency of a food offer from its expiry: high inside 72 hours, medium otherwise.
create function kc_private.food_urgency_level(p_expires_at timestamptz)
returns smallint
language sql
stable
set search_path = ''
as $$
  select case when p_expires_at <= now() + interval '72 hours' then 3 else 2 end::smallint;
$$;
comment on function kc_private.food_urgency_level(timestamptz) is
  'Urgency level of a food offer: 3 when it expires within 72 hours, else 2.';

-- Rules of a food offer on every write:
--   post     a food offer (post_details_mismatch)
--   expiry   stated (food_expiry_required) and, when new or changed, in the future
--            (food_expiry_in_past); a moved expiry may be alerted again
--   post     expires with the food; urgency derived from the expiry
create function kc_private.post_food_details_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post constant public.posts := kc_private.post_for_details(new.post_id, 'standard');
begin
  if v_post.world_slug <> 'food' or v_post.direction <> 'offer' then
    raise exception 'post_details_mismatch' using errcode = 'P0001';
  end if;
  if new.expires_at is null then
    raise exception 'food_expiry_required' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' or new.expires_at <> old.expires_at then
    if new.expires_at <= now() then
      raise exception 'food_expiry_in_past' using errcode = 'P0001';
    end if;
    new.expiry_alerted_at := null;
  end if;
  update public.posts p
     set expires_at = new.expires_at, urgency_level = kc_private.food_urgency_level(new.expires_at)
   where p.id = new.post_id;
  return new;
end;
$$;
comment on function kc_private.post_food_details_prepare() is
  'BEFORE INSERT OR UPDATE on post_food_details: food offer, stated future expiry, post expiry and urgency.';

create trigger post_food_details_prepare
  before insert or update on public.post_food_details
  for each row execute function kc_private.post_food_details_prepare();

create trigger post_food_details_set_updated_at
  before update on public.post_food_details
  for each row execute function kc_private.set_updated_at();

alter table public.post_food_details enable row level security;
alter table public.post_food_details force row level security;

-- Visible exactly when the post is.
create policy post_food_details_select_visible on public.post_food_details
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_food_details.post_id));

-- The giver edits the details while the post's content is editable.
create policy post_food_details_update_owner on public.post_food_details
  for update to authenticated
  using (exists (select 1 from public.posts p
                  where p.id = post_food_details.post_id and p.owner_id = (select auth.uid())
                    and p.status in ('draft', 'open', 'paused')))
  with check (exists (select 1 from public.posts p
                       where p.id = post_food_details.post_id and p.owner_id = (select auth.uid())));

-- The alert stamp is the sweep's own bookkeeping and is not readable.
grant select (post_id, expires_at, food_type, allergens, kosher, dietary_tags, created_at, updated_at)
  on public.post_food_details to authenticated;
grant update (expires_at, food_type, allergens, kosher, dietary_tags) on public.post_food_details to authenticated;
