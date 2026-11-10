// PostgREST column list for non-PII reads on public.users (migration 0163 / TD-163).
// Keep in sync with users_public (0163 + 0650 verification_level) and column grants on public.users.

/** Columns granted to anon/authenticated SELECT on public.users. */
export const USER_PUBLIC_SELECT_COLUMNS =
  'user_id, auth_provider, share_handle, display_name, city, city_name, biography, avatar_url, privacy_mode, privacy_changed_at, account_status, onboarding_state, closure_explainer_dismissed, first_post_nudge_dismissed, items_given_count, items_received_count, followers_count, following_count, created_at, updated_at, preferred_language, verification_level' as const;

/** Embed shape for follow_edges → users joins (no PII). */
export const USER_PUBLIC_EMBED = `(${USER_PUBLIC_SELECT_COLUMNS})` as const;
