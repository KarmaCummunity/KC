-- FR-AUTH-010 / FR-AUTH-007 — persist "Skip" on onboarding step 1 so AuthGate
-- can land returning users on the feed (soft gate still enforces FR-AUTH-015).

alter table public.users
  add column if not exists basic_info_skipped boolean not null default false;

comment on column public.users.basic_info_skipped is
  'True when the user tapped Skip on onboarding step 1; cold-start routes to feed while onboarding_state may stay pending_basic_info for FR-AUTH-015.';

-- One-time relief for accounts that already engaged but still had pending_basic_info
-- (legacy skip path before this column existed).
update public.users
set basic_info_skipped = true
where onboarding_state = 'pending_basic_info'
  and basic_info_skipped = false
  and (
    active_posts_count_internal > 0
    or items_given_count > 0
    or items_received_count > 0
  );
