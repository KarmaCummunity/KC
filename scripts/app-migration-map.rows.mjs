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
table('post_private_locations', 'same', 'table:post_private_locations', 'The exact street and number, readable and writable by the post\'s owner only; other members see the city.');
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
rpc('get_public_research_questions', 'changed', 'rpc:get_public_research_questions', 'Same signature, but service role only in the baseline (nothing is granted to signed-out callers): the public research page loads its questions through the `public-research-submit` function (`{ action: \'questions\', slug }`), which calls it.');

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
rpc('admin_org_application_approve', 'changed', 'rpc:admin_org_application_approve', 'New required `p_slug`; returns the organization id.');
rpc('admin_org_application_reject', 'same', 'rpc:admin_org_application_reject', 'Signature unchanged.');
// Admin tasks, CRM and timesheets (old M19): the baseline has none of them and the adapters make
// no call (package L6, `notes`).
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
rpc('finance_ledger_mark', 'same', 'rpc:finance_ledger_mark', 'Voids an entry with a reason (the admin delete action) or sets its reconciliation; the entry stays in the books.');
rpc('finance_donors_summary', 'changed', 'rpc:finance_donors_summary', 'New required `p_org_id`; `total_cents` → `total_agorot`; in-app donations grouped by member, typed ones by party name; organization admins only (M21, built in `85_billing/140`).');
table('org_applications', 'same', 'table:org_applications', 'The review queue, read directly by platform admins (policy `org_applications_select_reviewers`) with an exact count.');

// ───────────────────────────── translation, notifications
rpc('get_post_translations', 'same', 'rpc:get_post_translations', 'Signature unchanged.');
table('content_translations', 'changed', 'table:content_translations', 'Clients read only; the cache is written by the `translate` function with the service role. `id` is gone (key: content + field + language).');
for (const name of ['notifications_page', 'notifications_unread_count', 'notifications_mark_read', 'notifications_mark_all_read']) {
  rpc(name, 'same', `rpc:${name}`, 'Already moved to the baseline contract.');
}
table('user_devices', 'same', 'table:user_devices', 'Already moved to the baseline contract.');

// ───────────────────────────── WhatsApp bot and dev helpers
for (const name of [
  // The link screen and the admin console make no call while M22 is open (package L7); these are
  // the parked Edge Functions' own calls.
  'api_whatsapp_llm_budget_take', 'api_whatsapp_queue_reply',
  'api_whatsapp_outbound_claim', 'api_whatsapp_outbound_result', 'api_whatsapp_claim_inbound',
  'api_whatsapp_release_inbound', 'api_whatsapp_inbound_allowed', 'api_whatsapp_ingest_inbound',
  'api_whatsapp_handle_keyword', 'api_whatsapp_redeem_link_code', 'api_whatsapp_bot_access',
  'api_bot_search_listings', 'api_bot_listing_cards', 'api_bot_open_session', 'api_bot_apply_extraction',
  'api_bot_publish_listing', 'api_bot_my_listings', 'api_bot_my_matches', 'api_bot_find_matches',
]) rpc(name, 'missing', null, 'The `integrations` schema is reserved but empty: the WhatsApp module lands later as one additive migration (design Q4).', { m: 'M22' });
table('whatsapp_channel_config', 'missing', null, 'Same: no `integrations` tables yet.', { m: 'M22' });

// ───────────────────────────── Edge Function workers (service role)
rpc('embedding_jobs_claim', 'renamed', 'rpc:embedding_jobs_claim', 'Returned `listing_id` → `post_id`.');
rpc('embedding_job_store', 'same', 'rpc:embedding_job_store', 'Signature unchanged.');
rpc('embedding_job_fail', 'same', 'rpc:embedding_job_fail', 'Signature unchanged.');
rpc('api_match_llm_pending', 'same', 'rpc:api_match_llm_pending', 'Signature unchanged.');
rpc('api_match_llm_store', 'changed', 'rpc:api_match_llm_store', 'Returns void (was boolean): an unknown pair raises `match_not_found`.');
rpc('provider_webhook_apply', 'same', 'rpc:provider_webhook_apply', 'Signature unchanged; errors are stable snake_case messages.');
rpc('api_revenuecat_set_pro', 'same', 'rpc:api_revenuecat_set_pro', 'Signature unchanged.');
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
channel('topic', 'same', 'client:openExactTopicChannel', 'The shared helper itself: unchanged, it opens whatever private topic it is given.');

// ───────────────────────────── Edge Function invokes from the app
edge('public-research-submit', 'same', 'edge:public-research-submit', 'Same invoke for a response; the function keeps calling `submit_public_research_response`. It also serves the form\'s questions (`{ action: \'questions\', slug }` → `get_public_research_questions`).');
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
rpc('accept_world_consent', 'same', 'rpc:accept_world_consent', 'Accepts the driver declaration in force (`p_kind`, `p_version`); `consent_version_stale` for an old version.');
rpc('my_matches', 'same', 'rpc:my_matches', 'The caller\'s pairs, each with the other member\'s post as a card (`other_post`).');
rpc('admin_match_quality', 'same', 'rpc:admin_match_quality', '`p_days` (clamped 1..365); per giving world the alerted pairs, answers, acceptances, chats after the alert and completed handoffs, rates as numerics. Moderators and above (`forbidden` otherwise); lives in `76_matching/070_match_quality.sql`.');
rpc('match_respond', 'same', 'rpc:match_respond', '`p_match_id`, `p_accept`; answers the pair\'s status (`accepted` when both accepted).');
table('post_ride_details', 'same', 'table:post_ride_details', 'Read for the route, time and seats of a ride and for the occurrences of a series; the owner edits it through the adapter.');
table('post_event_details', 'same', 'table:post_event_details', 'Read for an event\'s window, capacity and policy; the organizer edits it through the adapter.');
table('post_food_details', 'same', 'table:post_food_details', 'Read for a food offer\'s expiry and contents; the giver edits it through the adapter.');
table('worlds', 'same', 'table:worlds', 'The world labels shown on a listing detail.');
table('organizations', 'same', 'table:organizations', 'The routed worlds\' body picker (organizations by name).');
table('road_junctions', 'same', 'table:road_junctions', 'The junctions of the ride place catalog (name and position).');
table('user_consents', 'same', 'table:user_consents', 'The acceptance record of the driver declaration.');
table('post_ratings', 'same', 'table:post_ratings', 'The rater reads back the ratings they wrote, to mark a booking "rated by me".');

// ═════════════════════════════ MISSING: what the baseline does not provide
// action: build (add to the baseline) · rls-read (already possible, no new object) · drop · defer (behind a flag)
export const missing = [
  { id: 'M22', title: 'WhatsApp bot, linking and admin console', usedBy: 'Three Edge Functions (webhook, intake worker, sender) — 19 RPCs and one table; the mobile link screen and the admin WhatsApp console are parked and make no call', spec: 'design Q4 (PM): not in the launch baseline', launch: 'no', action: 'defer', recommendation: 'Do not deploy the three functions; hide the link screen and the admin console behind a flag until the `integrations` module lands.' },
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
    work: 'Done in P0 (see docs/db/app-migration-playbook.md): `database.types.ts` is the generated baseline types and `database.legacy.types.ts` a frozen copy of the old ones, imported only by the files listed in `infrastructure-supabase/src/migrationStatus/<package>.ts` (the client factory is generic: `getSupabaseClient()` is baseline-typed, `getLegacySupabaseClient()` / `legacySupabase` are the same connection typed against the old schema). `FSM_MACHINES` equals the baseline seeds (`catalogMatchesSql.test.ts` reads `supabase/schemas`); the four machines without a baseline seed sit in `LEGACY_FSM_MACHINES` until L2, L6 and L7 move. `rpc/backendUnavailable.ts` holds `isBackendObjectMissing` and `rpc/mapRpcError.ts` the P0001 mapper and `unwrapCall`; `BackendUnavailableError` and `BackendRuleError` are domain errors. UI helpers: `apps/mobile/src/lib/backendAvailability.ts` and the `backend.*` locale keys. `src/__tests__/baselineCompatibility.test.ts` fails when an unlisted file still needs the old schema or a listed file no longer does.',
    tests: ['pnpm typecheck, pnpm test, pnpm lint from app/', 'src/fsm/__tests__/catalogMatchesSql.test.ts against supabase/schemas', 'src/__tests__/baselineCompatibility.test.ts', 'src/rpc/__tests__/degradeRule.test.ts', 'node --test scripts/*.test.mjs', 'node scripts/gen-baseline-types.mjs --check'],
    degrade: 'This package defines the rule for all others: an adapter call that hits a missing function or table throws `BackendUnavailableError`; a list screen shows its empty state, an action shows the generic "not available yet" message, a world whose `world_<slug>_enabled` flag is off never renders its entry points. No screen reads `error.message` of an unknown error.',
    risks: 'Everything depends on it and it must not change behaviour: no adapter logic changed, only its type import. CI still diffs `database.types.ts` against the old migrations until the workflow change listed in the P0 report lands.' },
  { id: 'P1', title: 'Identity: session start, profile, privacy, follow, block, legal, account deletion, devices', launch: 'core', parallelWith: [],
    select: either(inArea('auth', 'users', 'legal', 'blocks', 'social', 'cities', 'streets', 'about', 'notifications'), named(/^(record_active_day|avatars|topic = `user:.*notifications`)$/)),
    files: ['auth/**', 'users/**', 'legal/**', 'blocks/**', 'social/**', 'cities/**', 'streets/**', 'about/**', 'notifications/**', 'survey/SupabaseUserActivityRepository.ts', 'apps/mobile: auth gate, onboarding, settings, edit profile, avatar upload, notification badge hook, devIdentityVerification (deleted)'],
    work: 'Done in P1: the account gate, private profile, onboarding state and pending legal documents read `bootstrap_session`; `users/mapUserRow.ts` maps the public `users` row plus `user_stats` and, for the caller\'s own row, the `bootstrap_session` private blocks (`user_private`, `user_account`, staff roles); follows go through `follow_user`, `follow_request_decide` and `follow_request_cancel`; account deletion through `request_account_deletion` and `restore_account`; the account gate listens on `user:<id>:account`. M01, M03, M04 and M08 are hidden or empty (no call is made); the dev-only identity and onboarding helpers are gone.',
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
    files: ['chat/**', 'feed/SupabaseFeedRealtime.ts', 'rides/SupabaseRidesRealtime.ts', 'apps/mobile: chat screens, chat media, inbox and notification badge hooks'],
    work: 'Done in P3: the inbox is `chat_inbox_page`, messages are `chat_messages_page` and `send_message` (the optimistic id is `p_message_id`), a chat opens through `open_direct_chat` / `open_support_thread`, read receipts come from `chat_members.last_read_at` (the `read` broadcast), and the chat and inbox subscriptions are the private topics `chat:<id>:messages` and `user:<id>:chats`. The new-posts banner, global online presence and the rides feed updates have no baseline topic and are degraded (M24): they open nothing and report `BackendUnavailableError`.',
    tests: ['vitest: chat suites, realtime/exactTopicChannel tests', 'pgTAP 045, 050'],
    degrade: 'Before this package the chat tab shows an empty inbox and "contact" buttons on posts are disabled; a failed subscription is ignored (the screen refreshes on focus). After it: no green online dots, no live "new posts" pill, ride lists refresh on focus; the inbox preview of a system or media-only message carries no text and the counterpart verification badge is not shown in the inbox (the page RPC does not return them).',
    risks: 'Contact phone: `chat_counterpart_contact` (M06). Optimistic send passes `p_message_id`. The baseline keeps one chat per pair, so the second chat after a personal hide (`preferNewThread`) no longer exists; a ride or listing anchor is a post anchor.' },
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
    work: 'Done: survey reads are table reads, the public research page loads its questions through `public-research-submit`, and the two missing capabilities were built in `90_research` (M16: `user_feedback` + `admin_user_feedback_list`; M17: `admin_survey_overview`, `admin_survey_results`, `admin_pmf_survey_report`, all moderator and above).',
    tests: ['vitest: survey, research, stats suites', 'pgTAP 079, 090, 091', 'deno test supabase/functions/public-research-submit'],
    degrade: 'Survey prompt: a failing `check_survey_prompt_eligibility` means "do not prompt" (the banner already fails silently). A research function that is not deployed (HTTP 404) is `BackendUnavailableError` and the page shows its generic error.',
    risks: '`record_active_day` is core and moves with P1; `stats/**` moves with P2.' },
  { id: 'L6', title: 'Back-office tools: tasks, CRM, timesheets', launch: 'later', parallelWith: ['L1', 'L2', 'L3', 'L4', 'L5', 'L7'],
    select: (row) => /^(admin_task_|crm_|timesheet_)/.test(row.old),
    files: ['admin/SupabaseAdminTaskRepository.ts', 'admin/SupabaseCrmContactsRepository.ts', 'admin/SupabaseTimesheetsRepository.ts', 'apps/mobile: admin tasks, CRM, timesheets screens'],
    work: 'Done: nothing to migrate to (the baseline has no task tracker, CRM or timesheets, old M19). The three adapters make no call and reject with `BackendUnavailableError`; whether these internal tools belong in this database is still an open product decision.',
    tests: ['vitest: parkedBackOffice, parkedAdminSections'],
    degrade: 'Parked behind `BACK_OFFICE_TOOLS_AVAILABLE` (apps/mobile/src/lib/parkedFeatures.ts): the tasks nav entry and dashboard card are hidden, and the tasks, CRM and timesheets routes render the not-available notice.',
    risks: 'Product decision, not engineering.' },
  { id: 'L7', title: 'WhatsApp bot, linking, admin console', launch: 'later', parallelWith: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'],
    select: (row) => /^(api_whatsapp|api_bot|whatsapp_)/.test(row.old),
    files: ['admin/SupabaseWhatsAppAdminRepository.ts', 'supabase/functions/{whatsapp-webhook,whatsapp-intake-worker,whatsapp-sender}', 'supabase/functions/_shared/whatsapp/**', 'apps/mobile: WhatsApp link screen'],
    work: 'App side done: the admin console adapter makes no call and rejects with `BackendUnavailableError`, and the link screen is a not-available notice. The bot itself waits for the `integrations` module (M22, design Q4).',
    tests: ['deno test supabase/functions/_shared/whatsapp'],
    degrade: 'The three functions are not deployed; the settings row and the admin nav entry are hidden behind `WHATSAPP_BOT_AVAILABLE` (apps/mobile/src/lib/parkedFeatures.ts), and both routes render the not-available notice.',
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
  { name: 'public-research-submit', verdict: 'done', uses: 'get_public_research_questions, get_research_salt, submit_public_research_response', change: 'Retargeted: the salt comes from `get_research_salt()`; `invalid_input` maps to 400. Also serves the form\'s questions (`{ action: \'questions\', slug }`), since `get_public_research_questions` is service-role only.' },
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
  { name: 'whatsapp-webhook', verdict: 'park', uses: '8 api_whatsapp_* RPCs', change: 'No `integrations` objects yet (M22): not deployed at launch.' },
  { name: 'whatsapp-intake-worker', verdict: 'park', uses: 'api_bot_* and api_whatsapp_llm_budget_take', change: 'Same (M22).' },
  { name: 'whatsapp-sender', verdict: 'park', uses: 'whatsapp_channel_config, api_whatsapp_outbound_*', change: 'Same (M22).' },
];

// ═════════════════════════════ Rules that hold across the whole map
export const notes = [
  'Capabilities the baseline does not provide and the identity adapters therefore do not call (they report `BackendUnavailableError` and the screens degrade): the blocked-users list (M01, the screen shows its empty state; unblock from a profile is not reachable because `users_hide_blocked` hides it), follow suggestions (M03) and the profile completeness nudge (M04), both hidden on the suggestions screen, and the About team roster (M08, no team section).',
  'Internal back-office tools the baseline does not provide and whose adapters therefore make no call (they report `BackendUnavailableError`; the sections are parked behind `BACK_OFFICE_TOOLS_AVAILABLE`): the admin task tracker (FR-ADMIN-018), the CRM contacts (roadmap phase 3) and the timesheets (not in the spec), formerly M19. Whether they belong in this database is a product decision.',
  'Errors: every baseline RPC raises `P0001` with a stable snake_case message (`unauthenticated` uses `42501`). Map on `error.message`, never on a SQLSTATE or on Hebrew text. Codes marked † in the tables are not referenced anywhere in the app today and need a user-visible mapping.',
  'Paging: no OFFSET anywhere. Lists take the `next_cursor` JSON of the last row (cards) or explicit `p_before_*` / `p_after_*` values; application ports that expose `offset` change to an opaque cursor.',
  'Money: integer agorot (`*_agorot`), never ILS floats or `*_cents` names.',
  'Lists of posts return `post_card` (post, owner, city name, cover, counters, viewer state): no follow-up queries for owners, media or counters.',
  'Status columns are never client-writable; every move is an RPC checked by the FSM kernel.',
  'Signed-out access: only `legal_documents` and `legal_document_versions`. Every other call needs a session.',
  'Workers that need `kc_private` connect over Postgres (as `dispatch-notification` does); only `public` is reachable through the HTTP API.',
];
