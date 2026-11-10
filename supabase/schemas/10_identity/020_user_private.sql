-- Identity · user_private (owner-only data)
--
-- Personal details and preferences that only the member may read. Kept out of `users` so
-- that no policy mistake on the public profile can ever expose them.

create table public.user_private (
  user_id                     uuid primary key references public.users (id) on delete cascade,
  -- Contact number shown to a counterparty only through a dedicated RPC.
  contact_phone               text check (char_length(btrim(contact_phone)) between 1 and 20),
  -- Used for age-restricted worlds; written once through an RPC, never directly.
  date_of_birth               date,
  -- Default pickup address, prefilled into new posts. Both parts or neither.
  profile_street              text check (char_length(profile_street) between 1 and 80),
  profile_street_number       text check (profile_street_number ~ '^[0-9]+[A-Za-zא-ת]?$'),
  -- Per-category push settings and quiet hours.
  notification_preferences    jsonb not null default '{}'::jsonb
                                check (jsonb_typeof(notification_preferences) = 'object'),
  -- Whether other members see the "active recently" indicator.
  show_active_status          boolean not null default true,
  -- One-time explainer and nudge dismissals.
  closure_explainer_dismissed boolean not null default false,
  first_post_nudge_dismissed  boolean not null default false,
  -- The member chose to fill in basic details later.
  basic_info_skipped          boolean not null default false,
  updated_at                  timestamptz not null default now(),
  constraint user_private_address_pair_chk
    check ((profile_street is null) = (profile_street_number is null))
);
comment on table public.user_private is 'Personal details and preferences readable only by their owner.';

create trigger user_private_set_updated_at
  before update on public.user_private
  for each row execute function kc_private.set_updated_at();

alter table public.user_private enable row level security;
alter table public.user_private force row level security;

create policy user_private_select_self on public.user_private
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_private_update_self on public.user_private
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select on public.user_private to authenticated;
-- date_of_birth is excluded: it is set through an RPC that validates it and forbids changes.
grant update (
  contact_phone, profile_street, profile_street_number, notification_preferences,
  show_active_status, closure_explainer_dismissed, first_post_nudge_dismissed, basic_info_skipped
) on public.user_private to authenticated;
