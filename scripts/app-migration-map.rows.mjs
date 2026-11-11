// Authored rows of the application migration map (rendered by scripts/app-migration-map.mjs).
//
// One row per database object the code addresses today:
//   status      same     same name and call shape: nothing to change
//               renamed  new name or argument names, same meaning: mechanical change
//               changed  the caller's logic changes (see the note)
//               removed  no replacement by design; the note says what the feature does instead
//               missing  the baseline has no equivalent although the code needs one (`m` = MISSING id)
//   to          `rpc:<fn>` / `table:<name>` in the baseline (checked against the generated
//               types), or `topic:` / `bucket:` / `edge:` / `client:` / `sql:` for the rest
//   confidence  high = read in the baseline source; medium = inferred from names and types
//
// Conventions that hold for every row and are not repeated in the notes: primary keys are
// named `id` (was `<entity>_id`); a listing is a post (`p_listing_id` → `p_post_id`); every
// handoff RPC returns the `post_handoffs` row.

export const rows = [];
const add = (kind) => (old, status, to, note, extra = {}) =>
  rows.push({ kind, old, status, to: [to].flat().filter(Boolean), note, confidence: extra.c ?? 'high', missing: extra.m });
const rpc = add('rpc');
const table = add('table');
const bucket = add('bucket');
const channel = add('channel');
const changes = add('postgres_changes');
const edge = add('edge_function');
const M = 'medium';

// ───────────────────────────── identity: auth, users, legal, blocks, social
rpc('auth_check_account_gate', 'changed', 'rpc:bootstrap_session', 'Gate is `account.status` / `status_until` of the session payload; no per-user argument and no `allowed` flag: the app derives it from the status.');
rpc('rpc_restore_account', 'renamed', 'rpc:restore_account', 'Same call.');
rpc('rpc_set_date_of_birth', 'renamed', 'rpc:set_date_of_birth', '`p_date_of_birth` → `p_date`. Editable under the 18+ rule (design §12.1), no longer write-once.');
rpc('rpc_set_onboarding_state', 'renamed', 'rpc:set_onboarding_state', 'Same argument; moves are checked by the onboarding machine.');
rpc('rpc_dev_reset_onboarding', 'removed', null, 'Dev-only helper; not carried over (design §8). Reset a test member from the dev seed scripts.');
rpc('rpc_get_show_active_status', 'changed', 'table:user_private', 'Read `show_active_status` of the caller\'s own row (policy `user_private_select_self`), or take it from `bootstrap_session().private_profile`.');
rpc('rpc_set_show_active_status', 'changed', 'table:user_private', 'Direct update of `show_active_status` (column grant, policy `user_private_update_self`).');
rpc('users_merge_notification_preferences', 'changed', 'table:user_private', 'Direct update of `notification_preferences`; the merge of the patch into the stored JSON moves to the adapter (read, merge, write).', { c: M });
rpc('users_get_self_private_fields', 'changed', 'rpc:bootstrap_session', 'The private fields are `private_profile` of the session payload; a later refresh reads `user_private` directly.');
rpc('get_chat_counterparty_contact', 'renamed', 'rpc:chat_counterpart_contact', 'Same argument (`p_chat_id`), returns the phone as text, null when the caller cannot use the chat, it is a support thread, the counterpart is inactive or has no phone (M06, built).');
table('users', 'changed', ['table:users', 'table:user_private', 'table:user_account', 'table:user_stats'],
  'Split in four. Public profile stays in `users` (`user_id` → `id`, `city` → `city_id`, `city_name` gone: join `cities`). Contact phone, date of birth, address lines, notification preferences, dismiss flags, `basic_info_skipped` → `user_private` (own row). Account status, onboarding state, deletion dates, verification → `user_account` (read-only; moves through RPCs). Counters → `user_stats` (read-only). `is_super_admin` → `get_my_admin_roles()`. Client updates on `users` are limited to display_name, biography, avatar_url, city_id, preferred_language; `privacy_mode` moves through `set_privacy_mode`. mock-login\'s upsert goes away with the function.');
table('users_public', 'changed', 'table:users', 'The view is gone: `users` itself now holds only public profile columns and RLS hides blocked and reported members. Owner fields of a post already come inside `post_card`.');
table('follow_edges', 'changed', ['table:follows', 'rpc:follow_user'], 'Renamed to `follows` (`follower_id`, `followed_id`). Select and delete stay direct; the insert becomes `follow_user(p_target)`, which returns `following` or `requested` (private profile).');
table('follow_requests', 'changed', ['table:follow_requests', 'rpc:follow_user', 'rpc:follow_request_decide', 'rpc:follow_request_cancel'], 'Read-only for clients. Insert → `follow_user`; accept / reject → `follow_request_decide(p_requester, p_accept)`; cancel → `follow_request_cancel(p_target)`. Status column is ruled by the follow_request machine.');
table('blocks', 'same', 'table:blocks', 'Same columns, same direct select / insert / delete.');
rpc('list_my_blocked_users', 'missing', null, 'A blocker can read their `blocks` rows but not the blocked member\'s name or avatar (restrictive policy `users_hide_blocked`).', { m: 'M01' });
rpc('accept_legal_document', 'same', 'rpc:accept_legal_document', '`p_doc_type` is text (was an enum), `p_locale` / `p_user_agent` optional.');
rpc('needs_legal_reacknowledgement', 'changed', 'rpc:bootstrap_session', 'The pending documents are `legal.documents` of the session payload, same fields (`doc_type`, `current_version`, `last_material_version`, `last_accepted_version`, `block_mode`, …).');
table('legal_documents', 'same', 'table:legal_documents', 'Readable signed-out too (the only anon grant in the baseline).');
table('legal_document_versions', 'same', 'table:legal_document_versions', '`created_at` is gone (`published_at` stays).');
rpc('rpc_follow_suggestions', 'missing', null, 'No suggestion query in the baseline.', { m: 'M03' });
rpc('rpc_profile_completeness', 'missing', null, 'No completeness function in the baseline.', { m: 'M04' });
table('cities', 'changed', 'table:cities', '`lat` / `lon` / `geo` → one `location` geography column; the picker should use `search_places` instead of loading the table.');
table('streets', 'changed', 'table:streets', '`geo` → `location`.');
table('about_team_profiles', 'missing', null, 'View not carried over; staff grants are not readable by members.', { m: 'M08' });
table('app_flags', 'same', 'table:app_flags', 'Same `select key, enabled`, for signed-in members only (no `anon` grant): before sign-in the compiled defaults apply. After sign-in the same map is `bootstrap_session().flags`. The rows (`world_<slug>_enabled`) are seed data, not part of the baseline (M09, verified).');

// ───────────────────────────── posts, feed, search
rpc('feed_ranked_ids', 'changed', 'rpc:feed_page', 'One call returns cards, not ids to hydrate: filters move into `p_filters` (sort, world, direction, item_subcategory_ids, status, audience, city_id + radius_km, near_city_id, q), the four cursor arguments become the opaque `next_cursor` JSON, `distance_km` → `distance_m`.');
rpc('profile_closed_posts', 'changed', 'rpc:profile_posts_page', '`p_tab = \'closed\'`, keyset `p_cursor`, returns cards. `identity_role` is not returned: the card carries `owner_identity_masked` and null owner fields instead (M02, built).');
rpc('profile_closed_posts_count', 'changed', 'rpc:profile_closed_posts_count', 'One argument, `p_user_id` (the viewer is the caller); counts the closed tab only, so the Hidden tab badge (`p_list_mode = owner_only_me`) is not served: take it from `user_stats.open_posts_only_me` or drop it (M13, built as a count over the same rows as the tab).');
rpc('active_posts_count_for_viewer', 'changed', 'table:user_stats', 'Read `open_posts_public` (+ `open_posts_followers_only` for a follower) of the profile\'s `user_stats` row; the viewer-dependent sum moves to the adapter.', { c: M });
rpc('profile_open_challenge_post_ids', 'changed', 'rpc:profile_posts_page', 'A challenge is a post (`post_type = \'challenge\'`), so the open tab already contains it; the merge step goes away.', { c: M });
rpc('owner_complete_offer_with_user', 'changed', ['rpc:close_post_with_recipient', 'rpc:close_post_without_recipient'], 'Split by `p_mode`: with a recipient → `close_post_with_recipient(p_post_id, p_recipient_id)` (returns the handoff); without → `close_post_without_recipient`.');
rpc('close_post_with_recipient', 'changed', 'rpc:close_post_with_recipient', '`p_recipient_user_id` → `p_recipient_id`; returns the handoff row, not the post. The recipient must have a chat with the owner (`closure_recipient_not_in_chat`).');
rpc('reopen_post_marked', 'renamed', 'rpc:reopen_post', 'One RPC for both closed states; returns void (re-read the post).');
rpc('reopen_post_deleted_no_recipient', 'renamed', 'rpc:reopen_post', 'Same RPC as above; `reopen_window_expired` after the grace period.');
rpc('rpc_recipient_unmark_self', 'renamed', 'rpc:recipient_unmark_self', 'Same call.');
rpc('rpc_republish_post', 'removed', null, 'An expired post is never reopened: republish creates a new post from the old one\'s fields (D127). The app copies the fields into the create flow.');
rpc('admin_remove_post', 'same', 'rpc:admin_remove_post', 'Status becomes `removed_admin`; the previous status is kept in `status_before_removal`.');
rpc('rpc_get_post_engagement_stats', 'changed', 'table:post_stats', 'Direct read of `post_stats` (`reactions_count`, `comments_count`, `shares_count`); the same counters are inside every `post_card`.');
rpc('rpc_set_post_reaction', 'changed', 'rpc:set_post_reaction', 'Returns the reaction type now held (text, null when removed) instead of the row.');
rpc('rpc_create_post_comment', 'changed', 'table:post_comments', 'Direct insert (columns id, post_id, author_id, parent_comment_id, body) with `.select()`; mentions and rate limiting are applied by triggers.', { c: M });
rpc('rpc_set_post_comment_like', 'changed', 'table:post_comment_reactions', 'Direct insert / delete of the caller\'s row.');
rpc('upsert_post_actor_identity', 'same', 'rpc:upsert_post_actor_identity', 'Same three arguments plus an optional `p_identity_visibility`; errors are P0001 codes (`not_participant`, `followers_only_requires_public_profile`). The owner of a delivered post also moves `posts.visibility` (M02, built).');
table('post_actor_identity', 'changed', 'table:post_actor_identity', 'A member reads only their own row. The projection `projectActorIdentityForViewer` is no longer run on the device: the server masks the owner in `post_card` and the author in `post_comments_page` (M02, built).');
table('posts', 'changed', ['table:posts', 'rpc:post_cards', 'rpc:post_detail', 'rpc:create_post_with_details', 'rpc:delete_post'],
  'Columns: `post_id` → `id`, `type` → `direction`, `category` / `category_id` → `item_subcategory_id`, `city` → `city_id`, `urgency` → `urgency_level`, `street` / `street_number` → `post_private_locations`, `availability_status` / `moderation_status` / `feed_hidden` → `status`, `status_before_admin_removal` → `status_before_removal`; `delete_after` / `reopen_count` → `post_closures`; `estimated_value`, `item_condition`, `external_body_id`, listing columns: gone. Reads of lists should use the card RPCs (`post_cards`, `feed_page`, `profile_posts_page`, `post_detail`). Insert is direct (column grants; status `draft` or `open`), rides / stays / events / food go through `create_post_with_details`. Update is direct for content columns only; status never (owner RPCs). Delete: direct only for a draft, otherwise `delete_post`.');
table('media_assets', 'changed', 'table:post_media', 'Renamed; `path` → `storage_bucket` + `storage_key`, plus kind / ordinal / dimensions. Direct insert and delete by the owner; no update (replace = delete + insert).');
table('saved_posts', 'same', 'table:saved_posts', 'Same columns. The upsert becomes insert-ignore-duplicate (no update grant). The saved-posts page hydrates ids with `post_cards`.');
table('post_comments', 'changed', ['table:post_comments', 'rpc:post_comments_page', 'rpc:delete_post_comment'], '`comment_id` → `id`. Lists should use `post_comments_page` (keyset, author fields and viewer reaction included). Delete → `delete_post_comment`.');
table('post_comment_reactions', 'same', 'table:post_comment_reactions', 'Same shape.');
table('post_reactions', 'same', 'table:post_reactions', '`reaction_id` is gone (key is post + user).');
rpc('rpc_feed_hide_post', 'changed', 'table:feed_hides', 'Direct insert of (user_id, post_id); unhide = delete.');
rpc('rpc_feed_log_impressions', 'changed', 'table:feed_impressions', 'Direct bulk insert of `post_id` rows (the only granted column; user and time are filled by the table).', { c: M });
rpc('rpc_feed_list_mute_filters', 'changed', 'table:feed_mute_filters', 'Direct select; `filter_value` is split by kind into `muted_user_id`, `world_slug`, `keyword`.');
rpc('rpc_feed_add_mute_filter', 'changed', 'table:feed_mute_filters', 'Direct insert with the column that matches `filter_kind`.');
rpc('rpc_feed_remove_mute_filter', 'changed', 'table:feed_mute_filters', 'Direct delete by `id`.');
rpc('search_posts_page', 'changed', 'rpc:search_posts_page', 'Returns cards with `next_cursor` (was ids); category / city / type move into `p_filters` (same keys as `feed_page`).');
rpc('search_users_page', 'changed', 'rpc:search_users_page', 'Returns the member fields with `viewer_follows` and `next_cursor` (was ids); city / min followers / sort arguments are gone (order: most followed).');
rpc('search_all', 'changed', 'rpc:search_all', '`p_types` is gone: the preview always holds posts and members; donation links are searched from `donation_links` directly.');
rpc('rpc_search_suggested_queries', 'missing', null, 'No suggested-queries source in the baseline.', { m: 'M05' });

// ───────────────────────────── chat
rpc('rpc_chat_mark_read', 'renamed', 'rpc:mark_chat_read', 'Same argument. Read state is `chat_members.last_read_at`, not a per-message status.');
rpc('rpc_chat_unread_total', 'renamed', 'rpc:chat_unread_total', 'Also delivered in `bootstrap_session().unread.chats`.');
rpc('rpc_unread_counts_for_chats', 'renamed', 'rpc:chat_unread_counts', '`p_viewer_id` is gone (the caller). `chat_inbox_page` already returns `unread_count` per chat.');
rpc('rpc_chat_hide_for_viewer', 'renamed', 'rpc:hide_chat', 'Same argument; a support thread cannot be hidden (`support_thread_not_hideable`).');
rpc('rpc_chat_set_anchor', 'changed', 'rpc:open_direct_chat', 'No separate anchor RPC: `open_direct_chat(p_user_id, p_anchor_post_id)` returns the existing chat and re-pins it.');
rpc('rpc_chat_set_anchor_ride', 'changed', 'rpc:open_direct_chat', 'A ride is a post: same call as the post anchor.');
rpc('rpc_get_or_create_support_thread', 'renamed', 'rpc:open_support_thread', 'Returns the `chats` row in its new shape (`kind = \'support\'`, `support_user_id`).');
rpc('rpc_submit_support_issue', 'changed', ['rpc:open_support_thread', 'rpc:send_message'], 'Two calls: open the thread, then send the issue as a message (the category goes into the body; there is no category column).', { c: M });
rpc('rpc_send_chat_media_message', 'renamed', 'rpc:send_message', '`send_message(p_chat_id, p_body, p_media_payload, p_message_id)`; pass a client id for idempotent retries.');
rpc('rpc_set_message_reaction', 'changed', 'rpc:set_message_reaction', 'Returns void (was the reaction row); the change arrives as a `reaction` broadcast on the chat topic.');
table('chats', 'changed', ['table:chats', 'rpc:chat_inbox_page', 'rpc:open_direct_chat'], '`participant_a/b` → `direct_user_a/b` + `chat_members`; `is_support_thread` → `kind`; `inbox_hidden_at_a/b` → `chat_members.hidden_at`; `anchor_listing_id` / `anchor_ride_id` → `anchor_post_id`. Read-only for clients: the inbox is `chat_inbox_page` (counterpart, preview, unread in one call), creation is `open_direct_chat`.');
table('messages', 'changed', ['table:messages', 'rpc:chat_messages_page', 'rpc:send_message'], '`message_id` → `id`; `status` / `delivered_at` / `read_at` are gone (read receipt = the other member\'s `last_read_at`, returned by `chat_inbox_page` and broadcast as `read`). Read-only for clients: page with `chat_messages_page`, send with `send_message`.');
table('message_reactions', 'same', 'table:message_reactions', '`reaction_id` is gone.');

// ───────────────────────────── giving worlds: generic handoffs, marketplace
for (const [name, note] of [
  ['reserve_item_giving', '`p_listing_id` → `p_post_id`.'],
  ['claim_food_giving', '`p_listing_id` → `p_post_id`.'],
  ['confirm_item_handoff', 'Same argument.'],
  ['mark_giving_handed_over', 'Same argument.'],
  ['register_for_event', '`p_target` → `p_post_id`.'],
  ['decide_event_registration', 'Same arguments.'],
  ['cancel_event_registration', 'Same argument.'],
  ['mark_event_attendance', 'Same arguments; allowed once the event started (`event_not_started`).'],
  ['book_knowledge_seat', 'Same argument.'],
  ['book_ride_seat', '`p_listing_id` → `p_post_id`.'],
  ['confirm_ride_booking', 'Same argument.'],
  ['cancel_ride_booking', 'Same argument; a driver cancelling a waiting booking declines it.'],
  ['reinstate_ride_booking', 'Same argument.'],
  ['complete_ride_trip', 'Same argument.'],
  ['request_housing_booking', '`p_listing_id` → `p_post_id`.'],
  ['decide_housing_booking', 'Same arguments.'],
  ['cancel_housing_booking', 'Same arguments.'],
]) rpc(name, 'renamed', `rpc:${name}`, `${note} Returned row: \`handoff_id\` → \`id\`, \`listing_id\` → \`post_id\`, \`reserved_at\` → \`created_at\`, \`knowledge_slot_id\` → \`slot_starts_at\` / \`slot_ends_at\`, new \`machine_id\`.`);
rpc('cancel_giving_handoff', 'renamed', 'rpc:cancel_giving_handoff', 'Same argument; now returns the handoff row (was void).');
rpc('rate_giving_handoff', 'changed', 'rpc:rate_handoff', 'One rating RPC for every world: `p_rating` → `p_stars`, returns void, once per handoff (`handoff_already_rated`).');
rpc('get_listing_handoff', 'changed', 'table:post_handoffs', 'Direct read of the caller\'s handoff of the post (policy `post_handoffs_select_party`).', { c: M });
rpc('list_my_giving_handoffs', 'changed', 'table:post_handoffs', 'Direct read of the caller\'s handoffs (owner or recipient) joined to `posts` for the title; role = which of the two ids is the caller.', { c: M });
rpc('list_event_registrations', 'changed', ['table:post_handoffs', 'table:users'], 'The organizer reads the post\'s handoffs directly and the members\' names from `users`.', { c: M });
table('post_handoffs', 'changed', 'table:post_handoffs', 'Read-only for both parties. `handoff_id` → `id`, `reserved_at` → `created_at`, `world_slug` gone (join the post), `knowledge_slot_id` → slot times, new `machine_id`.');
rpc('pause_my_listing', 'renamed', 'rpc:pause_post', '`p_listing_id` → `p_post_id`; refused while a handoff is live (`listing_has_active_handoff`).');
rpc('resume_my_listing', 'renamed', 'rpc:resume_post', '`p_listing_id` → `p_post_id`.');
rpc('delete_my_listing', 'changed', 'rpc:delete_post', 'Allowed in any status (design §12.1): live handoffs are cancelled and their members notified; the post is purged after the grace period and can be reopened until then.');
rpc('fulfill_my_listing', 'changed', 'rpc:close_post_without_recipient', 'Closing without naming a recipient; refused while a handoff is live.', { c: M });
rpc('update_my_listing', 'changed', 'table:posts', 'Direct update of the content columns (title, description, details, city_id, urgency_level, visibility, time_window, item_subcategory_id, location_display_level). `p_summary` → `description`; `p_availability_status` and `p_max_radius_km` have no column.');
rpc('add_my_listing_media', 'changed', 'table:post_media', 'Direct insert of one row per uploaded file (storage_bucket, storage_key, ordinal, …).');
rpc('create_marketplace_listing', 'changed', ['table:posts', 'rpc:create_post_with_details', 'table:post_media', 'table:post_private_locations'], 'Items, animals, knowledge: insert into `posts`, then `post_media` rows. Rides, stays, events, food: `create_post_with_details(p_post, p_details)`. `p_summary` → description, `p_category_id` → item_subcategory_id, exact address → `post_private_locations`, `p_external_body_id` → `beneficiary_org_id`; additional worlds and `availability_status` are gone.');
rpc('get_marketplace_listing_detail', 'changed', 'rpc:post_detail', 'One JSON: card, media gallery, first page of comments; world details come from the detail tables (`post_ride_details`, …).');
rpc('browse_listings', 'changed', 'rpc:feed_page', '`p_filters.world` selects the world feed; offset / four-part cursor → `next_cursor`; lat / lng → `near_city_id` + `radius_km`; returns cards.');
rpc('marketplace_search', 'changed', 'rpc:search_posts_page', 'Text search over posts, cards with `next_cursor`; the rank components are not returned.');
rpc('list_my_listings', 'changed', 'rpc:profile_posts_page', 'The caller\'s own id with `p_tab` open / closed / hidden; keyset cursor (offset is gone).');
rpc('list_profile_listings', 'changed', 'rpc:profile_posts_page', 'Same page function, as cards.');
rpc('recommend_listings_for_user', 'changed', 'rpc:recommended_posts', 'Cards; no `reason` / `score`.');
rpc('similar_listings', 'renamed', 'rpc:similar_posts', '`p_listing_id` → `p_post_id`; returns cards.');
rpc('map_listing_clusters', 'changed', 'rpc:map_post_clusters', 'Bounds travel as one jsonb `{west, south, east, north}` and the zoom is an argument; filters (`world`, `direction`, `item_subcategory_ids`) in `p_filters`. Returns `lat, lng, post_count, single_post_id` (M10, built).');
rpc('map_listing_pins', 'changed', 'rpc:map_post_pins', 'Bounds as one jsonb, filters in `p_filters`, at most 200 pins of `post_id, lat, lng, world_slug, direction`; hydrate with `post_cards` (M10, built).');
rpc('search_external_bodies', 'changed', 'table:organizations', 'External bodies are organizations (FR-ORG-001): search `organizations` by name (policy `organizations_select_active`).', { c: M });
rpc('record_listing_signal', 'removed', null, '`listing_user_signals` is not carried over (design §8); ranking uses saves, reactions and `feed_impressions`.');
rpc('share_listing_to_feed', 'removed', null, 'A listing is a post and is already in the feed (`listing_feed_posts` not carried over). A share is a `post_shares` row.');
rpc('start_listing_chat', 'changed', ['rpc:open_direct_chat', 'rpc:send_message'], '`open_direct_chat(owner, p_anchor_post_id)` then `send_message` for the opening text.');
table('listings', 'changed', ['table:posts', 'rpc:post_cards'], 'The view is gone (design §8): read `posts`, or cards through `post_cards`.');
table('listing_kinds', 'renamed', 'table:post_kinds', 'Same role; `direction` and `detail_schema` are on the kind.');
table('categories', 'renamed', 'table:item_subcategories', 'Item subcategories per world (`world_slug`, `parent_id`).');
table('org_memberships', 'changed', 'table:org_memberships', '`role` → `roles` (array), `membership_id` gone (key is org + user), new `can_post`.');

// ───────────────────────────── rides
rpc('create_ride_series', 'changed', 'rpc:create_ride_series', 'Post fields go in `p_post`, ride fields in `p_ride` (was flat title / summary / details / kind); returns the series id only.');
rpc('update_ride_series', 'same', 'rpc:update_ride_series', 'Signature unchanged.');
rpc('set_ride_series_status', 'same', 'rpc:set_ride_series_status', 'Signature unchanged.');
rpc('complete_ride_listing', 'renamed', 'rpc:complete_ride', '`p_listing_id` → `p_post_id`; returns the number of bookings completed.');
rpc('decline_ride_booking', 'changed', 'rpc:cancel_ride_booking', 'No separate decline: the driver cancelling a waiting booking declines it.');
rpc('list_ride_bookings', 'changed', ['table:post_handoffs', 'table:users'], 'The driver reads the ride\'s handoffs and the passengers\' names directly. `rated_by_me` is a select on `post_ratings` by the caller as rater (M07, built).', { c: M });
rpc('list_rides_feed', 'changed', 'rpc:rides_feed', 'Keyset `p_cursor`; `listing_id` → `post_id`, labels → `origin_name` / `dest_name`, `meeting_points` is the JSON list, `passengers` is not returned.');
rpc('ride_listings_search', 'changed', 'rpc:rides_feed', 'Search is the feed with `p_filters` (direction, departure window, route origin / destination).', { c: M });
rpc('ride_listings_find_matches', 'changed', 'rpc:rides_feed', 'Route filter of `rides_feed`; saved routes get alerts through `ride_route_alerts`.', { c: M });
rpc('find_ride_listing_matches', 'changed', 'rpc:rides_feed', 'Same as above (mobile composition calls it directly today).', { c: M });
rpc('list_ride_places', 'changed', 'rpc:search_places', 'Server-side place search (cities and road junctions) instead of loading the whole list (design §12.1).');
rpc('list_ride_series_occurrences', 'changed', 'table:post_ride_details', 'Occurrences are the posts whose `post_ride_details.series_id` is the series: direct read, soonest first. Seats left per occurrence come from `rides_feed`.', { c: M });
rpc('set_ride_house_numbers', 'changed', 'table:post_private_locations', 'Owner writes `street_number` (origin) and `destination_street_number` directly.');
rpc('get_ride_house_numbers', 'changed', 'rpc:get_post_private_location', 'Owner, or the member of a confirmed booking (each release is audited).');
rpc('ride_listing_emergency', 'renamed', 'rpc:report_post_emergency', '`p_listing_id` → `p_post_id`; returns the emergency id; throttled (`emergency_throttled`).');
rpc('rpc_ride_emergency_trigger', 'renamed', 'rpc:report_post_emergency', '`p_ride_id` → `p_post_id`; returns the emergency id.');
rpc('rpc_ride_rate', 'changed', 'rpc:rate_handoff', 'Rating is per handoff (booking), not per ride + ratee; `p_is_penalty` is gone.');
rpc('rpc_ride_start', 'removed', null, 'Legacy ride lifecycle; not carried over (design §9). A ride completes through `complete_ride` / `complete_ride_trip`.');
rpc('rpc_ride_arrive', 'removed', null, 'Legacy ride lifecycle; not carried over (design §9).');
rpc('rpc_ride_update_visibility', 'changed', 'table:posts', 'Direct update of `posts.visibility`.');
rpc('rpc_ride_participants_request', 'changed', 'rpc:book_ride_seat', 'Legacy participants are bookings (`post_handoffs`).');
rpc('rpc_ride_participants_decide', 'changed', ['rpc:confirm_ride_booking', 'rpc:cancel_ride_booking'], 'Approve → confirm; reject → cancel.');
rpc('rpc_ride_participants_cancel', 'changed', 'rpc:cancel_ride_booking', 'Same RPC for both sides.');
table('ride_listings', 'changed', ['table:posts', 'table:post_ride_details', 'rpc:create_post_with_details', 'rpc:rides_feed'], 'The view is gone: a ride is a post (`post_type = \'ride\'`) with a `post_ride_details` row. Create with `create_post_with_details`; edit both tables directly; close with the post RPCs.');
table('ride_participants', 'changed', 'table:post_handoffs', 'Dropped: bookings are `post_handoffs` rows (machine `ride_booking`).');
table('ride_stops', 'changed', 'table:post_ride_details', 'Dropped: stops are the `meeting_points` JSON of the ride details.');
table('ride_templates', 'changed', 'table:ride_series', 'Dropped: recurring rides are `ride_series` (create / update / status RPCs; read-only table).');
table('ride_series', 'changed', 'table:ride_series', '`series_id` → `id`; title / summary / details / direction / kind → `post_template` and `ride_template` JSON.');
table('ride_saved_routes', 'changed', 'table:ride_saved_routes', '`route_id` → `id`; label / lat / lng / place columns → official place ids (`*_city_id`, `*_street_id`, `*_junction_id`) with a derived point.');
table('ride_emergency_events', 'changed', 'table:post_emergencies', 'A participant reads id, post_id, reporter_id, created_at only; note and location are for the safety team.');
table('ride_ratings', 'changed', 'table:post_ratings', 'Ratings are `post_ratings` per handoff: the rater reads back only the rows they wrote; nobody reads a rating about themselves (M07, built).');
table('user_ride_rating_summary', 'changed', 'table:user_stats', 'Columns `ratings_count` and `ratings_avg` (average only from three ratings), readable with the profile. Spec conflict recorded in the handback: D24 says members never see ratings (M07, built).');
table('driver_declarations', 'changed', ['table:user_consents', 'rpc:accept_world_consent'], 'Read `user_consents` where `consent_kind = \'driver_declaration\'`; accept with `accept_world_consent(\'driver_declaration\', version)`. The current version is `bootstrap_session().consents.<kind>.version`, with the caller\'s `accepted` flag (M11, built).');

// ───────────────────────────── housing, knowledge, volunteering
rpc('accept_housing_conduct', 'changed', 'rpc:accept_world_consent', '`accept_world_consent(\'housing_conduct\', p_version)`; rejects a stale version (`consent_version_stale`).');
rpc('housing_conduct_version', 'changed', 'rpc:bootstrap_session', 'Read `consents.housing_conduct.version` (and `accepted`) from the session payload (M11, built).');
table('housing_conduct_acceptances', 'changed', 'table:user_consents', 'Read `user_consents` where `consent_kind = \'housing_conduct\'`.');
rpc('complete_housing_booking', 'changed', 'rpc:close_housing_booking', '`close_housing_booking(p_handoff_id, \'completed\')`; inside its time window only (`housing_not_in_window`).', { c: M });
rpc('mark_housing_no_show', 'changed', 'rpc:close_housing_booking', '`close_housing_booking(p_handoff_id, \'no_show\')`.', { c: M });
rpc('list_housing_bookings', 'changed', ['table:post_handoffs', 'table:handoff_booking_details', 'table:users'], 'The host reads the handoffs of the post with their booking details and the guests\' names. Guest reputation fields (`guest_completed_stays`, `rated_by_me`) are not derivable: `rated_by_me` is a select on `post_ratings`, the reputation count is `user_stats.ratings_count` (M07, built).', { c: M });
rpc('list_my_housing_stays', 'changed', ['table:post_handoffs', 'table:handoff_booking_details'], 'The guest reads their handoffs with booking details, joined to `posts` and `users`; `can_view_address` = status confirmed (then call `get_post_private_location`).', { c: M });
rpc('get_housing_private_details', 'changed', 'rpc:get_post_private_location', 'Returns the `post_private_locations` row: street, street_number, exact_point, `access_notes`.');
rpc('set_housing_private_details', 'changed', 'table:post_private_locations', 'Owner insert / update. Apartment, floor, entrance notes and access instructions fold into `access_notes`; `p_street_id` → `street` text; lat / lng → `exact_point`.', { c: M });
rpc('list_knowledge_slots', 'changed', 'table:post_knowledge_slots', 'Direct read of the slots; the caller\'s booking per slot comes from their `post_handoffs` rows (match on `slot_starts_at`); `seats_left` is not returned.', { c: M });
rpc('list_knowledge_bookings', 'changed', ['table:post_handoffs', 'table:users'], 'The giver reads the post\'s handoffs and the learners\' names directly.', { c: M });
rpc('confirm_knowledge_booking', 'changed', 'rpc:confirm_item_handoff', 'Knowledge uses the generic machine: confirm with the generic RPC.');
rpc('decline_knowledge_booking', 'changed', 'rpc:cancel_giving_handoff', 'Decline = the owner cancelling a waiting handoff.');
rpc('complete_knowledge_session', 'changed', 'rpc:mark_giving_handed_over', 'Complete = handed over.');
for (const name of ['resolve_knowledge_topics', 'propose_knowledge_topic', 'update_my_proposed_knowledge_topic', 'review_knowledge_topic']) {
  rpc(name, 'missing', null, 'No topic graph in the baseline.', { m: 'M12' });
}
table('knowledge_topics', 'missing', null, 'No topic graph in the baseline (design §8 names `topics`, not built).', { m: 'M12' });
table('knowledge_topic_follows', 'missing', null, 'No topic follows in the baseline.', { m: 'M12' });
rpc('list_volunteer_opportunities', 'changed', 'rpc:feed_page', 'Volunteering is event posts (design Q3, G18): the world feed of events, as cards. One post per shift.', { c: M });
rpc('get_volunteer_opportunity_detail', 'changed', 'rpc:post_detail', 'Post detail plus the `post_event_details` row (starts_at, ends_at, capacity, registration_policy).', { c: M });
rpc('sign_up_volunteer_shift', 'changed', 'rpc:register_for_event', '`p_shift_id` → `p_post_id`; the status says confirmed, waiting for approval, or waiting list.');
rpc('cancel_volunteer_signup', 'changed', 'rpc:cancel_event_registration', '`p_signup_id` → `p_handoff_id`.');
rpc('list_my_volunteer_signups', 'changed', 'table:post_handoffs', 'The caller\'s handoffs on event posts, joined to `post_event_details`; hours are in `user_stats.volunteer_hours_total`.', { c: M });
rpc('check_in_volunteer_shift', 'changed', 'rpc:mark_event_attendance', 'Attendance is recorded by the organizer, not by the volunteer\'s own check-in.', { c: M });
rpc('get_volunteer_shift_ics', 'removed', null, 'Not carried over; the calendar file is built on the device from the event\'s start and end.', { c: M });
rpc('close_volunteer_opportunity', 'changed', 'rpc:close_post_without_recipient', 'The organizer closes (or pauses / deletes) the event post.', { c: M });
rpc('list_my_volunteer_opportunities', 'changed', 'rpc:profile_posts_page', 'The organizer\'s own posts; filter the event posts on the device.', { c: M });
rpc('list_shift_volunteers', 'changed', ['table:post_handoffs', 'table:users'], 'The organizer reads the event\'s handoffs and the members\' names; waiting-list order = `created_at`.', { c: M });
rpc('organizer_message_shift_volunteers', 'renamed', 'rpc:message_event_registrants', '`p_shift_id` → `p_post_id`, `p_message` → `p_body`.');

// ───────────────────────────── challenges, matching, karma, stats, surveys
rpc('create_challenge', 'same', 'rpc:create_challenge', 'New optional `p_city_id` (required for a community challenge: `city_required`).');
for (const name of ['end_challenge', 'leave_challenge', 'report_challenge_progress']) rpc(name, 'same', `rpc:${name}`, 'Signature unchanged.');
rpc('join_challenge', 'changed', 'rpc:join_challenge', '`p_show_on_profile` is gone.');
rpc('get_challenge', 'changed', 'rpc:get_challenge', 'Returns the `challenge_summary` composite (re-map the fields).', { c: M });
rpc('list_challenges', 'changed', 'rpc:list_challenges', 'Offset → keyset `p_cursor`; each row is `{ challenge, next_cursor }`.');
rpc('list_challenge_leaderboard', 'same', 'rpc:list_challenge_leaderboard', 'Adds `avatar_url`.');
rpc('list_my_challenge_entries', 'changed', 'table:challenge_progress_entries', 'Direct read of the caller\'s own entries (policy `challenge_progress_entries_select_own`).');
rpc('rpc_my_matches', 'changed', 'rpc:my_matches', '`candidate_id` → `match_id`; the other side comes as a `post_card` (`other_post`); `components` is not returned.');
rpc('rpc_match_respond', 'changed', 'rpc:match_respond', '`p_candidate_id` → `p_match_id`, `p_response` text → `p_accept` boolean; returns the pair\'s status.');
rpc('rpc_match_refresh_mine', 'removed', null, 'Matching runs from the outbox when a post is published or changed; there is no on-demand refresh.', { c: M });
rpc('admin_match_quality', 'missing', null, 'No match quality report.', { m: 'M14' });
table('karma_ledger', 'changed', 'table:karma_ledger', '`ledger_id` → `id`, `points_delta` → `points`, `ref_type` / `ref_id` → `subject` / `reference`. The total is `my_karma_points()`.');
rpc('rpc_my_activity_timeline', 'renamed', 'rpc:my_activity_timeline', 'Adds `actor_id`.');
rpc('rpc_record_active_day', 'renamed', 'rpc:record_active_day', 'Same call.');
rpc('my_world_givings', 'missing', null, 'No per-world giving totals of a member.', { m: 'M15' });
rpc('admin_world_flow_funnel', 'missing', null, 'No platform funnel report.', { m: 'M14' });
table('community_stats', 'changed', 'rpc:community_stats', 'The view becomes an RPC returning registered_users, open_public_posts, delivered_posts, refreshed_at.');
rpc('check_survey_prompt_eligibility', 'same', 'rpc:check_survey_prompt_eligibility', 'Signature unchanged.');
rpc('upsert_survey_answers', 'same', 'rpc:upsert_survey_answers', 'Signature unchanged.');
rpc('list_active_surveys', 'changed', 'table:surveys', 'Direct read of active surveys (policy `surveys_select_published`).', { c: M });
rpc('get_survey_bundle', 'changed', ['table:surveys', 'table:survey_questions', 'table:survey_answers'], 'Survey, the questions of its current version (`survey_versions` → `survey_questions`) and the caller\'s answers: three direct reads.', { c: M });
table('user_feedback', 'missing', null, 'No free-feedback table.', { m: 'M16' });
for (const name of ['admin_survey_overview', 'admin_survey_results', 'admin_pmf_survey_report']) {
  rpc(name, 'missing', null, 'No survey statistics function; raw answers are readable by the super admin only.', { m: 'M17' });
}
rpc('admin_user_feedback_list', 'missing', null, 'Depends on the free-feedback table.', { m: 'M16' });
rpc('get_public_research_questions', 'changed', 'rpc:get_public_research_questions', 'Same signature, but service role only in the baseline (nothing is granted to signed-out callers): the public research page must load its questions through the `public-research-submit` function, not from the device.');

// ───────────────────────────── moderation, reports, admin
rpc('get_my_admin_roles', 'same', 'rpc:get_my_admin_roles', 'Signature unchanged.');
for (const name of ['admin_confirm_report', 'admin_dismiss_report', 'admin_grant_role', 'admin_revoke_role', 'admin_change_role']) {
  rpc(name, 'same', `rpc:${name}`, 'Signature unchanged.');
}
rpc('admin_ban_user', 'renamed', 'rpc:admin_ban_user', '`p_target_user_id` → `p_user_id`; `p_note` optional; the reason must be one of the sanction reasons.');
rpc('admin_restore_post', 'same', 'rpc:admin_restore_post', 'Staff: returns a removed post to its previous status, a post hidden for review to open.');
rpc('admin_restore_user', 'same', 'rpc:admin_restore_user', 'Staff: lifts a suspension; only the super admin lifts a ban.');
rpc('admin_delete_message', 'same', 'rpc:admin_delete_message', 'Same name and argument (`p_message_id`); it lives in `40_messaging/070_chat_moderation.sql` and is audited by the moderation module (M18, verified).');
rpc('admin_audit_search', 'changed', 'rpc:admin_audit_search', 'Offset → keyset (`p_before_occurred_at`, `p_before_id`); `p_target_user_id` → `p_target_id`; no display names and no `total_count` (join `users` on the device).');
table('reports', 'same', 'table:reports', 'Direct insert of (reporter_id, target_type, target_id, reason, note); `report_id` → `id`.');
rpc('admin_set_manager', 'changed', 'rpc:admin_set_manager', '`p_manager_grant_id` is required: a grant can be moved under another grant but not detached.');
rpc('admin_org_tree', 'changed', 'table:admin_role_grants', 'Build the tree on the device from the grants (`manager_grant_id`, `scope_org_id`).', { c: M });
rpc('admin_hierarchy_census', 'changed', 'table:admin_role_grants', 'Counts per level and role computed on the device from the same grants read.', { c: M });
rpc('admin_org_application_list', 'changed', 'table:org_applications', 'Direct read (policy `org_applications_select_reviewers`).');
rpc('admin_org_application_approve', 'changed', 'rpc:admin_org_application_approve', 'New required `p_slug`; returns the organization id.');
rpc('admin_org_application_reject', 'same', 'rpc:admin_org_application_reject', 'Signature unchanged.');
for (const name of ['admin_task_list', 'admin_task_detail', 'admin_task_create', 'admin_task_update', 'admin_task_set_status', 'admin_task_assign', 'admin_task_add_comment', 'admin_task_delete']) {
  rpc(name, 'missing', null, 'No internal task tracker in the baseline.', { m: 'M19' });
}
for (const name of ['crm_contact_list', 'crm_contact_upsert', 'crm_contact_delete', 'crm_contact_mark_contacted']) {
  rpc(name, 'missing', null, 'No CRM in the baseline.', { m: 'M19' });
}
for (const name of ['timesheet_list', 'timesheet_upsert', 'timesheet_submit', 'timesheet_approve', 'timesheet_reject', 'timesheet_delete']) {
  rpc(name, 'missing', null, 'No timesheets in the baseline.', { m: 'M19' });
}
table('user_account', 'same', 'table:user_account', 'Staff read the account row of every member (`user_account_select_staff`): status, sanction state.');
table('admin_role_grants', 'changed', 'table:admin_role_grants', '`grant_id` → `id`; read-only for clients. mock-login\'s insert goes away with the function.');

// ───────────────────────────── organizations, donations, payments, finance
table('donation_links', 'changed', 'table:donation_links', 'Clients select and delete only; insert and update are done by the `validate-donation-link` function with the service role. `tags`, `hidden_at`, `hidden_by` are gone (hiding = `review_status`).');
rpc('admin_list_donation_links_for_review', 'changed', ['table:donation_links', 'table:users'], 'A moderator reads pending links directly (policy `donation_links_select`) and the submitters\' names from `users`.');
rpc('admin_review_donation_link', 'same', 'rpc:admin_review_donation_link', 'Signature unchanged.');
rpc('report_donation_link', 'same', 'rpc:report_donation_link', 'Signature unchanged.');
rpc('create_donation_intent', 'changed', 'rpc:create_donation_intent', '`p_amount_ils` → `p_amount_agorot` (integer agorot); `p_listing_id` → `p_post_id`; returns JSON (intent and checkout).');
rpc('create_standing_order', 'changed', 'rpc:create_standing_order', '`p_amount_ils` → `p_amount_agorot`; returns JSON.');
for (const name of ['pause_standing_order', 'resume_standing_order', 'cancel_standing_order']) {
  rpc(name, 'changed', `rpc:${name}`, 'Same argument; returns the order as JSON with `amount_agorot`.');
}
rpc('list_my_standing_orders', 'changed', 'rpc:list_my_standing_orders', 'No `p_limit`; rows are JSON with `amount_agorot`.');
rpc('list_my_donation_history', 'changed', 'rpc:list_my_donation_history', 'Keyset (`p_after_paid_at`, `p_after_id`); `amount_ils` → `amount_agorot`, plus refunded_agorot, status, `receipt_serial`, `sec46_eligible`.');
rpc('get_donation_receipt', 'same', 'rpc:get_donation_receipt', 'Signature unchanged; amounts in the JSON are agorot.', { c: M });
rpc('get_nonprofit_public_page', 'same', 'rpc:get_nonprofit_public_page', 'Signature unchanged; totals in agorot.', { c: M });
rpc('list_verified_nonprofits', 'changed', 'rpc:list_verified_nonprofits', 'Keyset (`p_after_name`, `p_after_id`); `org_id` → `id`; `verification_level` replaces `is_verified_nonprofit`.');
rpc('complete_sandbox_donation', 'removed', null, 'Sandbox shortcut; not carried over. A donation settles only through the provider event (`provider_webhook_apply`).');
rpc('list_kc_support_channels', 'missing', null, 'No support-channel list in the baseline.', { m: 'M20' });
rpc('rpc_org_transparency', 'same', 'rpc:rpc_org_transparency', 'Signature unchanged; totals only, in agorot.', { c: M });
rpc('finance_transparency_settings_get', 'changed', 'table:organizations', 'The switches are the `show_*` columns of the organization row.');
rpc('finance_transparency_settings_set', 'changed', 'rpc:finance_transparency_settings_set', 'New required `p_org_id`; returns void.');
rpc('finance_accounts_list', 'changed', 'rpc:finance_accounts_list', 'New required `p_org_id`; `*_cents` → `*_agorot`; `account_id` → `id`; no `entry_count`.');
rpc('finance_account_upsert', 'changed', 'rpc:finance_account_upsert', 'New required `p_org_id`; `p_opening_balance_cents` → `_agorot`; `p_sort_order` is gone.');
rpc('finance_ledger_list', 'changed', 'rpc:finance_ledger_list', 'New required `p_org_id`; offset → keyset (`p_after_occurred_at`, `p_after_id`); `amount_cents` → `amount_agorot`; `p_kind` filter and `reference_url` are gone.');
rpc('finance_ledger_upsert', 'changed', 'rpc:finance_ledger_upsert', 'New required `p_org_id`; `p_amount_cents` → `_agorot`; `p_currency` and `p_reference_url` are gone.');
rpc('finance_ledger_delete', 'changed', 'rpc:finance_ledger_mark', 'Entries are never deleted: void with `finance_ledger_mark(p_org_id, p_entry_id, p_void_reason)`.');
rpc('finance_ledger_summary', 'missing', null, 'No ledger summary function.', { m: 'M21' });
rpc('finance_donors_summary', 'missing', null, 'No donors summary function.', { m: 'M21' });

// ───────────────────────────── translation, notifications
rpc('get_post_translations', 'same', 'rpc:get_post_translations', 'Signature unchanged.');
table('content_translations', 'changed', 'table:content_translations', 'Clients read only; the cache is written by the `translate` function with the service role. `id` is gone (key: content + field + language).');
for (const name of ['notifications_page', 'notifications_unread_count', 'notifications_mark_read', 'notifications_mark_all_read']) {
  rpc(name, 'same', `rpc:${name}`, 'Already moved to the baseline contract.');
}
table('user_devices', 'same', 'table:user_devices', 'Already moved to the baseline contract.');

// ───────────────────────────── WhatsApp bot and dev helpers
for (const name of [
  'api_whatsapp_my_link_status', 'api_whatsapp_create_link_code', 'api_whatsapp_unlink_me',
  'api_whatsapp_admin_get_channel', 'api_whatsapp_admin_set_channel_enabled', 'api_whatsapp_admin_overview',
  'api_whatsapp_admin_list_consent', 'api_whatsapp_admin_list_outbound', 'api_whatsapp_admin_list_rate_hits',
  'api_whatsapp_admin_list_recent_matches', 'api_whatsapp_admin_list_conversations', 'api_whatsapp_admin_resend',
  'api_whatsapp_admin_block_user', 'api_whatsapp_llm_budget_take', 'api_whatsapp_queue_reply',
  'api_whatsapp_outbound_claim', 'api_whatsapp_outbound_result', 'api_whatsapp_claim_inbound',
  'api_whatsapp_release_inbound', 'api_whatsapp_inbound_allowed', 'api_whatsapp_ingest_inbound',
  'api_whatsapp_handle_keyword', 'api_whatsapp_redeem_link_code', 'api_whatsapp_bot_access',
  'api_bot_search_listings', 'api_bot_listing_cards', 'api_bot_open_session', 'api_bot_apply_extraction',
  'api_bot_publish_listing', 'api_bot_my_listings', 'api_bot_my_matches', 'api_bot_find_matches',
]) rpc(name, 'missing', null, 'The `integrations` schema is reserved but empty: the WhatsApp module lands later as one additive migration (design Q4).', { m: 'M22' });
table('whatsapp_channel_config', 'missing', null, 'Same: no `integrations` tables yet.', { m: 'M22' });
rpc('dev_mock_identity_verification_allowed', 'removed', null, 'Dev-only; not carried over. Verify test members from the dev seed scripts.');
rpc('dev_grant_mock_identity_verification', 'removed', null, 'Dev-only; not carried over.');

// ───────────────────────────── Edge Function workers (service role)
rpc('embedding_jobs_claim', 'renamed', 'rpc:embedding_jobs_claim', 'Returned `listing_id` → `post_id`.');
rpc('embedding_job_store', 'same', 'rpc:embedding_job_store', 'Signature unchanged.');
rpc('embedding_job_fail', 'same', 'rpc:embedding_job_fail', 'Signature unchanged.');
rpc('api_match_llm_pending', 'same', 'rpc:api_match_llm_pending', 'Signature unchanged.');
rpc('api_match_llm_store', 'changed', 'rpc:api_match_llm_store', 'Returns void (was boolean): an unknown pair raises `match_not_found`.');
rpc('provider_webhook_apply', 'same', 'rpc:provider_webhook_apply', 'Signature unchanged; errors are stable snake_case messages.');
rpc('api_revenuecat_set_pro', 'same', 'rpc:api_revenuecat_set_pro', 'Signature unchanged.');
rpc('submit_public_research_response', 'same', 'rpc:submit_public_research_response', 'Signature unchanged.');
rpc('rpc_request_account_deletion', 'renamed', 'rpc:request_account_deletion', 'Returns the purge date. It is granted to members, so the app can call it directly and the `delete-account` function is no longer needed.');
table('research_secrets', 'changed', ['rpc:get_research_salt', 'rpc:rotate_research_salt'], 'The table is private: read the salt with `get_research_salt()`, rotate with `rotate_research_salt()` (service role).');
table('payments', 'removed', null, 'Lives in the `billing` schema, not exposed. `receipts-issuer` is obsolete: the receipt is issued in the transaction that settles the payment (`kc_private.billing_receipt_issue`).');
table('donation_receipts', 'removed', null, 'Same: `billing.receipts`, written by the database.');
table('standing_orders', 'changed', 'rpc:api_standing_orders_charge_due', 'Lives in `billing`: the charger calls `api_standing_orders_charge_due(p_limit)`, which opens the due charges and returns them (amounts in agorot).');

// ───────────────────────────── storage buckets
bucket('post-images', 'same', 'bucket:post-images', 'Declared by the baseline (own-folder insert / delete policies); `post_media.storage_bucket` points at it.');
bucket('listing-images', 'changed', 'bucket:post-images', 'A listing is a post: its images move to `post-images` and get `post_media` rows.', { c: M });
bucket('avatars', 'same', 'bucket:avatars', 'Declared in `95_platform/090_storage.sql`: public, JPEG, 512 KB, `<user_id>/avatar.jpg` (and the thumb in the same folder) (M23, verified).');
bucket('chat-media', 'same', 'bucket:chat-media', 'Declared in `95_platform/090_storage.sql`: private, `<user_id>/<chat_id>/<file>`, read through signed URLs by chat members (M23, verified).');
bucket('<bucket>', 'changed', 'bucket:post-images', '`backfill-image-thumbs` loops over a bucket list passed at run time; after the cut-over the list is `post-images` (plus `avatars` and `chat-media`).', { c: M });

// ───────────────────────────── realtime
channel('`chat:${chatId}:messages`', 'changed', 'topic:chat:<chat id>:messages', 'Same private topic; events are `message`, `read`, `reaction`, `chat_updated` broadcasts from triggers.', { c: M });
channel('`chat:${chatId}:typing`', 'same', 'topic:chat:<chat id>:typing', 'Members may send on `chat:%:typing` and `chat:%:presence`.');
channel('chatTopic = `chat-row:${chatId}:${uniqueTopicSuffix()}`', 'changed', 'topic:chat:<chat id>:messages', 'No row subscription: `chat_updated` arrives on the chat topic.');
channel('inboxTopic = `inbox:${userId}:${uniqueTopicSuffix()}`', 'changed', 'topic:user:<user id>:chats', 'Private topic of the member; event `chat_updated`.');
channel('topic = `user:${userId}:notifications`', 'same', 'topic:user:<user id>:notifications', 'Already on the baseline contract (event `badge`).');
channel('topic = `me:${userId}:${Date.now()}`', 'changed', 'topic:user:<user_id>:account', 'Private topic `user:<id>:account`, event `account_changed` with `status`, `status_until`, `onboarding_state`; re-read `bootstrap_session` on it (M24, built for the account gate).');
channel('FEED_PUBLIC_TOPIC = \'feed:public\'', 'missing', null, 'No broadcast of new public posts.', { m: 'M24' });
channel('ONLINE_PRESENCE_TOPIC = \'presence:online\'', 'missing', null, 'No policy for a global presence topic.', { m: 'M24' });
channel('uniqueTopic(\'rides:public-feed\')', 'missing', null, 'No ride topics.', { m: 'M24' });
channel('uniqueTopic(`rides:participants:user:${userId}`)', 'missing', null, 'No ride topics.', { m: 'M24' });
channel('uniqueTopic(`rides:participants:ride:${rideId}`)', 'missing', null, 'No ride topics.', { m: 'M24' });
channel('topic = `community-stats-watch:${suffix}`', 'removed', null, 'The counters are an RPC (`community_stats()`); refresh on focus or on a timer.');
channel('topic', 'same', 'client:openExactTopicChannel', 'The shared helper itself: unchanged, it opens whatever private topic it is given.');
changes('chats', 'changed', 'topic:user:<user id>:chats', 'Publication tables are gone (design §8): `chat_updated` broadcasts replace both subscriptions.');
changes('users', 'changed', 'topic:user:<user_id>:account', 'Replaced by the account topic; no postgres_changes publication exists (M24, built for the account gate).');
changes('ride_listings', 'missing', null, 'No ride topics.', { m: 'M24' });
changes('ride_participants', 'missing', null, 'No ride topics.', { m: 'M24' });
changes('community_stats', 'removed', null, 'See the community-stats topic: poll the RPC.');

// ───────────────────────────── Edge Function invokes from the app
edge('delete-account', 'changed', 'rpc:request_account_deletion', 'Call the RPC directly; the function is obsolete (see the Edge Functions table).');
edge('public-research-submit', 'same', 'edge:public-research-submit', 'Same invoke; the function keeps calling `submit_public_research_response`.');
edge('translate', 'same', 'edge:translate', 'Same invoke.');
edge('validate-donation-link', 'same', 'edge:validate-donation-link', 'Same invoke; the function writes `donation_links` with the service role.');

// ═════════════════════════════ MISSING: what the baseline does not provide
// action: build (add to the baseline) · rls-read (already possible, no new object) · drop · defer (behind a flag)
export const missing = [
  { id: 'M01', title: 'Blocked users list', usedBy: 'Settings → Privacy → blocked users screen (SupabaseBlockRepository.listMyBlockedUsers)', spec: 'FR-MOD-004 (unblock) deferred post-MVP; FR-SETTINGS-005 deprecated', launch: 'no', tier: 'later', action: 'defer', recommendation: 'Spec defers unblock to post-MVP: hide the blocked-users row at launch (blocking itself works). Later: a small definer function in `15_social_graph`: the caller\'s blocks with display name and avatar. Without it nobody can see whom they blocked, because `users_hide_blocked` hides those profiles. Until then hide the screen.' },
  { id: 'M03', title: 'Follow suggestions', usedBy: 'Search / explore "people to follow" (SupabaseFollowSuggestionsRepository)', spec: 'not in docs/spec/requirements', launch: 'no', tier: 'later', action: 'defer', recommendation: 'Hide behind a flag; `search_users_page` with an empty query already lists the most followed members.' },
  { id: 'M04', title: 'Profile completeness', usedBy: 'Profile completeness hint (SupabaseFollowSuggestionsRepository.getProfileCompleteness)', spec: 'not in docs/spec/requirements', launch: 'no', tier: 'later', action: 'rls-read', recommendation: 'Compute on the device from the caller\'s own `users` and `user_private` rows (both readable by their owner).' },
  { id: 'M05', title: 'Suggested search queries', usedBy: 'Search screen extras (SupabaseSearchRepository)', spec: 'not in spec; FR-FEED recent searches are local storage', launch: 'no', tier: 'later', action: 'drop', recommendation: 'Remove the server call; keep the local recent searches.' },
  { id: 'M08', title: 'About page team list', usedBy: 'Settings → About → team (SupabaseAboutRepository)', spec: 'FR-SETTINGS About refresh (no FR for a team table)', launch: 'no', tier: 'later', action: 'drop', recommendation: 'Ship the team as static content of the app, or defer the section; no database object.' },
  { id: 'M12', title: 'Knowledge topic graph (topics, aliases, follows, proposals, review)', usedBy: 'Knowledge world topic picker, follow, proposal and admin review (SupabaseKnowledgeTopicRepository)', spec: 'FR-KNOW-001, FR-KNOW-002', launch: 'no (knowledge is a portal at launch)', action: 'defer', recommendation: 'Keep the knowledge world behind `world_knowledge_enabled`. When it opens: design §8 maps `knowledge_topics` → `topics`, `topic_aliases`, `topic_follows`, but no module creates them. Add them to `70_worlds` (knowledge), or launch knowledge with item subcategories only and defer.' },
  { id: 'M14', title: 'Admin analytics: world flow funnel, match quality', usedBy: 'Admin statistics screens (SupabaseStatsRepository.getWorldFlowFunnel, SupabaseMatchRepository.qualityByWorld)', spec: 'FR-STATS-007, FR-ADMIN-029', launch: 'no', action: 'defer', recommendation: 'Staff-only reports: hide behind a flag at launch and build later in `79_activity_stats` / `76_matching`.' },
  { id: 'M15', title: 'My givings by world', usedBy: 'Personal statistics screen (SupabaseStatsRepository.listMyWorldGivings)', spec: 'FR-STATS-008', launch: 'no (personal statistics are not in the launch core)', action: 'defer', recommendation: 'Hide the per-world block of the statistics screen behind a flag. Later: a function in `79_activity_stats/020_activity_and_community.sql` counting the caller\'s handed-over handoffs per world as giver and as receiver.' },
  { id: 'M16', title: 'Free feedback form and its admin list', usedBy: 'Settings → feedback (SupabaseSurveyRepository), admin feedback dashboard (admin_user_feedback_list)', spec: 'FR-SETTINGS-017, FR-ADMIN-021', launch: 'no (ships with the surveys and feedback hub)', action: 'defer', recommendation: 'Hide the feedback form with the surveys hub; the insert sits inside the survey prompt check today and must fail silently. Later: table `user_feedback` in `90_research` (insert own, select super admin).' },
  { id: 'M17', title: 'Survey statistics for admins (overview, results, PMF report)', usedBy: 'Admin survey dashboard (SupabaseSurveyAdminRepository)', spec: 'FR-ADMIN-021', launch: 'no', action: 'defer', recommendation: 'Hide the admin survey dashboard behind a flag. When it opens no new object is needed at first: the super admin can read `survey_answers` (policy `survey_answers_select_super_admin`); aggregate on the device at launch volumes, and add an aggregate function to `90_research` when answers grow.' },
  { id: 'M19', title: 'Back-office tools: tasks, CRM, timesheets', usedBy: 'Admin portal (SupabaseAdminTaskRepository, SupabaseCrmContactsRepository, SupabaseTimesheetsRepository) — 18 RPCs', spec: 'tasks: FR-ADMIN-018; CRM: roadmap phase 3; timesheets: not in spec', launch: 'no', action: 'defer', recommendation: 'Internal tools, not member data: hide the three admin sections behind a flag and decide separately whether they belong in this database at all.' },
  { id: 'M20', title: 'KC support channels', usedBy: 'Donations → support KC card (SupabaseKcSupportChannelsRepository)', spec: 'FR-DONATE-010, FR-DONATE-011; launch plan A11 (only if the money world is on)', launch: 'no (money is a portal at launch)', action: 'defer', recommendation: 'The support card must render nothing when the call fails (today it throws: catch in the adapter). Later: a small reference table in `85_billing` (channel, label, url, payee phone; select for members), or ship the channels in app configuration.' },
  { id: 'M21', title: 'Organization finance summaries (ledger summary, donors summary)', usedBy: 'Org finance overview and donors screens (SupabaseFinanceLedgerRepository.summary, SupabaseFinanceDonorsRepository)', spec: 'FR-FIN-014, FR-FIN-017', launch: 'no', action: 'defer', recommendation: 'Org finance stays behind its flag. Later: two functions in `85_billing/100_org_finance_rpcs.sql` over the ledger, guarded like `finance_ledger_list`.' },
  { id: 'M22', title: 'WhatsApp bot, linking and admin console', usedBy: 'Three Edge Functions (webhook, intake worker, sender), mobile link screen, admin WhatsApp console — 32 RPCs and one table', spec: 'design Q4 (PM): not in the launch baseline', launch: 'no', action: 'defer', recommendation: 'Do not deploy the three functions; hide the link screen and the admin console behind a flag until the `integrations` module lands.' },
  { id: 'M24', title: 'Realtime topics beyond chat, notifications and the account gate', usedBy: 'New-posts banner (`feed:public`), online presence (`presence:online`), rides feed and booking updates', spec: 'not specified per topic; design §9 requires Broadcast instead of postgres_changes', launch: 'no (the account gate, the only blocker, is built)', tier: 'later', action: 'defer', recommendation: 'The account gate is built: topic `user:<id>:account`, event `account_changed` (`40_messaging/090_account_realtime.sql`). Booking updates: reuse the notification badge event. Feed banner, presence, rides feed: drop to refresh-on-focus at launch.' },
];

// ═════════════════════════════ Launch tier of a row (spec D102, docs/spec/96, docs/spec/14)
//   core    platform needed by every launch user
//   wedge   needed only by the launch worlds: items, rides, food, time (events / volunteering)
//   later   portal worlds and tools behind a flag: housing, knowledge, challenges, money and
//           org finance, WhatsApp bot, back-office tools, survey admin, analytics
const AREA_TIER = {
  '(root)': 'core', about: 'core', admin: 'core', auth: 'core', blocks: 'core', chat: 'core', cities: 'core', feed: 'core',
  legal: 'core', moderation: 'core', notifications: 'core', posts: 'core', realtime: 'core', reports: 'core', search: 'core',
  social: 'core', streets: 'core', translations: 'core', users: 'core', mobile: 'core',
  marketplace: 'wedge', rides: 'wedge', volunteering: 'wedge', matching: 'wedge', donations: 'wedge',
  housing: 'later', knowledge: 'later', challenges: 'later', payments: 'later', research: 'later', stats: 'later', survey: 'later',
  'fn:delete-account': 'core', 'fn:purge-deleted-accounts': 'core', 'fn:translate': 'core', 'fn:strip-exif': 'core',
  'fn:reconcile-storage-orphans': 'core', 'fn:backfill-image-thumbs': 'core', 'fn:mock-login': 'core',
  'fn:embed-worker': 'wedge', 'fn:match-rerank': 'wedge', 'fn:validate-donation-link': 'wedge',
};
const NAME_TIER = [
  [/^(finance_|admin_task_|crm_|timesheet_|api_whatsapp|api_bot|whatsapp_|dev_|admin_(demo|seed|wipe)_|admin_survey|admin_pmf|admin_org_|rpc_org_transparency$)/, 'later'],
  [/^(admin_hierarchy_census|admin_set_manager|admin_user_feedback_list|admin_match_quality|admin_world_flow_funnel|my_world_givings)$/, 'later'],
  [/^(list_my_blocked_users|rpc_follow_suggestions|rpc_profile_completeness|rpc_search_suggested_queries|about_team_profiles)$/, 'later'],
  [/^(community_stats|rpc_my_activity_timeline|rpc_record_active_day|app_flags|is_admin)$/, 'core'],
  [/community-stats-watch/, 'core'],
  [/^(karma_ledger|find_ride_listing_matches|listing-images)$/, 'wedge'],
  [/rides:/, 'wedge'],
];
const TIER_RANK = { core: 0, wedge: 1, later: 2 };

/** Launch tier of a map row: a name rule wins, otherwise the most launch-critical module that uses it. */
export function launchTier(row, areas) {
  const named = NAME_TIER.find(([pattern]) => pattern.test(row.old));
  if (named) return named[1];
  return areas.map((area) => AREA_TIER[area] ?? 'later').sort((a, b) => TIER_RANK[a] - TIER_RANK[b])[0];
}

// ═════════════════════════════ Work packages of the adapter phase
// In launch order: after package n the app is shippable with everything up to n on the new
// database. `select` names the map rows a package implements. `degrade` says what the app
// does when a screen of that package is reached before its adapters are migrated.
const inArea = (...areas) => (row) => row.areas.some((area) => areas.includes(area));
const tierIs = (tier) => (row) => row.launch === tier;
const both = (a, b) => (row) => a(row) && b(row);
const either = (a, b) => (row) => a(row) || b(row);
const named = (pattern) => (row) => pattern.test(row.old);
export const packages = [
  { id: 'P0', title: 'Contract switch and the degrade rule (first, alone)', launch: 'core', parallelWith: [],
    select: either(inArea('(root)', 'realtime'), named(/^app_flags$/)),
    files: ['infrastructure-supabase/src/database.types.ts (replaced by the baseline types)', 'infrastructure-supabase/src/index.ts', 'infrastructure-supabase/src/client.ts', 'infrastructure-supabase/src/rpc/**', 'infrastructure-supabase/src/lib/**', 'infrastructure-supabase/src/fsm/**', 'infrastructure-supabase/src/realtime/**', 'packages/domain/src (status lists, FSM machines, money value objects)', 'apps/mobile/src/services/featureFlagsComposition.ts', 'scripts/check-rpc-contract.mjs + allowlist'],
    work: 'Done in P0 (see docs/db/app-migration-playbook.md): `database.types.ts` is the generated baseline types and `database.legacy.types.ts` a frozen copy of the old ones, imported only by the files listed in `infrastructure-supabase/src/migrationStatus/<package>.ts` (the client factory is generic: `getSupabaseClient()` is baseline-typed, `getLegacySupabaseClient()` / `legacySupabase` are the same connection typed against the old schema). `FSM_MACHINES` equals the baseline seeds (`catalogMatchesSql.test.ts` reads `supabase/schemas`); the four machines without a baseline seed sit in `LEGACY_FSM_MACHINES` until L2, L6 and L7 move. `rpc/backendUnavailable.ts` holds `isBackendObjectMissing` and `rpc/mapRpcError.ts` the P0001 mapper and `unwrapCall`; `BackendUnavailableError` and `BackendRuleError` are domain errors. UI helpers: `apps/mobile/src/lib/backendAvailability.ts` and the `backend.*` locale keys. `src/__tests__/baselineCompatibility.test.ts` fails when an unlisted file still needs the old schema or a listed file no longer does.',
    tests: ['pnpm typecheck, pnpm test, pnpm lint from app/', 'src/fsm/__tests__/catalogMatchesSql.test.ts against supabase/schemas', 'src/__tests__/baselineCompatibility.test.ts', 'src/rpc/__tests__/degradeRule.test.ts', 'node --test scripts/*.test.mjs', 'node scripts/gen-baseline-types.mjs --check'],
    degrade: 'This package defines the rule for all others: an adapter call that hits a missing function or table throws `BackendUnavailableError`; a list screen shows its empty state, an action shows the generic "not available yet" message, a world whose `world_<slug>_enabled` flag is off never renders its entry points. No screen reads `error.message` of an unknown error.',
    risks: 'Everything depends on it and it must not change behaviour: no adapter logic changed, only its type import. CI still diffs `database.types.ts` against the old migrations until the workflow change listed in the P0 report lands.' },
  { id: 'P1', title: 'Identity: session start, profile, privacy, follow, block, legal, account deletion, devices', launch: 'core', parallelWith: [],
    select: either(inArea('auth', 'users', 'legal', 'blocks', 'social', 'cities', 'streets', 'about', 'notifications'), named(/^(rpc_record_active_day|dev_.*|avatars|topic = `user:.*notifications`)$/)),
    files: ['auth/**', 'users/** (except users/SupabaseUserRealtime.ts)', 'legal/**', 'blocks/**', 'social/**', 'cities/**', 'streets/**', 'about/**', 'notifications/**', 'survey/SupabaseUserActivityRepository.ts', 'apps/mobile: auth gate, onboarding, settings, edit profile, avatar upload, notification badge hook, devIdentityVerification (deleted)'],
    work: 'Replace the start-up calls with `bootstrap_session`; split the user mapper over `users` / `user_private` / `user_account` / `user_stats`; follows through `follow_user` and the request RPCs; account deletion through `request_account_deletion`.',
    tests: ['vitest: auth, users, legal, blocks, social, notifications suites', 'contract tests against a baseline database (sqlProbes, contract.integration)', 'pgTAP 010, 011, 020, 021, 050, 051'],
    degrade: 'Nothing works before this package (no session): it is the first one after P0. The blocked-users row, follow suggestions, the completeness hint and the About team list are hidden (M01, M03, M04, M08).',
    risks: 'Owns `users/mapUserRow.ts`, which chat, posts and search read: it lands before P2 and P3 start. Account gate: topic `user:<id>:account` (M24).' },
  { id: 'P2', title: 'Posts, feed, search, closure, translations', launch: 'core', parallelWith: ['P3', 'P4'],
    select: either(inArea('posts', 'feed', 'search', 'translations', 'stats'), named(/community[-_]stats/)),
    files: ['posts/**', 'feed/** (except feed/SupabaseFeedRealtime.ts)', 'search/**', 'translations/**', 'stats/**', 'apps/mobile: feed, post detail, create / edit post, profile tabs, saved posts, image upload, community counter, statistics screen'],
    work: 'Card-based reads (`feed_page`, `profile_posts_page`, `post_detail`, `post_cards`), keyset cursors, column renames, owner actions and closure through RPCs, `post_media`.',
    tests: ['vitest: posts, feed, search, translations suites', 'pgTAP 030, 035, 040, 041, 042, 078'],
    degrade: 'Until it lands the feed and profile tabs show their empty state and the create-post button is disabled; nothing else in the app depends on a post list. The statistics screen shows the community counters and the timeline only: its per-world block and the admin funnel are hidden (M14, M15).',
    risks: 'Largest behavioural change: cursor and card shape reach the application ports. Owns `posts/mapPostRow.ts`, read by P5. The card carries `owner_identity_masked` (M02).' },
  { id: 'P3', title: 'Chat and realtime', launch: 'core', parallelWith: ['P2', 'P4'],
    select: either(inArea('chat'), named(/^chat-media$/)),
    files: ['chat/**', 'users/SupabaseUserRealtime.ts', 'feed/SupabaseFeedRealtime.ts', 'rides/SupabaseRidesRealtime.ts', 'apps/mobile: chat screens, chat media, inbox and notification badge hooks'],
    work: 'Inbox and messages through the page RPCs, `chat_members` read markers, every `postgres_changes` subscription replaced by a private Broadcast topic or by refresh-on-focus.',
    tests: ['vitest: chat suites, realtime/exactTopicChannel tests', 'pgTAP 045, 050'],
    degrade: 'The chat tab shows an empty inbox and "contact" buttons on posts are disabled; a failed subscription is ignored (the screen refreshes on focus).',
    risks: 'Contact phone: `chat_counterpart_contact` (M06). Optimistic send must pass `p_message_id`.' },
  { id: 'P4', title: 'Reports, moderation and admin basics', launch: 'core', parallelWith: ['P2', 'P3'],
    select: either(both(inArea('moderation', 'reports', 'admin'), tierIs('core')), named(/^admin_(demo|seed|wipe)_/)),
    files: ['moderation/**', 'reports/**', 'admin/fetchMyAdminRoles.ts', 'admin/SupabaseAdminRoleRepository.ts', 'admin/SupabaseAdminContentRepository.ts', 'admin/SupabaseDemoDataRepository.ts (deleted)', 'apps/mobile: report sheet, admin portal home, reports inbox, case detail, users / posts search, roles, audit'],
    work: 'Reporting stays a direct insert; staff lists become RLS reads; role and sanction RPCs keep their names. The demo-data screen and repository are deleted here (FR-ADMIN-031).',
    tests: ['vitest: moderation, reports, admin role and content suites', 'pgTAP 060, 061'],
    degrade: 'Reporting a post or member shows "not available yet"; the admin portal entry is hidden for everyone until the package lands (staff use the dashboard of the database meanwhile).',
    risks: 'Staff deletion of a chat message is `admin_delete_message` (M18).' },
  { id: 'P5', title: 'Launch worlds: items, food, rides, time (events), matching, donation links', launch: 'wedge', parallelWith: ['P6'],
    select: either(inArea('marketplace', 'rides', 'volunteering', 'matching', 'donations'), both(inArea('mobile'), tierIs('wedge'))),
    files: ['marketplace/**', 'rides/** (except rides/SupabaseRidesRealtime.ts)', 'volunteering/**', 'matching/**', 'donations/**', 'apps/mobile: world screens, ridesKnowledgeComposition, listing image upload, karma history'],
    work: 'Listings become posts; one handoff row shape; the legacy ride tables and their repositories are deleted; volunteering maps onto event posts; matches as cards. Two agents may split it by folder (rides / the rest): no shared file.',
    tests: ['vitest: marketplace, rides, volunteering, matching, donations suites', 'pgTAP 035, 070, 072 (events, karma), 073 (food), 076, 080'],
    degrade: 'Each launch world is behind `world_<slug>_enabled`: until this package lands the four flags are off and the worlds render as portals (the generic post flow of P2 still lets members publish and close items).',
    risks: 'Depends on P2 (`post_card` mapper). Ratings (M07), map (M10) and the driver declaration version (M11) are built.' },
  { id: 'P6', title: 'Edge Functions of the launch', launch: 'core', parallelWith: ['P5'],
    select: (row) => row.areas.some((area) => area.startsWith('fn:')) && row.launch !== 'later',
    files: ['supabase/functions/{embed-worker,match-rerank,translate,validate-donation-link,purge-deleted-accounts,reconcile-storage-orphans,strip-exif,backfill-image-thumbs}', 'supabase/functions/{delete-account,mock-login} (deleted)', 'scripts/edge-functions.mjs'],
    work: 'Rewrite `purge-deleted-accounts` over a Postgres connection, retarget the service-role callers, delete the obsolete functions. The deploy workflow\'s function list is changed by the release owner, not here.',
    tests: ['deno test supabase/functions/**', 'node --test scripts/edge-functions.test.mjs', 'pgTAP 011 (account deletion), 051 (push contract), 076'],
    degrade: 'Workers fail closed: a worker that cannot reach its function logs and exits; the app is unaffected (no embedding → no matches yet; no purge → accounts stay deactivated).',
    risks: 'No file shared with the app packages. **Launch line: after P6 the app is shippable on the new database.**' },
  { id: 'L1', title: 'Housing world', launch: 'later', parallelWith: ['L2', 'L3', 'L4', 'L5', 'L6', 'L7'],
    select: inArea('housing'),
    files: ['housing/**', 'apps/mobile: housing screens'],
    work: 'Bookings on the shared handoff shape, private details through `post_private_locations`, consent through `accept_world_consent`.',
    tests: ['vitest: housing suite', 'pgTAP 071'],
    degrade: '`world_housing_enabled` off: the world is a portal and no housing adapter is called.',
    risks: 'M07 and M11 are built (shared with rides).' },
  { id: 'L2', title: 'Knowledge world', launch: 'later', parallelWith: ['L1', 'L3', 'L4', 'L5', 'L6', 'L7'],
    select: inArea('knowledge'),
    files: ['knowledge/**', 'apps/mobile: knowledge screens'],
    work: 'Slots and bookings on the generic handoff RPCs; topics wait for M12.',
    tests: ['vitest: knowledge suite', 'pgTAP 073'],
    degrade: '`world_knowledge_enabled` off: portal only. The topic picker must tolerate an empty topic list.',
    risks: 'M12 (topic graph) is not built.' },
  { id: 'L3', title: 'Challenges', launch: 'later', parallelWith: ['L1', 'L2', 'L4', 'L5', 'L6', 'L7'],
    select: inArea('challenges'),
    files: ['challenges/**', 'apps/mobile: challenge screens, useChallengeLinkedPost'],
    work: 'Mostly 1:1; keyset list and the `challenge_summary` composite.',
    tests: ['vitest: challenges suite', 'pgTAP 074'],
    degrade: 'Challenges flag off: the tab is hidden; a challenge post in the feed opens as a plain post.',
    risks: 'Low.' },
  { id: 'L4', title: 'Money: donations to organizations, standing orders, org finance, org onboarding', launch: 'later', parallelWith: ['L1', 'L2', 'L3', 'L5', 'L6', 'L7'],
    select: (row) => row.launch === 'later' && (row.areas.includes('payments') || /^(finance_|admin_org_|rpc_org_transparency|admin_hierarchy_census|admin_set_manager)/.test(row.old) || row.areas.some((a) => ['fn:payments-webhook', 'fn:revenuecat-webhook', 'fn:receipts-issuer', 'fn:subscriptions-charger'].includes(a))),
    files: ['payments/**', 'admin/SupabaseFinance*.ts', 'admin/SupabaseOrgTransparencyRepository.ts', 'admin/SupabaseOrgApplicationsRepository.ts', 'admin/SupabaseOrgHierarchyRepository.ts', 'supabase/functions/{payments-webhook,revenuecat-webhook,subscriptions-charger}', 'supabase/functions/receipts-issuer (deleted)', 'apps/mobile: donations money screens, org finance portal'],
    work: 'Agorot end to end, org-scoped finance arguments, keyset lists; charger rewritten on `api_standing_orders_charge_due`.',
    tests: ['vitest: payments and finance suites', 'pgTAP 080, 085, 086'],
    degrade: '`world_money_enabled` off: the money world is a portal of links; the support card renders nothing when its call fails (M20); the finance portal entry is hidden.',
    risks: 'M20, M21 open. Retention of billing rows is an open legal question (design Q5).' },
  { id: 'L5', title: 'Surveys, feedback, public research', launch: 'later', parallelWith: ['L1', 'L2', 'L3', 'L4', 'L6', 'L7'],
    select: (row) => row.launch === 'later' && row.areas.some((a) => ['survey', 'research', 'fn:public-research-submit', 'fn:rotate-research-salt'].includes(a)),
    files: ['survey/** (except survey/SupabaseUserActivityRepository.ts, owned by P1)', 'research/**', 'supabase/functions/{public-research-submit,rotate-research-salt}', 'apps/mobile: surveys and feedback hub, admin survey dashboard, public research page'],
    work: 'Survey reads become table reads; the public research page loads through its function; the feedback form waits for M16 and the admin dashboard for M17.',
    tests: ['vitest: survey, research, stats suites', 'pgTAP 079, 090'],
    degrade: 'Survey prompt: `check_survey_prompt_eligibility` failing means "do not prompt" (its feedback insert must not throw). The surveys and feedback hub and the admin dashboard are hidden behind a flag.',
    risks: '`record_active_day` is core and moves with P1; `stats/**` moves with P2.' },
  { id: 'L6', title: 'Back-office tools: tasks, CRM, timesheets', launch: 'later', parallelWith: ['L1', 'L2', 'L3', 'L4', 'L5', 'L7'],
    select: (row) => /^(admin_task_|crm_|timesheet_)/.test(row.old),
    files: ['admin/SupabaseAdminTaskRepository.ts', 'admin/SupabaseCrmContactsRepository.ts', 'admin/SupabaseTimesheetsRepository.ts', 'apps/mobile: admin tasks, CRM, timesheets screens'],
    work: 'Nothing to migrate to: the baseline has none of it (M19). Decide first whether these tools belong in this database.',
    tests: ['—'],
    degrade: 'The three admin sections are hidden behind a flag; their repositories are not constructed.',
    risks: 'Product decision, not engineering.' },
  { id: 'L7', title: 'WhatsApp bot, linking, admin console', launch: 'later', parallelWith: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'],
    select: (row) => /^(api_whatsapp|api_bot|whatsapp_)/.test(row.old),
    files: ['admin/SupabaseWhatsAppAdminRepository.ts', 'supabase/functions/{whatsapp-webhook,whatsapp-intake-worker,whatsapp-sender}', 'supabase/functions/_shared/whatsapp/**', 'apps/mobile: WhatsApp link screen'],
    work: 'Waits for the `integrations` module (M22, design Q4).',
    tests: ['deno test supabase/functions/_shared/whatsapp'],
    degrade: 'The three functions are not deployed; the link screen and the admin console are hidden behind a flag.',
    risks: 'None for launch.' },
];

// ═════════════════════════════ Edge Functions
// verdict: keep (no database change) · retarget (same job, renamed objects) · rewrite · obsolete · park · done
export const edgeFunctions = [
  { name: 'dispatch-notification', verdict: 'done', uses: 'kc_private.notifications_deliver_batch, notification_push_retry_batch, notification_push_settle (direct Postgres)', change: 'Already rewritten for the baseline.' },
  { name: 'embed-worker', verdict: 'retarget', uses: 'embedding_jobs_claim, embedding_job_store, embedding_job_fail', change: 'Claimed job carries `post_id` instead of `listing_id`. Design §9 asks for queue consumption; the claim RPC already wraps it.' },
  { name: 'match-rerank', verdict: 'retarget', uses: 'api_match_llm_pending, api_match_llm_store', change: '`api_match_llm_store` returns void and raises `match_not_found`.' },
  { name: 'payments-webhook', verdict: 'keep', uses: 'provider_webhook_apply', change: 'Same call; map the new stable error messages to HTTP statuses.' },
  { name: 'revenuecat-webhook', verdict: 'keep', uses: 'api_revenuecat_set_pro', change: 'None.' },
  { name: 'public-research-submit', verdict: 'retarget', uses: 'research_secrets (select), submit_public_research_response', change: 'Read the salt with `get_research_salt()`; if the public page loads its questions, proxy `get_public_research_questions` (service role only).' },
  { name: 'rotate-research-salt', verdict: 'retarget', uses: 'research_secrets (update)', change: 'Call `rotate_research_salt()`.' },
  { name: 'translate', verdict: 'keep', uses: 'content_translations (select, insert, delete)', change: 'Same table with the service role; the key is (content_type, content_id, field, target_language), no `id`.' },
  { name: 'validate-donation-link', verdict: 'retarget', uses: 'donation_links (select, insert, update), users (select)', change: '`tags`, `hidden_at`, `hidden_by` are gone; new links start in `review_status = pending`.' },
  { name: 'delete-account', verdict: 'obsolete', uses: 'rpc_request_account_deletion', change: 'The app calls `request_account_deletion()` itself; delete the function and its invoke.' },
  { name: 'purge-deleted-accounts', verdict: 'rewrite', uses: 'accounts_due_for_purge, account_purge_media_paths, delete_account_data_for', change: 'None of the three is exposed. Rewrite like `dispatch-notification`: `kc_private.accounts_due_for_purge` over Postgres, media paths from `post_media`, storage removal, then `auth.admin.deleteUser` (foreign keys cascade; billing is detached by trigger).' },
  { name: 'receipts-issuer', verdict: 'obsolete', uses: 'payments (select), donation_receipts (upsert)', change: 'Receipts are issued by the database when a payment settles (`kc_private.billing_receipt_issue`, gapless serial per organization).' },
  { name: 'subscriptions-charger', verdict: 'rewrite', uses: 'standing_orders (select)', change: 'Call `api_standing_orders_charge_due(p_limit)`, charge each returned intent at the provider, and let `provider_webhook_apply` settle it.' },
  { name: 'reconcile-storage-orphans', verdict: 'retarget', uses: 'media_assets (select), bucket post-images', change: 'Read `post_media.storage_key` (+ `storage_bucket`).' },
  { name: 'strip-exif', verdict: 'keep', uses: 'bucket post-images', change: 'Storage only.' },
  { name: 'backfill-image-thumbs', verdict: 'keep', uses: 'buckets passed at run time', change: 'Storage only; one-off tool, may be dropped after the cut-over.' },
  { name: 'mock-login', verdict: 'obsolete', uses: 'users (upsert), admin_role_grants (select, insert)', change: 'Dev-only: moves to the dev seed scripts (design §9). It must never be deployed to kc-prod; clients cannot write either table in the baseline.' },
  { name: 'whatsapp-webhook', verdict: 'park', uses: '8 api_whatsapp_* RPCs', change: 'No `integrations` objects yet (M22): not deployed at launch.' },
  { name: 'whatsapp-intake-worker', verdict: 'park', uses: 'api_bot_* and api_whatsapp_llm_budget_take', change: 'Same (M22).' },
  { name: 'whatsapp-sender', verdict: 'park', uses: 'whatsapp_channel_config, api_whatsapp_outbound_*', change: 'Same (M22).' },
];

// ═════════════════════════════ Rules that hold across the whole map
export const notes = [
  'Errors: every baseline RPC raises `P0001` with a stable snake_case message (`unauthenticated` uses `42501`). Map on `error.message`, never on a SQLSTATE or on Hebrew text. Codes marked † in the tables are not referenced anywhere in the app today and need a user-visible mapping.',
  'Paging: no OFFSET anywhere. Lists take the `next_cursor` JSON of the last row (cards) or explicit `p_before_*` / `p_after_*` values; application ports that expose `offset` change to an opaque cursor.',
  'Money: integer agorot (`*_agorot`), never ILS floats or `*_cents` names.',
  'Lists of posts return `post_card` (post, owner, city name, cover, counters, viewer state): no follow-up queries for owners, media or counters.',
  'Status columns are never client-writable; every move is an RPC checked by the FSM kernel.',
  'Signed-out access: only `legal_documents` and `legal_document_versions`. Every other call needs a session.',
  'Workers that need `kc_private` connect over Postgres (as `dispatch-notification` does); only `public` is reachable through the HTTP API.',
];
