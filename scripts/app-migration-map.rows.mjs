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
// Objects the identity adapters address since they moved to the baseline (package P1): nothing left to change.
rpc('bootstrap_session', 'same', 'rpc:bootstrap_session', 'Session start in one call: the account gate (`account.status`, `status_until`), the caller\'s `private_profile`, the staff `admin.roles` and the pending `legal.documents`. The app reads those blocks and nothing else.');
rpc('restore_account', 'same', 'rpc:restore_account', 'Restores the caller\'s account during the 30-day grace period (refusals `not_pending_deletion`, `grace_expired`).');
rpc('request_account_deletion', 'same', 'rpc:request_account_deletion', 'Deactivates the caller\'s account for 30 days and returns the purge date (refusals `suspended`, `user_not_found`); the app calls it directly.');
rpc('set_date_of_birth', 'same', 'rpc:set_date_of_birth', '`p_date`; the 18+ rule answers `underage` / `invalid_date_of_birth`.');
rpc('set_onboarding_state', 'same', 'rpc:set_onboarding_state', '`p_state`; refusals `onboarding_basic_info_missing`, `onboarding_transition_invalid`.');
rpc('set_privacy_mode', 'same', 'rpc:set_privacy_mode', '`p_mode` \'Public\' | \'Private\'; going public accepts every pending follow request.');
rpc('follow_user', 'same', 'rpc:follow_user', '`p_target`; answers `following` or `requested`, idempotent. Refusals: `self_follow_forbidden`, `blocked_relationship`, `follow_request_cooldown_active` (detail `cooldown_until=`), `account_not_active`, `rate_limited`, `user_unavailable`.');
rpc('follow_request_decide', 'same', 'rpc:follow_request_decide', '`p_requester`, `p_accept`; a request that is no longer pending (`follow_request_not_pending`) is treated as already decided.');
rpc('follow_request_cancel', 'same', 'rpc:follow_request_cancel', '`p_target`; a request that is no longer pending is treated as already cancelled.');
rpc('chat_counterpart_contact', 'same', 'rpc:chat_counterpart_contact', '`p_chat_id`; the counterpart\'s phone as text, null when the caller cannot use the chat, it is a support thread, the counterpart is inactive or has no phone (M06, built).');
rpc('rpc_follow_suggestions', 'same', 'rpc:rpc_follow_suggestions', '`p_limit` (1-30); members with a public profile the caller does not follow and has no block with, ranked by mutual follows, city and followers, with a `reason` (migration 0031, M03 built).');
rpc('rpc_profile_completeness', 'same', 'rpc:rpc_profile_completeness', 'The caller\'s own score (0-100), `missing` parts and verification flags; another member\'s id is refused `forbidden` (migration 0031, M04 built).');
rpc('about_team_profiles', 'same', 'rpc:about_team_profiles', 'The About roster: role key and the linked active member\'s public fields, from the service-role table `about_team_members` (migration 0031, M08 built).');
rpc('search_organizations', 'same', 'rpc:search_organizations', '`p_query` (2+ characters), `p_limit`; active organizations by name or slug (migration 0031, M05 built).');
rpc('search_hashtags', 'same', 'rpc:search_hashtags', '`p_query` (with or without `#`), `p_limit`; tags of the open posts the caller can read, most used first (migration 0031, M05 built).');
rpc('search_suggested_queries', 'same', 'rpc:search_suggested_queries', '`p_limit`; the most used tags of the last 30 days, shown for an empty query (migration 0031, M05 built).');
rpc('record_active_day', 'same', 'rpc:record_active_day', 'Marks the caller active for today; idempotent within a day.');
table('user_private', 'same', 'table:user_private', 'The caller\'s own row: select, and update of the granted columns (contact phone, address lines, notification preferences, dismiss flags, `basic_info_skipped`, `show_active_status`).');
table('user_stats', 'same', 'table:user_stats', 'Counters, select only; `open_posts_only_me` is not client-readable.');
table('follows', 'same', 'table:follows', 'Select and delete direct (`follower_id`, `followed_id`); an edge is created only by `follow_user`.');
table('users', 'changed', ['table:users', 'table:user_private', 'table:user_account', 'table:user_stats'],
  'Split in four. Public profile stays in `users` (`user_id` → `id`, `city` → `city_id`, `city_name` gone: join `cities`). Contact phone, date of birth, address lines, notification preferences, dismiss flags, `basic_info_skipped` → `user_private` (own row). Account status, onboarding state, deletion dates, verification → `user_account` (read-only; moves through RPCs). Counters → `user_stats` (read-only). `is_super_admin` → `get_my_admin_roles()`. Client updates on `users` are limited to display_name, biography, avatar_url, city_id, preferred_language; `privacy_mode` moves through `set_privacy_mode`. mock-login\'s upsert goes away with the function.');
table('follow_requests', 'changed', ['table:follow_requests', 'rpc:follow_user', 'rpc:follow_request_decide', 'rpc:follow_request_cancel'], 'Read-only for clients. Insert → `follow_user`; accept / reject → `follow_request_decide(p_requester, p_accept)`; cancel → `follow_request_cancel(p_target)`. Status column is ruled by the follow_request machine.');
table('blocks', 'same', 'table:blocks', 'Same columns, same direct select / insert / delete.');
rpc('accept_legal_document', 'same', 'rpc:accept_legal_document', '`p_doc_type` is text (was an enum), `p_locale` / `p_user_agent` optional.');
table('legal_documents', 'same', 'table:legal_documents', 'Readable signed-out too (the only anon grant in the baseline).');
table('legal_document_versions', 'same', 'table:legal_document_versions', '`created_at` is gone (`published_at` stays).');
table('cities', 'changed', 'table:cities', '`lat` / `lon` / `geo` → one `location` geography column; the picker should use `search_places` instead of loading the table.');
table('streets', 'changed', 'table:streets', '`geo` → `location`.');
table('app_flags', 'same', 'table:app_flags', 'Same `select key, enabled`, for signed-in members only (no `anon` grant): before sign-in the compiled defaults apply. After sign-in the same map is `bootstrap_session().flags`. The rows (`world_<slug>_enabled`) are seed data, not part of the baseline (M09, verified).');

// ───────────────────────────── posts, feed, search
rpc('profile_closed_posts_count', 'changed', 'rpc:profile_closed_posts_count', 'One argument, `p_user_id` (the viewer is the caller); counts the closed tab only, so the Hidden tab badge (`p_list_mode = owner_only_me`) is not served: take it from `user_stats.open_posts_only_me` or drop it (M13, built as a count over the same rows as the tab).');
rpc('close_post_with_recipient', 'changed', 'rpc:close_post_with_recipient', '`p_recipient_user_id` → `p_recipient_id`; returns the handoff row, not the post. The recipient must have a chat with the owner (`closure_recipient_not_in_chat`).');
rpc('admin_remove_post', 'same', 'rpc:admin_remove_post', 'Status becomes `removed_admin`; the previous status is kept in `status_before_removal`.');
rpc('upsert_post_actor_identity', 'same', 'rpc:upsert_post_actor_identity', 'Same three arguments plus an optional `p_identity_visibility`; errors are P0001 codes (`not_participant`, `followers_only_requires_public_profile`). The owner of a delivered post also moves `posts.visibility` (M02, built).');
table('post_actor_identity', 'changed', 'table:post_actor_identity', 'A member reads only their own row. The projection `projectActorIdentityForViewer` is no longer run on the device: the server masks the owner in `post_card` and the author in `post_comments_page` (M02, built).');
table('posts', 'changed', ['table:posts', 'rpc:post_cards', 'rpc:post_detail', 'rpc:create_post_with_details', 'rpc:delete_post'],
  'Columns: `post_id` → `id`, `type` → `direction`, `category` / `category_id` → `item_subcategory_id`, `city` → `city_id`, `urgency` → `urgency_level`, `street` / `street_number` → `post_private_locations`, `availability_status` / `moderation_status` / `feed_hidden` → `status`, `status_before_admin_removal` → `status_before_removal`; `delete_after` / `reopen_count` → `post_closures`; `estimated_value`, `item_condition`, `external_body_id`, listing columns: gone. Reads of lists should use the card RPCs (`post_cards`, `feed_page`, `profile_posts_page`, `post_detail`). Insert is direct (column grants; status `draft` or `open`), rides / stays / events / food go through `create_post_with_details`. Update is direct for content columns only; status never (owner RPCs). Delete: direct only for a draft, otherwise `delete_post`.');
table('saved_posts', 'same', 'table:saved_posts', 'Same columns. The upsert becomes insert-ignore-duplicate (no update grant). The saved-posts page hydrates ids with `post_cards`.');
table('post_comments', 'changed', ['table:post_comments', 'rpc:post_comments_page', 'rpc:delete_post_comment'], '`comment_id` → `id`. Lists should use `post_comments_page` (keyset, author fields and viewer reaction included). Delete → `delete_post_comment`.');
table('post_comment_reactions', 'same', 'table:post_comment_reactions', 'Same shape.');
table('post_reactions', 'same', 'table:post_reactions', '`reaction_id` is gone (key is post + user).');
rpc('search_posts_page', 'changed', 'rpc:search_posts_page', 'Returns cards with `next_cursor` (was ids); category / city / type move into `p_filters` (same keys as `feed_page`).');
rpc('search_users_page', 'changed', 'rpc:search_users_page', 'Returns the member fields with `viewer_follows` and `next_cursor` (was ids); city / min followers / sort arguments are gone (order: most followed).');
// Objects the post adapters address since they moved to the baseline (package P2): nothing left to change.
rpc('feed_page', 'same', 'rpc:feed_page', '`p_cursor`, `p_limit` (at most 50), `p_filters` (sort, world, direction, item_subcategory_ids, status, audience, city_id + radius_km, near_city_id, q, scope); rows of `card`, `next_cursor`, `distance_m`. Several worlds or an item condition are narrowed on the returned page.');
rpc('post_cards', 'same', 'rpc:post_cards', 'Cards of up to 100 post ids the caller can read, in no particular order: the adapter restores the order of the ids (saved posts, a member\'s posts by status, one post).');
rpc('profile_posts_page', 'same', 'rpc:profile_posts_page', '`p_tab` open | closed | hidden | mine, keyset `p_cursor`; the closed tab of a profile. `mine` is the owner\'s own posts in every status and audience, narrowed by `p_statuses` (`forbidden` on another member\'s profile): "my listings" reads it. The owner\'s delivered or deleted "only me" posts still come from `posts` ids completed by `post_cards`.');
rpc('close_post_without_recipient', 'same', 'rpc:close_post_without_recipient', 'Closes an open post as delivered to nobody (`closure_wrong_status`, `listing_has_active_handoff`); seven days to reopen.');
rpc('reopen_post', 'same', 'rpc:reopen_post', 'Reopens a delivered post, or a deleted one inside its window (`closure_wrong_status`, `reopen_window_expired`); returns nothing, the adapter reads the post again.');
rpc('recipient_unmark_self', 'same', 'rpc:recipient_unmark_self', 'The recipient removes their mark (`not_recipient_or_wrong_status`).');
rpc('publish_post', 'same', 'rpc:publish_post', 'Publishes the draft the adapter wrote (draft → open); a failed create deletes the draft, which a device may delete. Refusals: `listing_wrong_status`, `post_limit_exceeded`.');
rpc('delete_post', 'same', 'rpc:delete_post', 'Deletes a post in any status the owner may delete (`listing_wrong_status` for a removed or already deleted post); a published post stays seven days for a reopen.');
rpc('set_post_reaction', 'same', 'rpc:set_post_reaction', '`p_reaction_type` like | support | thanks; a reaction is removed by deleting the caller\'s `post_reactions` row.');
rpc('post_comments_page', 'same', 'rpc:post_comments_page', 'Root comments (`p_parent_comment_id` null) or the replies of one, oldest first, with the author already masked when the poster asked to stay anonymous; the screen reads the roots and then the replies of each root that has any.');
rpc('community_stats', 'same', 'rpc:community_stats', 'One row of registered_users, open_public_posts, delivered_posts, refreshed_at; the About screen reads it again every 60 seconds (there is no change feed).');
rpc('my_activity_timeline', 'same', 'rpc:my_activity_timeline', '`p_limit`; rows of occurred_at, kind, post_id, post_title, actor_id, actor_display_name.');
table('feed_hides', 'same', 'table:feed_hides', 'Insert (user_id, post_id) ignoring duplicates; delete by post.');
table('feed_impressions', 'same', 'table:feed_impressions', 'Bulk insert of `post_id` rows; the member and the time are filled by the table.');
table('feed_mute_filters', 'same', 'table:feed_mute_filters', 'Kinds user, world and keyword (a keyword is 2-60 characters, trimmed, lower-case); there is no per-category mute, so that settings section is gone.');
table('post_media', 'same', 'table:post_media', 'One row per photo, inserted `pending` by the owner after the upload to `post-images`; delete by the owner. An edit keeps the rows whose file and position are unchanged (no update grant). Every row records the real `mime_type` and `size_bytes` of the uploaded file (JPEG or PNG, at most 8 MB); `post_detail` returns both, so a republish attaches the same files again.');
table('post_private_locations', 'same', 'table:post_private_locations', 'The exact street and number, readable and writable by the post\'s owner only (also the apartment, floor and entrance of a stay, migration 0033); other members read the part the display level shows from `posts.shown_street` / `shown_street_number` (migration 0029).');
table('post_stats', 'same', 'table:post_stats', 'Counters of a post (reactions, comments, shares); no row until the first one.');
table('post_closures', 'same', 'table:post_closures', 'The owner reads `purge_after`: the end of the seven-day reopen window of a post deleted without a recipient.');
table('challenges', 'same', 'table:challenges', 'Read to find the challenge of a challenge post (`post_id` → `id`).');
table('item_subcategories', 'same', 'table:item_subcategories', 'Read-only catalog; the items world\'s rows are the app\'s item categories (slug = lower-case category, `baby_gear`).');
table('post_kinds', 'same', 'table:post_kinds', 'Read-only catalog; a new generic post needs the items world\'s offer / request kind id.');

// ───────────────────────────── chat
// Objects the messaging adapters address since they moved to the baseline (package P3): nothing left to change.
rpc('chat_inbox_page', 'same', 'rpc:chat_inbox_page', '`p_limit`, `p_before_last_message_at`, `p_before_chat_id`, `p_search`; one row per visible chat with the counterpart, a 140-character preview of the newest message and the unread count. The app reads one page of 50; each row also carries the counterpart\'s verification level, the media type of a media message and the system payload of a system message, for the inbox badge and previews.');
rpc('chat_messages_page', 'same', 'rpc:chat_messages_page', '`p_chat_id`, `p_limit`, `p_before`, `p_after`; the `messages` rows, newest first when paging backwards. Refusal `chat_not_found`.');
rpc('send_message', 'same', 'rpc:send_message', '`p_chat_id`, `p_body`, `p_media_payload`, `p_message_id` (the optimistic message id, so a retry returns the first copy); also carries media messages and the support issue. Refusals `account_not_active`, `blocked_relationship`, `chat_not_found`, `invalid_media_payload` †, `invalid_rate_limit_args` †, `message_body_invalid` †, `rate_limited`.');
rpc('mark_chat_read', 'same', 'rpc:mark_chat_read', '`p_chat_id`; advances the caller\'s `chat_members.last_read_at`, which is the read receipt other members see.');
rpc('chat_unread_total', 'same', 'rpc:chat_unread_total', 'The badge; also delivered in `bootstrap_session().unread.chats`.');
rpc('hide_chat', 'same', 'rpc:hide_chat', '`p_chat_id`; a support thread cannot be hidden (`support_thread_not_hideable`).');
rpc('open_direct_chat', 'same', 'rpc:open_direct_chat', '`p_user_id`, `p_anchor_post_id`; the caller\'s one chat with the member (created when missing, un-hidden when hidden), re-pinned when an anchor is given. A ride is a post, so a ride anchor is a post anchor; the old "second chat after a personal hide" no longer exists. Refusals `account_not_active`, `blocked_relationship`, `cannot_chat_self`, `post_unavailable` †, `user_unavailable`.');
rpc('open_support_thread', 'same', 'rpc:open_support_thread', 'No arguments; the caller\'s support thread (`kind = \'support\'`, `support_user_id`), created on first use. A support issue is this call plus `send_message`: the category is the first line of the body (there is no category column).');
rpc('set_message_reaction', 'same', 'rpc:set_message_reaction', '`p_message_id`, `p_reaction_type` (null clears); returns nothing, the change arrives as a `reaction` broadcast on the chat topic. Refusals `account_not_active`, `invalid_reaction_type` †, `message_not_found`.');
table('chats', 'same', 'table:chats', 'Read by id for the chat screen (`id`, `kind`, `direct_user_a/b`, `support_user_id`, `anchor_post_id`, `last_message_at`, `created_at`); creation is `open_direct_chat`, the inbox is `chat_inbox_page`.');
table('chat_members', 'same', 'table:chat_members', 'Read by chat for the members\' read markers (`user_id`, `last_read_at`): a message is read when another member\'s marker reached it. Writes only through `mark_chat_read` and `hide_chat`.');
table('messages', 'same', 'table:messages', 'Read-only for clients: the "has this member ever sent a message" check selects the caller\'s `kind = \'user\'` rows; paging is `chat_messages_page`, sending is `send_message`.');
table('message_reactions', 'same', 'table:message_reactions', 'Read for the reactions of the listed messages (`message_id`, `user_id`, `reaction_type`); writes only through `set_message_reaction`.');

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
table('post_handoffs', 'changed', 'table:post_handoffs', 'Read-only for both parties. `handoff_id` → `id`, `reserved_at` → `created_at`, `world_slug` gone (join the post), `knowledge_slot_id` → slot times, new `machine_id`.');
table('org_memberships', 'changed', 'table:org_memberships', '`role` → `roles` (array), `membership_id` gone (key is org + user), new `can_post`.');
table('org_applications', 'same', 'table:org_applications', 'Read-only: the applicant reads their own rows, and platform admins read the review queue directly (policy `org_applications_select_reviewers`) with an exact count; written through `submit_org_application`.');
rpc('submit_org_application', 'same', 'rpc:submit_org_application', '`p_org_name`, `p_org_description`, `p_contact_email`, `p_contact_phone`, `p_website_url`, `p_declared_nonprofit`; one open application per user, again 7 days after a rejection.');
rpc('list_org_members', 'same', 'rpc:list_org_members', '`p_org_id`; members only. Returns user, display name, share handle, avatar, role and join time.');
rpc('org_add_member', 'same', 'rpc:org_add_member', '`p_org_id`, `p_share_handle`, `p_role`; adds a member or changes their role (grants live in `admin_role_grants`, `org_memberships` is the projection).');
rpc('org_remove_member', 'same', 'rpc:org_remove_member', '`p_org_id`, `p_user_id`; a member removes themselves to leave.');

// ───────────────────────────── rides
rpc('create_ride_series', 'changed', 'rpc:create_ride_series', 'Post fields go in `p_post`, ride fields in `p_ride` (was flat title / summary / details / kind); returns the series id only.');
rpc('update_ride_series', 'same', 'rpc:update_ride_series', 'Signature unchanged.');
rpc('set_ride_series_status', 'same', 'rpc:set_ride_series_status', 'Signature unchanged.');
table('ride_series', 'changed', 'table:ride_series', '`series_id` → `id`; title / summary / details / direction / kind → `post_template` and `ride_template` JSON.');
table('ride_saved_routes', 'changed', 'table:ride_saved_routes', '`route_id` → `id`; label / lat / lng / place columns → official place ids (`*_city_id`, `*_street_id`, `*_junction_id`) with a derived point.');

// ───────────────────────────── housing, knowledge, volunteering
// Objects the housing and knowledge adapters address since they moved to the baseline (L1, L2).
rpc('close_housing_booking', 'same', 'rpc:close_housing_booking', 'The host closes an approved stay: `p_outcome` `completed` (check-in to seven days after the stay) or `no_show` (3 to 24 hours after check-in); `housing_not_in_window` outside them.');
table('handoff_booking_details', 'same', 'table:handoff_booking_details', 'Dates, party, message and notes of a stay booking, read by its host and guest next to the `post_handoffs` row.');
rpc('housing_completed_stays', 'same', 'rpc:housing_completed_stays', 'Completed stays (as host or guest) of the listed members whose profile the caller can read: the trust block of the host panel (S16, FR-HOUSING-036).');
rpc('knowledge_slot_seats', 'same', 'rpc:knowledge_slot_seats', 'The slots of a knowledge offer with their places held and left, for every reader of the offer (FR-KNOW-004); the caller\'s booking per slot is matched on `slot_starts_at`.');
table('post_knowledge_slots', 'same', 'table:post_knowledge_slots', 'The giver\'s view maps each booking to its slot by its start.');

// ───────────────────────────── challenges, matching, karma, stats, surveys
rpc('create_challenge', 'same', 'rpc:create_challenge', 'New optional `p_city_id` (required for a community challenge: `city_required`).');
for (const name of ['end_challenge', 'leave_challenge', 'report_challenge_progress']) rpc(name, 'same', `rpc:${name}`, 'Signature unchanged.');
rpc('join_challenge', 'changed', 'rpc:join_challenge', '`p_show_on_profile` is gone.');
rpc('get_challenge', 'changed', 'rpc:get_challenge', 'Returns the `challenge_summary` composite (re-map the fields).', { c: M });
rpc('list_challenges', 'changed', 'rpc:list_challenges', 'Offset → keyset `p_cursor`; each row is `{ challenge, next_cursor }`.');
rpc('list_challenge_leaderboard', 'same', 'rpc:list_challenge_leaderboard', 'Adds `avatar_url`.');
table('challenge_progress_entries', 'same', 'table:challenge_progress_entries', 'The caller\'s own reports of a challenge, newest cycle first (policy `challenge_progress_entries_select_own`); replaces `list_my_challenge_entries`.');
table('karma_ledger', 'changed', 'table:karma_ledger', '`ledger_id` → `id`, `points_delta` → `points`, `ref_type` / `ref_id` → `subject` / `reference`. The total is `my_karma_points()`.');
rpc('my_karma_points', 'same', 'rpc:my_karma_points', 'The caller\'s own karma total (the `user_stats.karma_points` column is not readable by clients).');
rpc('check_survey_prompt_eligibility', 'same', 'rpc:check_survey_prompt_eligibility', 'Signature unchanged.');
rpc('upsert_survey_answers', 'same', 'rpc:upsert_survey_answers', 'Signature unchanged.');
table('surveys', 'same', 'table:surveys', 'Replaces `list_active_surveys` and the survey part of `get_survey_bundle`: active, published surveys (`is_active`, `current_version > 0`, filtered by the app because the super admin also reads retired ones), with `survey_versions` (and their question ids) embedded; completion is computed on the device from the caller\'s answers.', { c: M });
table('survey_questions', 'same', 'table:survey_questions', 'The questions of the current version (`survey_version_id`), in `sort_order`; replaces the question part of `get_survey_bundle`.', { c: M });
table('survey_answers', 'same', 'table:survey_answers', 'The caller\'s own answers (filtered on `user_id`: the super admin reads every answer); written only through `upsert_survey_answers`.', { c: M });
table('user_feedback', 'same', 'table:user_feedback', 'Insert of the caller\'s own feedback (`user_id`, `rating`, `body`); no client select (M16, built in `90_research/040_user_feedback.sql`).');
for (const name of ['admin_survey_overview', 'admin_survey_results', 'admin_pmf_survey_report']) {
  rpc(name, 'same', `rpc:${name}`, 'Same JSON document; moderator and more senior staff (`require_admin_role(\'moderator\')`). M17, built in `90_research/050_survey_reports.sql`.');
}
rpc('admin_user_feedback_list', 'changed', 'rpc:admin_user_feedback_list', 'Offset → keyset `p_cursor` (`{ t, id }` of the last row); returns rows with `next_cursor` (M16, built).');
rpc('get_public_research_questions', 'same', 'rpc:get_public_research_questions', 'Same signature; granted to signed-out callers, so the public research page reads the questions of an active survey directly (null when the survey is missing or not active).');

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
rpc('admin_set_manager', 'same', 'rpc:admin_set_manager', 'Signature unchanged: `p_manager_grant_id` optional again; only the super admin detaches (no manager) or skips the seniority rule; errors `forbidden_manage`, `manager_not_found`, `manager_revoked`, `manager_other_org`, `manager_cycle`, `manager_rank` (migration 0011).');
rpc('admin_list_admins', 'same', 'rpc:admin_list_admins', 'Restored by migration 0012: the roster the caller may read (platform admins all, others the organizations their grants reach) with names, manager edge and `last_seen_at`.');
rpc('admin_org_tree', 'same', 'rpc:admin_org_tree', 'Restored by migration 0012: active grants with `effective_org_id`, organization name, manager edge and `last_seen_at`; same visibility as `admin_list_admins`.');
rpc('admin_hierarchy_census', 'same', 'rpc:admin_hierarchy_census', 'Restored by migration 0013: community and role-holder totals and, per visible organization, its slug, verification and affiliates (`user_profile_fields.affiliated_org_id`) without a role.');
rpc('admin_set_org_slug', 'changed', 'rpc:admin_set_org_slug', 'New in migration 0014 (no old object): the super admin changes an organization page slug (`invalid_slug`, `slug_taken`, `org_not_found`).');
rpc('admin_org_application_approve', 'changed', 'rpc:admin_org_application_approve', 'New required `p_slug`; returns the organization id.');
rpc('admin_org_application_reject', 'same', 'rpc:admin_org_application_reject', 'Signature unchanged.');
// Admin tasks, CRM and timesheets (old M19): rebuilt after the baseline as forward migrations
// 0034-0036 (package L6). Lists page by the `cursor` of the last row.
rpc('admin_task_list', 'changed', 'rpc:admin_task_list', 'Rows are `(task jsonb, cursor jsonb)`; `p_offset` → `p_cursor` (keyset). `task_id` keeps its name inside the record; `created_by` may be null after a purge.');
rpc('admin_task_detail', 'changed', 'rpc:admin_task_detail', 'Returns one JSON record with `activities` (write order), or null for an unknown task.');
rpc('admin_task_open_count', 'same', 'rpc:admin_task_open_count', 'New: open and in-progress tasks for the dashboard card.');
for (const name of ['admin_task_create', 'admin_task_update', 'admin_task_set_status', 'admin_task_assign', 'admin_task_add_comment', 'admin_task_delete']) {
  rpc(name, 'same', `rpc:${name}`, 'Same arguments; refusals are P0001 with the old codes (`invalid_transition`, `assignee_not_admin`, …), `forbidden` is 42501.');
}
rpc('crm_my_orgs', 'same', 'rpc:crm_my_orgs', 'New: the organizations whose contact book the caller manages (FR-ADMIN-032).');
rpc('crm_contact_list', 'changed', 'rpc:crm_contact_list', 'New `p_org_id`; rows are `(contact jsonb, cursor jsonb)`; the total moves to `crm_contact_count`.');
rpc('crm_contact_count', 'same', 'rpc:crm_contact_count', 'New: the total of the list filters.');
rpc('crm_contact_upsert', 'changed', 'rpc:crm_contact_upsert', 'New `p_org_id`; new refusals `invalid_email`, `invalid_phone`, `invalid_input`.');
for (const name of ['crm_contact_delete', 'crm_contact_mark_contacted']) {
  rpc(name, 'same', `rpc:${name}`, 'Same arguments; the caller must manage the contact\'s organization.');
}
rpc('timesheet_list', 'changed', 'rpc:timesheet_list', 'New `p_scope` (mine, to_decide, all); rows are `(entry jsonb, cursor jsonb)` with `can_decide`; the total moves to `timesheet_count`.');
rpc('timesheet_count', 'same', 'rpc:timesheet_count', 'New: the total of the list filters.');
for (const name of ['timesheet_upsert', 'timesheet_submit', 'timesheet_approve', 'timesheet_reject', 'timesheet_delete']) {
  rpc(name, 'same', `rpc:${name}`, 'Same arguments; a decision is the reporter\'s direct manager\'s or a super admin\'s, never the reporter\'s own.');
}
table('user_account', 'same', 'table:user_account', 'Staff read the account row of every member (`user_account_select_staff`): status, sanction state.');
table('admin_role_grants', 'changed', 'table:admin_role_grants', '`grant_id` → `id`; read-only for clients. mock-login\'s insert goes away with the function.');

// ───────────────────────────── organizations, donations, payments, finance
table('donation_links', 'changed', 'table:donation_links', 'Clients select and delete only; insert and update are done by the `validate-donation-link` function with the service role. `tags`, `hidden_at`, `hidden_by` are gone (hiding = `review_status`).');
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
rpc('rpc_org_transparency', 'same', 'rpc:rpc_org_transparency', 'Signature unchanged; totals only, in agorot.', { c: M });
rpc('finance_transparency_settings_set', 'changed', 'rpc:finance_transparency_settings_set', 'New required `p_org_id`; returns void.');
rpc('finance_accounts_list', 'changed', 'rpc:finance_accounts_list', 'New required `p_org_id`; `*_cents` → `*_agorot`; `account_id` → `id`; no `entry_count`.');
rpc('finance_account_upsert', 'changed', 'rpc:finance_account_upsert', 'New required `p_org_id`; `p_opening_balance_cents` → `_agorot`; `p_sort_order` is gone.');
rpc('finance_ledger_list', 'changed', 'rpc:finance_ledger_list', 'New required `p_org_id`; offset → keyset (`p_after_occurred_at`, `p_after_id`); `amount_cents` → `amount_agorot`; `p_kind` filter and `reference_url` are gone.');
rpc('finance_ledger_upsert', 'changed', 'rpc:finance_ledger_upsert', 'New required `p_org_id`; `p_amount_cents` → `_agorot`; `p_currency` and `p_reference_url` are gone.');
rpc('finance_ledger_summary', 'changed', 'rpc:finance_ledger_summary', 'New required `p_org_id`; `*_cents` → `*_agorot`; cleared entries only, transfers aside (M21, built in `85_billing/140`).');
rpc('finance_ledger_mark', 'same', 'rpc:finance_ledger_mark', 'Voids an entry with the admin\'s reason (3 to 500 characters, `void_reason_required` otherwise; migration 0014) or sets its reconciliation; the entry stays in the books.');
rpc('finance_donors_summary', 'changed', 'rpc:finance_donors_summary', 'New required `p_org_id`; `total_cents` → `total_agorot`; in-app donations grouped by member, typed ones by party name; organization admins only (M21, built in `85_billing/140`).');

// ───────────────────────────── translation, notifications
rpc('get_post_translations', 'same', 'rpc:get_post_translations', 'Signature unchanged.');
table('content_translations', 'changed', 'table:content_translations', 'Clients read only; the cache is written by the `translate` function with the service role. `id` is gone (key: content + field + language).');
for (const name of ['notifications_page', 'notifications_unread_count', 'notifications_mark_read', 'notifications_mark_all_read']) {
  rpc(name, 'same', `rpc:${name}`, 'Already moved to the baseline contract.');
}
table('user_devices', 'same', 'table:user_devices', 'Already moved to the baseline contract.');

// ───────────────────────────── WhatsApp bot and dev helpers
// The `integrations` module (M22 / L7): migrations `whatsapp_channel_schema`,
// `whatsapp_webhook_and_queue`, `whatsapp_linking_and_bot_tools`, `whatsapp_admin_console`,
// `whatsapp_match_alerts_and_jobs`. Called by the two bot Edge Functions, the admin console
// adapter (SupabaseWhatsAppAdminRepository) and the member link adapter (SupabaseWhatsAppLinkRepository).
for (const name of [
  'api_whatsapp_llm_budget_take', 'api_whatsapp_queue_reply', 'api_whatsapp_outbound_claim',
  'api_whatsapp_outbound_result', 'api_whatsapp_claim_inbound', 'api_whatsapp_release_inbound',
  'api_whatsapp_inbound_allowed', 'api_whatsapp_ingest_inbound', 'api_whatsapp_handle_keyword',
  'api_whatsapp_redeem_link_code',
]) rpc(name, 'same', `rpc:${name}`, 'Same name, arguments and return shape; tables live in `integrations` (service role only).');
rpc('api_whatsapp_bot_access', 'same', 'rpc:api_whatsapp_bot_access', 'Same shape; `access` may also be `inactive` (a linked member whose account is not active): no upsell, no agent.');
rpc('api_whatsapp_channel_config', 'changed', 'rpc:api_whatsapp_channel_config', 'New (the old sender read `whatsapp_channel_config` directly): `{is_enabled, phone_number_id, graph_api_version}`; the table moved to `integrations`.');
rpc('api_bot_search_posts', 'changed', 'rpc:api_bot_search_posts', 'Was `api_bot_search_listings(p_owner_id, …)` + `api_bot_listing_cards`: `(p_user_id, p_query, p_world_slug, p_limit ≤ 8)` returns the post cards themselves (`post_id`, `world_slug`, `direction`, `title`, `description`, `city_id`, `published_at`) visible to that member.');
rpc('api_bot_open_session', 'renamed', 'rpc:api_bot_open_session', '`p_record_id` → `p_inbound_message_id` (the inbound row id returned by `api_whatsapp_ingest_inbound`; may be null).');
rpc('api_bot_apply_extraction', 'same', 'rpc:api_bot_apply_extraction', 'Same arguments; kind slugs are the posts catalog\'s (`item_offer`, `item_request`, `food_offer`, `food_request`); returns the session id; titles are cut to 80 characters.');
rpc('api_bot_publish_post', 'changed', 'rpc:api_bot_publish_post', 'Was `api_bot_publish_listing` (returned the listing id): returns `{post_id, status, review, photo_required}`, a draft when confidence is below 0.85 (review item) or when an offer in a photo world needs its photo (D132); a food offer needs `details.expires_at`.');
rpc('api_bot_my_posts', 'renamed', 'rpc:api_bot_my_posts', 'Was `api_bot_my_listings`; same arguments; rows carry `post_id` (was `listing_id`).');
rpc('api_bot_my_matches', 'same', 'rpc:api_bot_my_matches', 'Same shape; reads matching v2 pairs and leaves out a pair whose other post the member may not read.');
// Member link screen (Settings → WhatsApp), through IWhatsAppLinkRepository.
rpc('api_whatsapp_my_link_status', 'changed', 'rpc:api_whatsapp_my_link_status', 'Adds `consent_opted_in` and `phone_opted_out` to `{linked, wa_id_masked, is_pro}`.');
rpc('api_whatsapp_create_link_code', 'same', 'rpc:api_whatsapp_create_link_code', '`{code, expires_at}`; `pro_required` for a member without Pro, `rate_limited` after 10 codes an hour (new).');
rpc('api_whatsapp_unlink_me', 'same', 'rpc:api_whatsapp_unlink_me', 'Unlinks the caller\'s number; the phone row and its consent history stay.');
rpc('api_whatsapp_set_match_consent', 'changed', 'rpc:api_whatsapp_set_match_consent', 'New app path (the old `api_bot_set_match_consent` had no caller): the caller\'s own match-alert switch; returns the link status.');
// Admin console (moderator+; the two configuration writers are super admin).
for (const name of ['api_whatsapp_admin_get_channel', 'api_whatsapp_admin_set_channel_enabled']) {
  rpc(name, 'same', `rpc:${name}`, 'Same shape plus `updated_by`; the switch is audited (`whatsapp_channel_toggle`).');
}
rpc('api_whatsapp_admin_overview', 'changed', 'rpc:api_whatsapp_admin_overview', 'Adds `review_pending`; rate hits read `kc_private.rate_limit_counters`.');
rpc('api_whatsapp_admin_list_consent', 'changed', 'rpc:api_whatsapp_admin_list_consent', '`p_offset` → `p_cursor` (keyset); no `total_count`; rows add `identity_id` and `cursor`.');
rpc('api_whatsapp_admin_list_outbound', 'changed', 'rpc:api_whatsapp_admin_list_outbound', '`p_offset` → `p_cursor` (keyset) with `p_status`; no `total_count`; rows add `cursor`; `invalid_status` for an unknown status.');
rpc('api_whatsapp_admin_list_rate_hits', 'same', 'rpc:api_whatsapp_admin_list_rate_hits', 'Same arguments; rows add `expires_at`; the number inside a bucket key is masked.');
rpc('api_whatsapp_admin_list_recent_matches', 'same', 'rpc:api_whatsapp_admin_list_recent_matches', 'Same shape; `match_found_v1` and `confirm_handoff_v1` of the last 7 days.');
rpc('api_whatsapp_admin_list_conversations', 'changed', 'rpc:api_whatsapp_admin_list_conversations', '`listing_id` → `post_id`; rows add `confidence`.');
rpc('api_whatsapp_admin_resend', 'same', 'rpc:api_whatsapp_admin_resend', 'Same shape (`outbound_not_found`, `not_resendable`); audited.');
rpc('api_whatsapp_admin_block_user', 'same', 'rpc:api_whatsapp_admin_block_user', 'Same shape; audited.');
rpc('api_whatsapp_admin_review_list', 'changed', 'rpc:api_whatsapp_admin_review_list', 'New: the review queue of bot posts, keyset-paged (`p_status`, `p_cursor`, `p_limit`).');
rpc('api_whatsapp_admin_review_resolve', 'changed', 'rpc:api_whatsapp_admin_review_resolve', 'New: `approved` publishes the draft for its owner (`offer_photo_required` without a photo), `rejected` leaves it (`invalid_decision`, `invalid_transition`); audited.');
rpc('api_whatsapp_admin_list_templates', 'changed', 'rpc:api_whatsapp_admin_list_templates', 'New: the templates and their Meta state.');
rpc('api_whatsapp_admin_get_send_limits', 'changed', 'rpc:api_whatsapp_admin_get_send_limits', 'New, moderator and above: the current send limits for the console panel.');
rpc('api_whatsapp_admin_set_send_limits', 'changed', 'rpc:api_whatsapp_admin_set_send_limits', 'New, super admin: patches the send limits (`invalid_limits`); audited.');
rpc('api_whatsapp_admin_set_template_status', 'changed', 'rpc:api_whatsapp_admin_set_template_status', 'New, super admin: a template\'s Meta status (`invalid_status`, `template_not_found`); audited.');

// ───────────────────────────── Edge Function workers (service role)
rpc('embedding_jobs_claim', 'renamed', 'rpc:embedding_jobs_claim', 'Returned `listing_id` → `post_id`.');
rpc('embedding_job_store', 'same', 'rpc:embedding_job_store', 'Signature unchanged.');
rpc('embedding_job_fail', 'same', 'rpc:embedding_job_fail', 'Signature unchanged.');
rpc('api_match_llm_pending', 'same', 'rpc:api_match_llm_pending', 'Signature unchanged.');
rpc('api_match_llm_store', 'changed', 'rpc:api_match_llm_store', 'Returns void (was boolean): an unknown pair raises `match_not_found`.');
rpc('provider_webhook_apply', 'same', 'rpc:provider_webhook_apply', 'Signature unchanged; errors are stable snake_case messages.');
rpc('api_revenuecat_set_pro', 'same', 'rpc:api_revenuecat_set_pro', 'Signature unchanged.');
rpc('api_my_pro_status', 'same', 'rpc:api_my_pro_status', 'The caller\'s Pro status (`is_pro`); the Pro screen reads it.');
rpc('api_revenuecat_set_org_entitlement', 'same', 'rpc:api_revenuecat_set_org_entitlement', 'Service role only (RevenueCat webhook, 0002): reports an organization\'s store subscription state.');
rpc('submit_public_research_response', 'same', 'rpc:submit_public_research_response', 'Signature unchanged.');
rpc('get_research_salt', 'same', 'rpc:get_research_salt', 'Service role only: the current hashing salt of the public research form (the `research_secrets` table is private).');
rpc('rotate_research_salt', 'same', 'rpc:rotate_research_salt', 'Service role only: replaces the salt and returns the rotation time.');
rpc('api_standing_orders_charge_due', 'same', 'rpc:api_standing_orders_charge_due', 'Service role only: opens the due charges of active standing orders (amounts in agorot) and returns them for the provider.');

// ───────────────────────────── storage buckets
bucket('post-images', 'same', 'bucket:post-images', 'Declared by the baseline (own-folder insert / delete policies); `post_media.storage_bucket` points at it.');
bucket('avatars', 'same', 'bucket:avatars', 'Declared in `95_platform/090_storage.sql`: public, JPEG, 512 KB, `<user_id>/avatar.jpg` (and the thumb in the same folder) (M23, verified).');
bucket('chat-media', 'same', 'bucket:chat-media', 'Declared in `95_platform/090_storage.sql`: private, `<user_id>/<chat_id>/<file>`, read through signed URLs by chat members (M23, verified).');
bucket('<bucket>', 'changed', 'bucket:post-images', '`backfill-image-thumbs` loops over a bucket list passed at run time; after the cut-over the list is `post-images` (plus `avatars` and `chat-media`).', { c: M });

// ───────────────────────────── realtime
channel('`chat:${chatId}:messages`', 'same', 'topic:chat:<chat id>:messages', 'Private topic of the chat; broadcast events `INSERT` (the message row), `read` (a member\'s marker), `reaction` and `chat_updated` (the pinned post). The app consumes `INSERT`, `read` and `chat_updated`; reactions are re-read on demand.');
channel('`user:${userId}:chats`', 'same', 'topic:user:<user id>:chats', 'Private topic of the member; event `chat_updated` carries ids only, so the inbox refreshes and the unread total is re-read.');
channel('`chat:${chatId}:typing`', 'same', 'topic:chat:<chat id>:typing', 'Members may send on `chat:%:typing` and `chat:%:presence`.');
channel('topic = `user:${userId}:notifications`', 'same', 'topic:user:<user id>:notifications', 'Already on the baseline contract (event `badge`).');
channel('topic = `user:${userId}:account`', 'same', 'topic:user:<user_id>:account', 'Already on the baseline contract (event `account_changed` with `status`, `status_until`, `onboarding_state`; M24, built for the account gate): the account gate subscribes here instead of to a `users` row.');
channel('`user:${userId}:stats`', 'same', 'topic:user:<user id>:stats', 'Private topic of the member (migration 0026); event `stats_changed` carries the own counters (karma, followers, following, given, received, open posts) when one changes. `useMeRealtime` patches the own-profile cache (FR-KARMA-009, M24 built).');
channel("FEED_PUBLIC_TOPIC = 'feed:public'", 'same', 'topic:feed:public', 'Private topic (migration 0026); event `new_post` with `post_id` and `owner_id` when a post becomes open and Public. The feed counts the pill and re-reads through RLS on tap (FR-FEED-009 AC2, M24 built).');
channel("ONLINE_PRESENCE_TOPIC = 'presence:online'", 'same', 'topic:presence:online', 'Presence, key = member id (migration 0026); tracking and receiving both need an active account with "show my active status" on, and in-chat presence follows the same rule (M24 built).');
channel('topic', 'same', 'client:openExactTopicChannel', 'The shared helper itself: unchanged, it opens whatever private topic it is given.');

// ───────────────────────────── Edge Function invokes from the app
edge('public-research-submit', 'same', 'edge:public-research-submit', 'Same invoke; the function keeps calling `submit_public_research_response`.');
edge('translate', 'same', 'edge:translate', 'Same invoke.');
edge('validate-donation-link', 'same', 'edge:validate-donation-link', 'Same invoke; the function writes `donation_links` with the service role.');

// ───────────────────────────── launch worlds (package P5): the objects the world adapters address on the baseline
// A listing is a post; a ride, an event and a food offer are posts with a detail row; every booking, reservation and registration is a `post_handoffs` row.
rpc('create_post_with_details', 'same', 'rpc:create_post_with_details', '`p_post` (world, kind, direction, title, city, ...) and `p_details` (the columns of the detail table). The adapter turns the forms\' legacy `details` document into the ride, event or food columns; refusals `declaration_required`, `ride_place_invalid`, `ride_time_invalid`, `food_expiry_required`, `event_time_invalid`, `post_limit_exceeded`.');
rpc('set_post_organization', 'same', 'rpc:set_post_organization', 'Attaches a new organization event to the organization the member publishes for (`forbidden` when the member may not act for it).');
rpc('post_detail', 'same', 'rpc:post_detail', 'Card, gallery and first comments as one JSON; the adapter adds the world detail row and the world labels to build the listing detail.');
rpc('similar_posts', 'same', 'rpc:similar_posts', '"More like this" as cards.');
rpc('pause_post', 'same', 'rpc:pause_post', 'Pauses the owner\'s open post (`listing_wrong_status`, `listing_has_active_handoff`).');
rpc('resume_post', 'same', 'rpc:resume_post', 'Reopens a paused post.');
rpc('rate_handoff', 'same', 'rpc:rate_handoff', 'One rating RPC for every world (`p_stars`, optional `p_comment`); refusals `invalid_rating`, `handoff_not_found`, `not_participant`, `handoff_already_rated`.');
rpc('message_event_registrants', 'same', 'rpc:message_event_registrants', 'The organizer\'s message to everyone registered for an event; answers how many were told (`event_message_invalid`).');
rpc('complete_ride', 'same', 'rpc:complete_ride', 'The driver completes the whole ride; answers the number of bookings completed.');
rpc('get_post_private_location', 'same', 'rpc:get_post_private_location', 'The private house numbers of a ride, released to the driver and to the passengers of a confirmed booking.');
rpc('report_post_emergency', 'same', 'rpc:report_post_emergency', '`p_post_id`, optional `p_note`; refusals `ride_not_active`, `emergency_throttled`.');
rpc('rides_feed', 'same', 'rpc:rides_feed', 'The rides feed; with `p_filters.origin` / `dest` / `radius_km` it is the route search. The app reads the first page; an occurrence of a recurring ride carries `series_on`, `series_weekdays` and `series_depart_time` for its series marker.');
rpc('ride_occurrence_schedules', 'same', 'rpc:ride_occurrence_schedules', 'The series day, weekdays, departure time and last day of ride occurrences the caller can read (`p_post_ids`); the ride detail builds its series marker from it, since `ride_series` is its owner\'s alone.');
rpc('post_seat_counts', 'same', 'rpc:post_seat_counts', 'Places held, waiting registrations and seats left of event and ride posts the caller can read (`p_post_ids`, at most 100); the volunteering shifts and the occurrences of a ride series read their free places here.');
table('post_series', 'same', 'table:post_series', 'The recurring-event series of a post (schedule plus post and event templates); read through the series RPCs, written only by them.');
rpc('create_post_series', 'same', 'rpc:create_post_series', 'Creates a series and publishes its dates of the next 30 days; any active member, for an organization only one who may act for it.');
rpc('update_post_series', 'same', 'rpc:update_post_series', 'Edits the series template and schedule; the owner only (`post_series_not_found`).');
rpc('set_post_series_status', 'same', 'rpc:set_post_series_status', '`p_series_id`, `p_status`: active, paused or ended; ending cancels every upcoming date and tells its registrants. The owner only.');
rpc('cancel_post_series_date', 'same', 'rpc:cancel_post_series_date', 'Cancels one date of a series without ending it; the owner only.');
rpc('accept_world_consent', 'same', 'rpc:accept_world_consent', 'Accepts the driver declaration in force (`p_kind`, `p_version`); `consent_version_stale` for an old version.');
rpc('my_matches', 'same', 'rpc:my_matches', 'The caller\'s pairs, each with the other member\'s post as a card (`other_post`).');
rpc('admin_match_quality', 'same', 'rpc:admin_match_quality', '`p_days` (clamped 1..365); per giving world the alerted pairs, answers, acceptances, chats after the alert and completed handoffs, rates as numerics. Moderators and above (`forbidden` otherwise); lives in `76_matching/070_match_quality.sql`.');
// Moderation, support and statistics restored after the baseline (migrations `0015`–`0019`).
rpc('list_my_blocked_users', 'same', 'rpc:list_my_blocked_users', 'The caller\'s blocks with the blocked member\'s name and avatar, newest first, keyset (`p_before_blocked_at`, `p_before_user_id`, `p_limit` ≤ 100); `0015` (M01, built).');
rpc('submit_support_issue', 'changed', 'rpc:submit_support_issue', 'Was `rpc_submit_support_issue`. `(p_category, p_description, p_issue_id)` writes a `support_issue` system message (`issue_id`, `category`, `description`) and returns the thread; refusals `description_too_short`, `description_too_long` (500), `invalid_support_category`; `0015`.');
rpc('admin_list_support_threads', 'same', 'rpc:admin_list_support_threads', 'Staff: support threads with messages, newest first, keyset; `0015`.');
rpc('admin_join_support_thread', 'same', 'rpc:admin_join_support_thread', 'Staff join a support thread as its `support_agent`; idempotent, audited; `0015`.');
rpc('admin_open_member_support_thread', 'same', 'rpc:admin_open_member_support_thread', 'Staff open a member\'s support thread (created if needed) from a report case; `0015`.');
rpc('admin_restore_chat', 'changed', 'rpc:admin_restore_chat', 'Was the chat branch of `admin_restore_target`: unhides a chat hidden for review and dismisses its open reports (FR-ADMIN-002 AC2/AC4); `0016`.');
rpc('admin_restore_comment', 'same', 'rpc:admin_restore_comment', 'Brings back a comment staff removed, with the replies removed alongside; dismisses its open reports; `0016`.');
rpc('admin_delete_comment', 'same', 'rpc:admin_delete_comment', 'Staff remove a comment with its replies; `0016` stamps `moderation_removed_at` so `admin_restore_comment` can bring them back.');
rpc('admin_reports_inbox', 'changed', 'rpc:admin_reports_inbox', 'Was `reports_open_inbox`. Server-grouped open cases, oldest first, keyset (`p_after_oldest_at`, `p_after_target_type`, `p_after_target_id`), filters and `p_search` (target id or reporter name); `0016`.');
rpc('admin_report_case_timeline', 'changed', 'rpc:admin_report_case_timeline', 'Was the timeline of `reports_case_detail` (reporters come from `reports`): the whole audit history of the target and its reports from `admin_report_case_timeline` (every staff role); `0016`.');
rpc('admin_audit_lookup', 'changed', 'rpc:admin_audit_lookup', 'Was `admin_audit_lookup_guarded`. Super admin: events by or about a member (`p_user_id`), keyset, ≤ 200; `0016`.');
table('moderation_queue', 'same', 'table:moderation_queue', 'Staff read the open review entries directly (oldest first, keyset); writes through `admin_assign_queue_entry` / `admin_resolve_queue_entry` (FR-MOD-008).');
rpc('admin_assign_queue_entry', 'same', 'rpc:admin_assign_queue_entry', 'A moderator takes an open review entry or hands it to another staff member.');
rpc('admin_resolve_queue_entry', 'same', 'rpc:admin_resolve_queue_entry', 'A moderator closes an open review entry.');
rpc('admin_world_flow_funnel', 'same', 'rpc:admin_world_flow_funnel', '`p_days` (1..365); per world and direction (`give` / `request`) the posts published in the window through their handoffs; money has no handoff stages. Moderators and above; `0018` (M14, built).');
rpc('my_world_givings', 'same', 'rpc:my_world_givings', 'The caller\'s handed-over givings (given / received) and closed posts per world; `0018` (M15, built).');
rpc('list_kc_support_channels', 'same', 'rpc:list_kc_support_channels', 'Active KC support channels; the payee phone only for signed-in callers; the table is edited by the super admin; `0019` (M20, built).');
rpc('match_respond', 'same', 'rpc:match_respond', '`p_match_id`, `p_accept`; answers the pair\'s status (`accepted` when both accepted).');
table('post_ride_details', 'same', 'table:post_ride_details', 'Read for the route, time and seats of a ride and for the occurrences of a series; the owner edits it through the adapter.');
table('post_event_details', 'same', 'table:post_event_details', 'Read for an event\'s window, capacity and policy; the organizer edits it through the adapter.');
table('post_food_details', 'same', 'table:post_food_details', 'Read for a food offer\'s expiry and contents; the giver edits it through the adapter.');
table('worlds', 'same', 'table:worlds', 'The world labels shown on a listing detail.');
// Links and knowledge of a giving world (migration `0024`), read by `SupabaseWorldContentRepository`.
table('world_links', 'same', 'table:world_links', 'Curated links from one world to a related one; readable signed-out too.');
table('knowledge_topics', 'changed', 'table:knowledge_topics', 'The topic tree, read-only for members: `id` (not `topic_id`), `world_slug` added, no `created_by` / `approved_by` / `legacy_category_slug`. Proposals, review and follows are not in the baseline.');
table('external_bodies', 'changed', 'table:external_bodies', '`id` (not `body_id`); read directly, the search and admin RPCs of the old picker are not in the baseline.');
table('organizations', 'same', 'table:organizations', 'The routed worlds\' body picker (organizations by name).');
table('road_junctions', 'same', 'table:road_junctions', 'The junctions of the ride place catalog (name and position).');
table('user_consents', 'same', 'table:user_consents', 'The acceptance record of the driver declaration.');
table('post_ratings', 'same', 'table:post_ratings', 'The rater reads back the ratings they wrote, to mark a booking "rated by me".');

// ═════════════════════════════ MISSING: what the baseline does not provide
// action: build (add to the baseline) · rls-read (already possible, no new object) · drop · defer (behind a flag)
export const missing = [
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
  'fn:purge-deleted-accounts': 'core', 'fn:translate': 'core', 'fn:strip-exif': 'core',
  'fn:reconcile-storage-orphans': 'core', 'fn:backfill-image-thumbs': 'core',
  'fn:embed-worker': 'wedge', 'fn:match-rerank': 'wedge', 'fn:validate-donation-link': 'wedge',
};
const NAME_TIER = [
  [/^(finance_|admin_task_|crm_|timesheet_|api_whatsapp|api_bot|whatsapp_|dev_|admin_(demo|seed|wipe)_|admin_survey|admin_pmf|admin_org_|rpc_org_transparency$|org_applications$)/, 'later'],
  [/^(admin_hierarchy_census|admin_set_manager|admin_user_feedback_list|admin_match_quality|admin_world_flow_funnel|my_world_givings)$/, 'later'],
  [/^(list_my_blocked_users|rpc_follow_suggestions|rpc_profile_completeness|rpc_search_suggested_queries|about_team_profiles)$/, 'later'],
  [/^(community_stats|rpc_my_activity_timeline|record_active_day|app_flags|is_admin)$/, 'core'],
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
    work: 'Done in P0 (see docs/db/app-migration-playbook.md): `database.types.ts` is the generated baseline types and `database.legacy.types.ts` a frozen copy of the old ones, imported only by the files listed in `infrastructure-supabase/src/migrationStatus/<package>.ts` (the client factory is generic: `getSupabaseClient()` is baseline-typed, `getLegacySupabaseClient()` / `legacySupabase` are the same connection typed against the old schema). `FSM_MACHINES` equals the baseline seeds (`catalogMatchesSql.test.ts` reads `supabase/schemas`); the machines without a baseline seed sat in `LEGACY_FSM_MACHINES` until their modules moved (the list is gone since L6 seeded the last two in `0034` and `0036`). `rpc/backendUnavailable.ts` holds `isBackendObjectMissing` and `rpc/mapRpcError.ts` the P0001 mapper and `unwrapCall`; `BackendUnavailableError` and `BackendRuleError` are domain errors. UI helpers: `apps/mobile/src/lib/backendAvailability.ts` and the `backend.*` locale keys. `src/__tests__/baselineCompatibility.test.ts` fails when an unlisted file still needs the old schema or a listed file no longer does.',
    tests: ['pnpm typecheck, pnpm test, pnpm lint from app/', 'src/fsm/__tests__/catalogMatchesSql.test.ts against supabase/schemas', 'src/__tests__/baselineCompatibility.test.ts', 'src/rpc/__tests__/degradeRule.test.ts', 'node --test scripts/*.test.mjs', 'node scripts/gen-baseline-types.mjs --check'],
    degrade: 'This package defines the rule for all others: an adapter call that hits a missing function or table throws `BackendUnavailableError`; a list screen shows its empty state, an action shows the generic "not available yet" message, a world whose `world_<slug>_enabled` flag is off never renders its entry points. No screen reads `error.message` of an unknown error.',
    risks: 'Everything depends on it and it must not change behaviour: no adapter logic changed, only its type import. CI still diffs `database.types.ts` against the old migrations until the workflow change listed in the P0 report lands.' },
  { id: 'P1', title: 'Identity: session start, profile, privacy, follow, block, legal, account deletion, devices', launch: 'core', parallelWith: [],
    select: either(inArea('auth', 'users', 'legal', 'blocks', 'social', 'cities', 'streets', 'about', 'notifications'), named(/^(record_active_day|api_my_pro_status|avatars|topic = `user:.*notifications`)$/)),
    files: ['auth/**', 'users/**', 'legal/**', 'blocks/**', 'social/**', 'cities/**', 'streets/**', 'about/**', 'notifications/**', 'survey/SupabaseUserActivityRepository.ts', 'apps/mobile: auth gate, onboarding, settings, edit profile, avatar upload, notification badge hook, devIdentityVerification (deleted)'],
    work: 'Done in P1: the account gate, private profile, onboarding state and pending legal documents read `bootstrap_session`; `users/mapUserRow.ts` maps the public `users` row plus `user_stats` and, for the caller\'s own row, the `bootstrap_session` private blocks (`user_private`, `user_account`, staff roles); follows go through `follow_user`, `follow_request_decide` and `follow_request_cancel`; account deletion through `request_account_deletion` and `restore_account`; the account gate listens on `user:<id>:account`. the blocked-users list reads `list_my_blocked_users` (`0015`); follow suggestions, the completeness nudge (M03, M04) and the About roster (M08) are built (`0031`); the dev-only identity and onboarding helpers are gone.',
    tests: ['vitest: auth, users, legal, blocks, social, notifications suites', 'contract tests against a baseline database (sqlProbes, contract.integration)', 'pgTAP 010, 011, 020, 021, 050, 051'],
    degrade: 'Nothing works before this package (no session): it is the first one after P0.',
    risks: 'Owns `users/mapUserRow.ts`, which chat, posts and search read: it lands before P2 and P3 start. Account gate: topic `user:<id>:account` (M24).' },
  { id: 'P2', title: 'Posts, feed, search, closure, translations', launch: 'core', parallelWith: ['P3', 'P4'],
    select: either(inArea('posts', 'feed', 'search', 'translations', 'stats'), named(/community[-_]stats/)),
    files: ['posts/**', 'feed/** (except feed/SupabaseFeedRealtime.ts)', 'search/**', 'translations/**', 'stats/**', 'apps/mobile: feed, post detail, create / edit post, profile tabs, saved posts, image upload, community counter, statistics screen'],
    work: 'Card-based reads (`feed_page`, `profile_posts_page`, `post_detail`, `post_cards`), keyset cursors, column renames, owner actions and closure through RPCs, `post_media`.',
    tests: ['vitest: posts, feed, search, translations suites', 'pgTAP 030, 035, 040, 041, 042, 078'],
    degrade: 'Until it lands the feed and profile tabs show their empty state and the create-post button is disabled; nothing else in the app depends on a post list.',
    risks: 'Largest behavioural change: cursor and card shape reach the application ports. Owns `posts/mapPostRow.ts`, read by P5. The card carries `owner_identity_masked` (M02).' },
  { id: 'P3', title: 'Chat and realtime', launch: 'core', parallelWith: ['P2', 'P4'],
    select: either(inArea('chat'), named(/^chat-media$/)),
    files: ['chat/**', 'feed/SupabaseFeedRealtime.ts', 'rides/SupabaseRidesRealtime.ts', 'apps/mobile: chat screens, chat media, inbox and notification badge hooks'],
    work: 'Done in P3: the inbox is `chat_inbox_page`, messages are `chat_messages_page` and `send_message` (the optimistic id is `p_message_id`), a chat opens through `open_direct_chat` / `open_support_thread`, read receipts come from `chat_members.last_read_at` (the `read` broadcast), and the chat and inbox subscriptions are the private topics `chat:<id>:messages` and `user:<id>:chats`. The new-posts banner (`feed:public`) and global online presence (`presence:online`) are built (migration 0026); the rides feed updates have no baseline topic and are degraded (M24): they open nothing and report `BackendUnavailableError`.',
    tests: ['vitest: chat suites, realtime/exactTopicChannel tests', 'pgTAP 045, 050'],
    degrade: 'Before this package the chat tab shows an empty inbox and "contact" buttons on posts are disabled; a failed subscription is ignored (the screen refreshes on focus). After it: no green online dots, no live "new posts" pill, ride lists refresh on focus; the inbox preview of a system or media-only message carries no text and the counterpart verification badge is not shown in the inbox (the page RPC does not return them).',
    risks: 'Contact phone: `chat_counterpart_contact` (M06). Optimistic send passes `p_message_id`. The baseline keeps one chat per pair; after a personal hide the member\'s history starts at the hide (migration 0028), so contacting again opens a clean thread for them (`preferNewThread` needs no second chat); a ride or listing anchor is a post anchor.' },
  { id: 'P4', title: 'Reports, moderation and admin basics', launch: 'core', parallelWith: ['P2', 'P3'],
    select: either(both(inArea('moderation', 'reports', 'admin'), tierIs('core')), named(/^admin_(demo|seed|wipe)_/)),
    files: ['moderation/**', 'reports/**', 'admin/fetchMyAdminRoles.ts', 'admin/SupabaseAdminRoleRepository.ts', 'admin/SupabaseAdminContentRepository.ts', 'admin/SupabaseDemoDataRepository.ts (deleted)', 'apps/mobile: report sheet, admin portal home, reports inbox, case detail, users / posts search, roles, audit'],
    work: 'Reporting stays a direct insert; staff lists become RLS reads; role and sanction RPCs keep their names. The demo-data screen and repository are deleted here (FR-ADMIN-031).',
    tests: ['vitest: moderation, reports, admin role and content suites', 'pgTAP 060, 061'],
    degrade: 'Reporting a post or member shows "not available yet"; the admin portal entry is hidden for everyone until the package lands (staff use the dashboard of the database meanwhile).',
    risks: 'Staff deletion of a chat message is `admin_delete_message` (M18).' },
  { id: 'P5', title: 'Launch worlds: items, food, rides, time (events), matching, donation links', launch: 'wedge', parallelWith: ['P6'],
    select: either(inArea('marketplace', 'rides', 'volunteering', 'matching', 'donations', 'organizations', 'series', 'worlds'), both(inArea('mobile'), tierIs('wedge'))),
    files: ['marketplace/**', 'rides/** (except rides/SupabaseRidesRealtime.ts)', 'volunteering/**', 'matching/**', 'donations/**', 'organizations/**', 'apps/mobile: world screens, ridesKnowledgeComposition, listing image upload, karma history'],
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
    work: 'Done in L1: bookings are `post_handoffs` rows (machine `housing_booking`) with `handoff_booking_details`, read directly by host and guest; complete and no-show are `close_housing_booking`; the code of conduct comes from `bootstrap_session` and is accepted with `accept_world_consent`; the exact place is `post_private_locations` (apartment, floor, entrance and access notes folded into `access_notes`), released through `get_post_private_location`; the guest trust block counts completed stays with `housing_completed_stays`.',
    tests: ['vitest: housing suite', 'pgTAP 071, 075 (trust counts)'],
    degrade: '`world_housing_enabled` off: the world is a portal and no housing adapter is called. With it on, the housing lists load through `listOrEmpty` / `valueOrNull` and an action on a missing object shows "not available yet".',
    risks: 'The stay offer\'s exact point is written as EWKT; the separate apartment, floor and entrance fields come back merged in the access instructions.' },
  { id: 'L2', title: 'Knowledge world', launch: 'later', parallelWith: ['L1', 'L3', 'L4', 'L5', 'L6', 'L7'],
    select: inArea('knowledge'),
    files: ['knowledge/**', 'apps/mobile: knowledge screens'],
    work: 'Done in L2: slots with their places left come from `knowledge_slot_seats`, the caller\'s booking per slot from their `post_handoffs` rows; bookings move through the generic handoff RPCs (`book_knowledge_seat`, `confirm_item_handoff`, `cancel_giving_handoff`, `mark_giving_handed_over`). The topic graph (FR-KNOW-001) is not in the baseline: the topic repository rejects every call with `BackendUnavailableError` and calls nothing.',
    tests: ['vitest: knowledge suite', 'pgTAP 073, 075 (slot seats)'],
    degrade: '`world_knowledge_enabled` off: portal only. With it on, the slot and booking lists load through `listOrEmpty`; a topic picker shows its empty state.',
    risks: 'The topic graph (topics, aliases, follows, proposals, review) is still to be designed into `70_worlds` before the topic features open.' },
  { id: 'L3', title: 'Challenges', launch: 'later', parallelWith: ['L1', 'L2', 'L4', 'L5', 'L6', 'L7'],
    select: inArea('challenges'),
    files: ['challenges/**', 'apps/mobile: challenge screens, useChallengeLinkedPost'],
    work: 'Done: keyset `list_challenges`, the `challenge_summary` composite (which names the post, so `useChallengeLinkedPost` needs no posts query), own reports from `challenge_progress_entries`, and `join_challenge` without the show-on-profile choice (the prompt is removed).',
    tests: ['vitest: challenges suite', 'pgTAP 074'],
    degrade: 'Challenges flag off: the tab is hidden; a challenge post in the feed opens as a plain post.',
    risks: 'Low.' },
  { id: 'L4', title: 'Money: donations to organizations, standing orders, org finance, org onboarding', launch: 'later', parallelWith: ['L1', 'L2', 'L3', 'L5', 'L6', 'L7'],
    select: (row) => row.launch === 'later' && (row.areas.includes('payments') || /^(finance_|admin_org_|org_applications$|rpc_org_transparency|admin_hierarchy_census|admin_set_manager)/.test(row.old) || row.areas.some((a) => ['fn:payments-webhook', 'fn:revenuecat-webhook', 'fn:receipts-issuer', 'fn:subscriptions-charger'].includes(a))),
    files: ['payments/**', 'admin/SupabaseFinance*.ts', 'admin/SupabaseOrgTransparencyRepository.ts', 'admin/SupabaseOrgApplicationsRepository.ts', 'admin/SupabaseOrgHierarchyRepository.ts', 'supabase/functions/{payments-webhook,revenuecat-webhook,subscriptions-charger}', 'supabase/functions/receipts-issuer (deleted)', 'apps/mobile: donations money screens, org finance portal'],
    work: 'Done in L4 for the app: amounts are agorot end to end (the payments contract), a donation starts an intent and opens the provider\'s checkout page (no client-side settlement), the finance adapters pass the platform organization to the org-scoped RPCs, the ledger pages by keyset and voids instead of deleting, the summaries call `finance_ledger_summary` / `finance_donors_summary` (built), applications are a direct read and an approval sends the chosen slug, the staff tree and census are built from `admin_role_grants`. The KC support channels have no baseline list: the adapter degrades without a call. Still open: the Edge Functions of this package (charger on `api_standing_orders_charge_due`, the payments webhook).',
    tests: ['vitest: payments and finance suites', 'pgTAP 080, 085, 086, 087 (finance summaries)'],
    degrade: '`world_money_enabled` off: the money world is a portal of links; the support card shows its unavailable state (no channel list); a donation without a checkout page says "not available yet".',
    risks: 'No checkout Edge Function sets `checkout_url` yet. A KC support-channel list (a small reference table in `85_billing`, or app configuration) is still to be decided. Retention of billing rows is an open legal question (design Q5).' },
  { id: 'L5', title: 'Surveys, feedback, public research', launch: 'later', parallelWith: ['L1', 'L2', 'L3', 'L4', 'L6', 'L7'],
    select: (row) => row.launch === 'later' && row.areas.some((a) => ['survey', 'research', 'fn:public-research-submit', 'fn:rotate-research-salt'].includes(a)),
    files: ['survey/** (except survey/SupabaseUserActivityRepository.ts, owned by P1)', 'research/**', 'supabase/functions/{public-research-submit,rotate-research-salt}', 'apps/mobile: surveys and feedback hub, admin survey dashboard, public research page'],
    work: 'Done: survey reads are table reads, the public research page reads its questions with `get_public_research_questions`, and the two missing capabilities were built in `90_research` (M16: `user_feedback` + `admin_user_feedback_list`; M17: `admin_survey_overview`, `admin_survey_results`, `admin_pmf_survey_report`, all moderator and above).',
    tests: ['vitest: survey, research, stats suites', 'pgTAP 079, 090, 091', 'deno test supabase/functions/public-research-submit'],
    degrade: 'Survey prompt: a failing `check_survey_prompt_eligibility` means "do not prompt" (the banner already fails silently). A research function that is not deployed (HTTP 404) is `BackendUnavailableError` and the page shows its generic error.',
    risks: '`record_active_day` is core and moves with P1; `stats/**` moves with P2.' },
  { id: 'L6', title: 'Back-office tools: tasks, CRM, timesheets', launch: 'later', parallelWith: ['L1', 'L2', 'L3', 'L4', 'L5', 'L7'],
    select: (row) => /^(admin_task_|crm_|timesheet_)/.test(row.old),
    files: ['admin/SupabaseAdminTaskRepository.ts', 'admin/SupabaseCrmContactsRepository.ts', 'admin/SupabaseTimesheetsRepository.ts', 'apps/mobile: admin tasks, CRM, timesheets screens'],
    work: 'Done: rebuilt as forward migrations `0034` (tasks), `0035` (CRM per organization) and `0036` (timesheets decided by the direct manager); the three adapters call them again, with keyset paging.',
    tests: ['pgTAP: 099_back_office_tasks, 100_back_office_crm, 101_back_office_timesheets', 'vitest: SupabaseAdminTaskRepository, SupabaseCrmTimesheetsRepository, adminSectionAvailability, backOfficeDestinations'],
    degrade: 'One switch per tool in apps/mobile/src/lib/parkedFeatures.ts (`ADMIN_TASKS_AVAILABLE`, `CRM_AVAILABLE`, `TIMESHEETS_AVAILABLE`, all on); a tool switched off hides its nav entry and renders the not-available notice.',
    risks: 'None known.' },
  { id: 'L7', title: 'WhatsApp bot, linking, admin console', launch: 'later', parallelWith: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'],
    select: (row) => /^(api_whatsapp|api_bot|whatsapp_)/.test(row.old),
    files: ['admin/SupabaseWhatsAppAdminRepository.ts', 'whatsapp/SupabaseWhatsAppLinkRepository.ts', 'supabase/functions/{whatsapp-webhook,whatsapp-sender}', 'supabase/functions/_shared/whatsapp/**', 'apps/mobile: admin WhatsApp console, Settings → WhatsApp'],
    work: 'Done: the `integrations` module (five `whatsapp_*` migrations); the webhook and sender deploy (the intake worker is retired); the admin console adapter pages by cursor and adds the review queue, templates and send limits; the member link port backs Settings → WhatsApp with the match-alert switch.',
    tests: ['pgTAP: 102_whatsapp_channel, 103_whatsapp_linking_bot, 104_whatsapp_admin, 105_whatsapp_match_alerts_jobs', 'deno test supabase/functions', 'vitest: SupabaseWhatsAppAdminRepository, SupabaseWhatsAppLinkRepository, WhatsAppAdminScreen, whatsappLinkScreen'],
    degrade: '`WHATSAPP_BOT_AVAILABLE` is on; the launch flag `launch_whatsapp_bot_enabled` still hides the settings row and the admin nav entry per environment. The functions do nothing until the channel is switched on and the Meta secrets exist.',
    risks: 'None for launch.' },
];

// ═════════════════════════════ Edge Functions
// verdict: keep (no database change) · retarget (same job, renamed objects) · rewrite · obsolete · park · done
export const edgeFunctions = [
  { name: 'dispatch-notification', verdict: 'done', uses: 'kc_private.notifications_deliver_batch, notification_push_retry_batch, notification_push_settle (direct Postgres)', change: 'Already rewritten for the baseline.' },
  { name: 'embed-worker', verdict: 'done', uses: 'embedding_jobs_claim, embedding_job_store, embedding_job_fail', change: 'Retargeted: the claimed job carries `post_id`; the caller must present the service-role key itself (a JWT claiming the role is refused).' },
  { name: 'match-rerank', verdict: 'done', uses: 'api_match_llm_pending, api_match_llm_store', change: 'Retargeted: a store of an unknown pair (`match_not_found`) counts as failed; service-role key only.' },
  { name: 'payments-webhook', verdict: 'done', uses: 'provider_webhook_apply', change: 'Retargeted: the provider\'s HMAC-SHA256 signature is verified (secret `PAYMENTS_WEBHOOK_SECRET_<SLUG>`, fail closed), the provider\'s own event id is the idempotency key (never generated), and `verify_jwt` is off for it in `supabase/config.toml`.' },
  { name: 'revenuecat-webhook', verdict: 'done', uses: 'api_revenuecat_set_pro', change: 'Verified against the baseline signature; no change.' },
  { name: 'public-research-submit', verdict: 'done', uses: 'get_research_salt, submit_public_research_response', change: 'Retargeted: the salt comes from `get_research_salt()`; `invalid_input` maps to 400.' },
  { name: 'rotate-research-salt', verdict: 'done', uses: 'rotate_research_salt', change: 'Retargeted: calls `rotate_research_salt()`; service-role key only.' },
  { name: 'translate', verdict: 'done', uses: 'content_translations (select, insert, delete)', change: 'Retargeted: the source registry follows the cache\'s content types (`post`, `comment`, `message`, `user`) over `posts`, `post_comments`, `messages`, `users` keyed by `id`; `ride_listing` is gone (rides are posts).' },
  { name: 'validate-donation-link', verdict: 'done', uses: 'donation_links (select, insert, update), get_my_admin_roles', change: 'Retargeted: new and edited links start in `review_status = pending`, the giving world is checked by the foreign key, the super-admin check reads the caller\'s roles; split into handler and SSRF guard.' },
  { name: 'delete-account', verdict: 'obsolete', uses: 'none', change: 'Deleted: the app calls `request_account_deletion()` itself.' },
  { name: 'purge-deleted-accounts', verdict: 'rewrite', uses: 'accounts_due_for_purge, account_purge_media_paths, delete_account_data_for', change: 'None of the three is exposed. Rewrite like `dispatch-notification`: `kc_private.accounts_due_for_purge` over Postgres, media paths from `post_media`, storage removal, then `auth.admin.deleteUser` (foreign keys cascade; billing is detached by trigger).' },
  { name: 'receipts-issuer', verdict: 'obsolete', uses: 'none', change: 'Deleted: the database issues the receipt when a payment settles.' },
  { name: 'subscriptions-charger', verdict: 'done', uses: 'api_standing_orders_charge_due', change: 'Retargeted: opens the due charges through the RPC. No payment provider is integrated, so submission to the provider is a port that is not wired yet.' },
  { name: 'reconcile-storage-orphans', verdict: 'retarget', uses: 'media_assets (select), bucket post-images', change: 'Read `post_media.storage_key` (+ `storage_bucket`).' },
  { name: 'strip-exif', verdict: 'done', uses: 'bucket post-images', change: 'Verified; storage only. Only its header comment changed.' },
  { name: 'backfill-image-thumbs', verdict: 'done', uses: 'buckets passed at run time', change: 'Service-role key only (a JWT claiming the role is refused); buckets `post-images` and `avatars`; one-off tool, may be dropped after the cut-over.' },
  { name: 'mock-login', verdict: 'obsolete', uses: 'none', change: 'Deleted: demo users are dev seed data (design §9).' },
  { name: 'whatsapp-webhook', verdict: 'done', uses: 'api_whatsapp_* webhook RPCs and the agent\'s api_bot_* tools', change: 'Retargeted: the agent searches with `api_bot_search_posts`, posts with `api_bot_publish_post` (draft outcomes told to the user), lists with `api_bot_my_posts`; an `inactive` member gets no agent and no upsell. Deployed.' },
  { name: 'whatsapp-intake-worker', verdict: 'obsolete', uses: 'none', change: 'Deleted: the agent\'s posting tool replaces it, and `api_bot_find_matches` is gone.' },
  { name: 'whatsapp-sender', verdict: 'done', uses: 'api_whatsapp_channel_config, api_whatsapp_outbound_*', change: 'Retargeted: reads the channel through `api_whatsapp_channel_config()`; started by the `whatsapp_send` job. Deployed.' },
];

// ═════════════════════════════ Rules that hold across the whole map
export const notes = [
  'Every identity capability the baseline lacked is now built: the blocked-users list (M01, `0015`), follow suggestions (M03), the completeness nudge (M04) and the About roster (M08, all `0031`).',
  'The internal back-office tools (formerly M19) were rebuilt after the baseline as forward migrations: the admin task tracker (FR-ADMIN-018, `0034`), CRM contacts per organization (FR-ADMIN-032, `0035`) and staff timesheets (FR-ADMIN-033, `0036`).',
  'Errors: every baseline RPC raises `P0001` with a stable snake_case message (`unauthenticated` uses `42501`). Map on `error.message`, never on a SQLSTATE or on Hebrew text. Codes marked † in the tables are not referenced anywhere in the app today and need a user-visible mapping.',
  'Paging: no OFFSET anywhere. Lists take the `next_cursor` JSON of the last row (cards) or explicit `p_before_*` / `p_after_*` values; application ports that expose `offset` change to an opaque cursor.',
  'Money: integer agorot (`*_agorot`), never ILS floats or `*_cents` names.',
  'Lists of posts return `post_card` (post, owner, city name, cover, counters, viewer state): no follow-up queries for owners, media or counters.',
  'Status columns are never client-writable; every move is an RPC checked by the FSM kernel.',
  'Signed-out access: only `legal_documents` and `legal_document_versions`. Every other call needs a session.',
  'Workers that need `kc_private` connect over Postgres (as `dispatch-notification` does); only `public` is reachable through the HTTP API.',
];
