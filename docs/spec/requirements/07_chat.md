# 2.7 Direct Messaging

> **Status:** ✅ Core Complete — 1-on-1 chat, realtime, anchor card, close-from-chat, **personal inbox hide (FR-CHAT-016)** shipped. `users_select_chat_counterpart` RLS tightened in migration `0031` (active / pending_verification only). ⚠️ Audit 2026-05-16: `messages_insert_user` regression (lost `removed_at` guard + missing `has_blocked` — TD-67 / TD-75, BACKLOG P2.12); FR-CHAT-013 AC1 silent on deleted-counterpart dedupe; FR-CHAT-016 AC4 silent on tie-break. See `docs/SSOT/archive/audit/2026-05-16/04_chat_notifications.md`.



Prefix: `FR-CHAT-*`

---

## Scope

1-on-1 text-only chat between two users:

- Inbox list and search.
- Conversation screen with text composition.
- Read receipts.
- Three entry points (post detail, user profile, support from Settings).
- Auto-message templating for post-anchored conversations.
- Block/report integration.
- Special handling for the Super Admin chat (anchored support thread).

Out of scope:

- Group chat, image / voice / video / location / file attachments, reactions, post sharing — all explicitly excluded by `R-MVP-Chat-1` and `R-MVP-Chat-2`.

---

## FR-CHAT-001 — Inbox list

**Description.**
The list of all of my conversations, sorted by latest activity.

**Source.**
- PRD: `03_Core_Features.md` §3.4.2, `05_Screen_UI_Mapping.md` §4.1.

**Acceptance Criteria.**
- AC1. Each row: counterpart avatar + name, latest message preview (1 line), relative timestamp, unread indicator.
- AC2. Sort by `last_message_at DESC`. Pinning is **not** in MVP.
- AC3. Search by counterpart name (case-insensitive prefix match) is provided in the top bar.
- AC4. Pagination: 30 conversations per page; infinite scroll.
- AC5. The Super Admin support thread (when present) is **not** pinned; it appears in the same chronological list as any other thread.
- AC6. When multiple non-support `Chat` rows exist for the same human counterpart (`FR-CHAT-016`), the inbox shows **one** row per counterpart (latest `last_message_at` among rows not inbox-hidden for me).

**Edge Cases.**
- A counterpart deleted their account: the row shows a "Deleted user" placeholder; the thread remains accessible (`D-14`).
- A counterpart is now blocked by me: the row is filtered out unless I open the blocked-users management screen (`FR-SETTINGS-005`).

**Related.** Screens: 4.1 · Domain: `Chat`.

---

## FR-CHAT-002 — Conversation screen

**Description.**
1-on-1 conversation thread with composition controls.

**Source.**
- PRD: `03_Core_Features.md` §3.4.3, `05_Screen_UI_Mapping.md` §4.2.

**Acceptance Criteria.**
- AC1. Header: back button, counterpart avatar + name, `⋮` menu (`View profile`, `Block`, `Report conversation`).
- AC2. Body: message bubbles (mine right-aligned in LTR, left-aligned in RTL; opposite for counterpart). Each bubble shows timestamp on tap (includes a short date when the message is not from the current local calendar day). A centered **day separator** (today / yesterday / full weekday date) is shown between messages when the thread crosses into a new local calendar day so the hour-only default is not ambiguous.
- AC3. Composer: single-line auto-growing text input + send button. **No** attachment buttons (`R-MVP-Chat-2`).
- AC4. Read receipt: a `✓✓` indicator is shown next to a sent message once the counterpart's client confirms reading. Read receipts cannot be turned off in MVP (`R-MVP-Chat-5`).
- AC5. Maximum message length: 2,000 characters. Inputs longer are blocked with an inline counter.

**Related.** Screens: 4.2 · Domain: `Chat`, `Message`.

---

## FR-CHAT-003 — Send message

**Description.**
Submitting the composer creates a `Message` and pushes it to the recipient.

**Source.**
- PRD: `03_Core_Features.md` §3.4.3.

**Acceptance Criteria.**
- AC1. The message is appended optimistically to the local thread; on server ack, it transitions from `pending` to `delivered`; on read it transitions to `read`.
- AC2. End-to-end delivery latency target ≤500 ms at p95 (`NFR-PERF-006`); the indicator transitions accordingly.
- AC3. On network failure, the bubble shows a retry icon; tapping retries.
- AC4. The recipient receives a notification (`FR-NOTIF-001`) — Critical category — unless their notification preferences disable it.

**Edge Cases.**
- Sending to a blocked-by-counterpart user fails silently from my side (the message ack returns success; the counterpart never sees it). This intentional opacity is part of `R-MVP-Privacy-3`.
- Sending to a deleted user fails with a friendly error: *"This user is no longer available."*

**Related.** Domain: `Message`, `Notification`.

---

## FR-CHAT-004 — Conversation context anchoring

**Description.**
Conversations may be anchored to a specific post for purposes of recipient-picker logic and the auto-message.

**Source.**
- PRD: `03_Core_Features.md` §3.4.4, `04_User_Flows.md` Flow 6.
- Constraints: `R-MVP-Chat-3`.

**Acceptance Criteria.**
- AC1. A `Chat` between two users may have an `anchor_post_id`. By default the same conversation is reused regardless of which post was the entry trigger; the first anchor wins on that `chat_id`, but newer anchors are tracked as `Chat.anchor_history` for analytics. **Exception (`FR-CHAT-016`, D153):** after a member removes the chat from their own inbox, contacting the same counterpart again opens a **new, clean thread for that member**: the pair keeps one `Chat` row, but the member's history starts at the moment of the hide (`chat_members.history_from`, migration `0028`), so none of the old messages, previews or unread counts reach them again. The counterpart keeps the whole conversation.
- AC2. The conversation can also be opened directly from the counterpart's profile (`FR-CHAT-006`); in that case `anchor_post_id` is null.
- AC3. The Super Admin support thread (`FR-CHAT-007`) sets `is_support_thread = true` to mark it for special UI treatment in the future, even if it does not differ functionally in MVP.

**Edge Cases.**
- The anchored post is later deleted, closed, removed, or expired: the anchored-post card (FR-CHAT-014) is hidden. Existing messages remain — including the system message emitted by the closure trigger (FR-CHAT-015 AC4-AC6) when the transition was a delivery-related close.

**Related.** Domain: `Chat`, `Post`.

---

## FR-CHAT-005 — Auto-message for post-anchored chats

**Description.**
When a conversation is opened via a post's "Send Message" CTA, the composer is pre-filled with a templated message.

**Source.**
- PRD: `03_Core_Features.md` §3.4.5, `04_User_Flows.md` Flow 6.
- Constraints: `R-MVP-Chat-4`.

**Acceptance Criteria.**
- AC1. Template (Hebrew baseline, localized via i18n): *"Hi! I saw your post about [post title]. I'd like to know more."*
- AC2. The template is editable before sending; sending unchanged is allowed.
- AC3. Sending the auto-message creates a real `Message` row (no special "auto" type) and emits the analytics event `chat_first_message` with `from_post = true`.
- AC4. If the counterpart has already received this exact auto-message before for the same post (within the same `Chat`), opening the post and tapping "Send Message" deep-links to the existing thread without re-prefilling.

**Related.** Screens: 4.2 · Domain: `Chat`, `Message`.

---

## FR-CHAT-006 — Open chat from a profile

**Description.**
The "Send Message" CTA on Other Profile opens or resumes a conversation with that user.

**Source.**
- PRD: `03_Core_Features.md` §3.4.4.
- Constraints: `R-MVP-Chat-3`.

**Acceptance Criteria.**
- AC1. Available regardless of the target's privacy mode (DMs are not gated by follow approval).
- AC2. If a `Chat` already exists with this user, the existing thread is opened; otherwise a new `Chat` is created with `anchor_post_id = null`.
- AC3. The composer is empty (no auto-message).

**Related.** Screens: 3.3.

---

## FR-CHAT-007 — Open support thread from Settings

**Description.**
The "Report an issue" CTA in Settings opens or resumes the user's chat thread with the Super Admin.

**Source.**
- PRD: `03_Core_Features.md` §3.4.4 (3rd entry point), §3.5.
- Constraints: `R-MVP-Chat-3`.

**Acceptance Criteria.**
- AC1. Resolves the Super Admin's `User` record by the canonical email `karmacommunity2.0@gmail.com`.
- AC2. If a `Chat` between me and the Super Admin already exists, that thread is reused; otherwise a new one is created with `is_support_thread = true`.
- AC3. The Settings flow that triggers this also injects a system-message into the thread summarizing the report (`FR-MOD-002`); after injection, the user is dropped onto the conversation screen to continue freely.

**Related.** Screens: 5.1, 4.2.

---

## FR-CHAT-008 — Restricted entry-points policy

**Description.**
A chat cannot be opened "out of the blue" from arbitrary surfaces.

**Source.**
- PRD: `03_Core_Features.md` §3.4.4.
- Constraints: `R-MVP-Chat-3`.

**Acceptance Criteria.**
- AC1. The only valid entry points to a new chat are: (a) Post Detail (`FR-CHAT-005`), (b) Other Profile (`FR-CHAT-006`), (c) Settings → Report an Issue (`FR-CHAT-007`), **(d) Donations · Time → Volunteer Message Composer (`FR-DONATE-004`)** — this entry-point routes to the same Super Admin support thread as (c) (`is_support_thread = true`); it does not create a duplicate thread. **MVP-core deferral:** until P0.5 chat ships, the Donations · Time composer stores intent locally (see `FR-DONATE-004` AC3 / TD-114) and shows a success alert; it does not navigate to chat.
- AC2. ~~There is no "Compose new chat" button anywhere in the app.~~ **Superseded** by `FR-CHAT-017` (D126): the Inbox has one "+" that opens a recipient picker. No other surface offers a free-form "compose" action.
- AC3. Resuming an existing chat is allowed from the Inbox (`FR-CHAT-001`).

---

## FR-CHAT-009 — Block / unblock effects on chat

**Description.**
Blocking a counterpart filters and gates chat behavior.

**Source.**
- PRD: `03_Core_Features.md` §3.5.
- Constraints: `R-MVP-Privacy-3`.

**Acceptance Criteria.**
- AC1. When I block a user, our existing `Chat` (if any) is hidden from my Inbox; the counterpart still sees the thread but cannot send messages to me.
- AC2. When I unblock the user (per `D-11`), the thread reappears in my Inbox; the counterpart's send capability is restored.
- AC3. The counterpart never receives an explicit notification that I blocked them; their send attempts succeed-locally and remain undelivered.

**Related.** Domain: `Block`, `Chat`.

---

## FR-CHAT-010 — Reporting a conversation

**Description.**
Reporting from the conversation `⋮` menu treats the entire thread as the report target.

**Source.**
- PRD: `04_User_Flows.md` Flow 9.A.

**Acceptance Criteria.**
- AC1. The Report modal (`FR-MOD-001`) opens with `target_type = chat` and `target_id = chat.id`.
- AC2. The Super Admin's chat receives a system message linking to the conversation snapshot and reason (`FR-ADMIN-001`).

**Related.** Domain: `Report`.

---

## FR-CHAT-011 — Read receipts

**Description.**
A message is marked `read` when the recipient's conversation screen renders it for the first time.

**Source.**
- PRD: `03_Core_Features.md` §3.4.3.
- Constraints: `R-MVP-Chat-5`.

**Acceptance Criteria.**
- AC1. The read transition is performed server-side on a "viewed" event from the recipient's client; client-side rendering alone is not sufficient.
- AC2. Bulk-read API: opening a thread with N unread messages emits a single batch event to mark them all read.
- AC3. Read receipts cannot be disabled in MVP.
- AC4. The bulk-read RPC covers **every** unread message in the thread regardless of `kind`. System messages (`kind='system'`, `sender_id IS NULL`) — e.g. "post closed", admin report bubbles, moderation notices — are counted by `rpc_chat_unread_total` and therefore must also be cleared by `rpc_chat_mark_read`. Migration `0054` aligns the two so the inbox-row badge and the topbar badge settle to 0 after a single thread visit.

**Related.** Domain: `Message.status`.

---

## FR-CHAT-012 — Unread badge on top bar

**Description.**
The chat icon in the top bar carries a badge with the unread-message count.

**Source.**
- PRD: `06_Navigation_Structure.md` §6.2.

**Acceptance Criteria.**
- AC1. The badge shows the total unread message count across all conversations, capped visually at "9+".
- AC2. The count updates within `NFR-PERF-005` of new messages arriving via Realtime.
- AC3. Opening a thread updates the count immediately on the local client (optimistic) and reconciles with server upon ack.
- AC4. Chats the viewer has inbox-hidden (`FR-CHAT-016`) do not contribute unread to the badge until the hide flags are cleared.

**Implementation note (mobile).** The Zustand chat store uses an `inboxSnapshotEpoch` when applying full inbox snapshots from `getMyChats` + `getUnreadTotal` so a slow initial load cannot overwrite counts after `markChatLocallyRead` has already cleared them. Debounced `rpc_chat_unread_total` from inbox Realtime is merged with per-row unread (and dropped if the epoch changed during the RPC); incoming message INSERT bumps the matching inbox row so new unreads are not suppressed by that merge.

**Related.** Domain: `Chat`, `Message`.

---

## FR-CHAT-013 — Conversation retention after account deletion

**Description.**
When one party deletes their account, the other party retains the thread with a placeholder.

**Source.**
- Decisions: `D-14`.
- Constraints: `R-MVP-Privacy-6`.

**Acceptance Criteria.**
- AC1. When a `User` is hard-deleted, the messages they sent are kept in the thread for the counterpart but their identity is replaced with a `Deleted user` placeholder (with a generic avatar).
- AC2. The deleted user's own messages cannot be edited, replied to, or quoted; the thread is read-only from the counterpart's side **except** that they can still send messages — those messages are accepted and persisted but never delivered (no recipient).
- AC3. After 90 days of read-only state, the thread is auto-archived (hidden from Inbox unless the user opens the Archived view in V1.5+; not part of MVP, so the thread stays visible but stale).

**Edge Cases.**
- The counterpart re-registers with the same identifier after the 30-day cooldown (`FR-AUTH-016`): they get a fresh account; the old thread does not link to them.

**Related.** Domain: `Chat`, `Message`, `User`.

---

## FR-CHAT-014 — Anchored-post card in chat

**Description.**
A sticky card at the top of the conversation surfaces the anchored post for both participants while the post is still `open`.

**Source.**
- PRD: `03_Core_Features.md` §3.4.4.
- Spec: `docs/SSOT/archive/superpowers/specs/2026-05-11-close-post-from-chat-design.md`.

**Acceptance Criteria.**
- AC1. When `Chat.anchor_post_id` is set and the referenced `Post` is in status `open`, a sticky card is shown beneath the chat header with: a square preview of the first post image (public Storage URL) when `media_assets` is non-empty, otherwise a type icon placeholder (Give / Request); post-type tag; single-line title; an optional `tel:` quick-call link (AC7); and a right-aligned action area. The card uses elevated surface styling (rounded corners, light shadow, inset horizontal margin) so it reads as a compact preview strip rather than a full-width divider bar.
- AC2. The owner sees a "סמן כנמסר ✓" / "סמן שקיבלתי ✓" CTA in the action area (label flips by `post.type`, matching `OwnerActionsBar`). The counterpart sees the whole card as a tap-to-open-post surface routing to `/post/[id]`.
- AC3. The card is hidden entirely when the post is in any non-`open` status (`closed_delivered`, `deleted_no_recipient`, `removed_admin`, `expired`) — replacing the prior "banner when deleted" behaviour from FR-CHAT-004.
- AC4. The card is hidden when `anchor_post_id` is null (chat opened from Other Profile, support thread, etc.).
- AC5. Status changes propagate to the card without a manual refresh: when a `post_closed` system message (FR-CHAT-015) lands in the thread, the post query is invalidated and the card hides immediately.
- AC6. (P1.2.x) Re-anchor on entry from a different post: when a user opens an existing chat through "💬 שלח הודעה למפרסם" from a post `Y` whose ID differs from the chat's current `anchor_post_id`, `chats.anchor_post_id` is updated to `Y` and the card reflects `Y` on the next render. When the call carries no anchor (inbox/profile flow), the existing `anchor_post_id` is left unchanged. When the anchored post is closed, `chats.anchor_post_id` is cleared by the closure trigger (see FR-CLOSURE-001 AC-NEW) so the next entry from a different post re-anchors cleanly. Realtime propagates the new row to both participants — the card swaps without a screen reload.
- AC7. **Counterpart contact-phone quick-call (FR-AUTH-010 AC2.c / FR-PROFILE-007 AC1):** When the chat counterpart (the participant who is NOT the current viewer) has a non-null `users.contact_phone`, the card renders a small tappable phone row that opens `tel:<contact_phone>` via `Linking.openURL`. Hidden when the counterpart is null (deleted account), the field is null, or the chat is the Super Admin support thread. No verification, no E.164 normalization — the value goes through to the OS dialer verbatim. Tapping does not navigate inside the app.
- AC8. (KC#1297) **Listing context.** A chat started from an items / food / donation listing ("start chat" on the listing, `start_listing_chat`) reuses the pair's chat by the same rule as the DM flow (latest ordinary chat the caller has not hidden, FR-CHAT-016) or creates one, and sets `chats.anchor_listing_id`. While the listing is visible to the viewer (`is_listing_visible_to`), a sticky listing card shows beneath the chat header: first photo or the world icon, give/request tag, title, world and kind; tapping it opens the listing.
- AC9. (KC#1412) **Starting a listing chat fails visibly.** Rides listings (offers and requests, native or synced from `ride_listings`) start their chat the same way as AC8. When the server refuses, the listing shows why: sign in first (`auth_required`), the account is not active (`account_not_active`), the listing is no longer available (`forbidden`), or it is the viewer's own listing (`cannot_chat_self`). Any other failure shows a generic "try again" message and is reported to error monitoring with the action name and Postgres code. Guarded by `supabase/tests/flows/rides_listing_chat.sql` and `ListingDetailActions.test.tsx`.
- AC9. (KC#1297) **One context per chat.** The chat shows the entry point it was last opened from (extends AC6): entry from a listing sets `anchor_listing_id` and clears `anchor_post_id` / `anchor_ride_id`; entry from a post or a ride clears `anchor_listing_id` (`0464`). Precedence when rendering: ride, then listing, then post.

**Related.** Screens: 4.2 · Domain: `Chat`, `Post` · Spec: `docs/SSOT/archive/superpowers/specs/2026-05-11-chat-post-anchor-lifecycle-design.md`.

---

## FR-CHAT-015 — Close post from chat

**Description.**
The post owner can mark the anchored post as delivered (or close without a recipient) directly from the chat, without navigating back to post detail. The chat counterpart is pre-filled as the recipient.

**Source.**
- PRD: `03_Core_Features.md` §3.4.4.
- Spec: `docs/SSOT/archive/superpowers/specs/2026-05-11-close-post-from-chat-design.md`.

**Acceptance Criteria.**
- AC1. Tapping the CTA on the anchored-post card (FR-CHAT-014 AC2) opens the existing closure sheet (`ClosureSheet`) directly on step 2 (recipient picker) with the chat counterpart pre-selected.
- AC2. The owner can confirm with one tap ("סמן וסגור ✓"), pick a different recipient from the candidates list, or take the no-recipient branch via "סגור בלי לסמן" — same UI as the post-screen entry point.
- AC3. On successful close, the post transitions to `closed_delivered` (with recipient) or `deleted_no_recipient` (without); the card hides in every anchored chat; a system message is emitted to every anchored chat (AC4-AC6).
- AC4. In the chat used for the close, delivered path: system message body is "הפוסט סומן כנמסר ✓ · תודה!".
- AC5. In sibling chats (anchored to the same post), delivered path: system message body is "הפוסט נמסר למשתמש אחר".
- AC6. In all anchored chats, no-recipient path: system message body is "המפרסם סגר את הפוסט — הפריט לא נמסר".
- AC7. The fan-out in AC4-AC6 fires regardless of where the close was triggered (post detail screen, chat, or any future entry point) — implemented by an `AFTER UPDATE OF status ON posts` trigger.

**Edge Cases.**
- The owner's chat list contains chats with users who never messaged about THIS post (per the 0017 RPC relaxation). The pre-fill picks the counterpart of THIS chat, not the post's recipient-candidate list.
- The owner reopens the post later: the card reappears (it only depends on `post.status === 'open'`). Past system messages are preserved.

**Related.** Screens: 4.2 · Domain: `Chat`, `Message`, `Post`.

---

## FR-CHAT-016 — Personal inbox hide (“delete for me”)

**Description.**
The user can remove a conversation from **their own** inbox without deleting it for the counterpart. Not available for the Super Admin support thread (`FR-CHAT-007`).

**Source.**
- Design: `docs/SSOT/archive/superpowers/specs/2026-05-11-chat-personal-delete-design.md`
- Plan: `docs/SSOT/archive/superpowers/plans/2026-05-11-chat-personal-delete.md`

**Acceptance Criteria.**
- AC1. Entry points: inbox row overflow and conversation `⋮` menu (support thread excluded).
- AC2. Confirmation modal before hide; copy explains counterpart retention and that a new message in the same thread can restore the row to the inbox.
- AC3. After hide, opening a DM with the same user from a profile or post CTA opens a thread that is **empty for the opener**: the hide also starts the opener's history at that moment (D153, migration `0028`). The pair keeps one chat row; the counterpart still sees every message. The support thread cannot be hidden.
- AC4. Inbox shows **at most one row per human counterpart** (one chat per pair).
- AC5. Any new `messages` row on a chat clears the inbox-hide flag for that chat (the thread reappears), with only the messages after the hide for the member who hid it.
- AC6. Unread badge (`FR-CHAT-012`) excludes messages in chats inbox-hidden for the viewer, and messages from before the viewer's hide once the chat returns.

**Status.** ✅ Implemented (migration `0028_chat_fresh_thread.sql`, test `supabase/tests/054_chat_fresh_thread.sql`; app `forgetHiddenChat`).

**Related.** Screens: 4.1, 4.2 · Domain: `Chat`, `Message`.

---

## FR-CHAT-017 — Start a conversation from the Inbox

**Description.**
A "+" action on the Inbox opens a recipient picker so a member can message someone without first finding one of their posts or their profile. Product decision D126 (KC#1728).

**Source.**
- Request: PM, 2026-11-04 (KC#1728). Refines `FR-CHAT-008` AC2.
- Reuses: `FR-CHAT-004` (one thread per pair), `FR-CHAT-006` (open from a profile), `FR-PROFILE-009` (following list), `FR-FEED-017` (user search), `D105` (blocking).

**Acceptance Criteria.**
- AC1. The Inbox top bar shows a "+" button (`testID="chat-inbox-new"`), mirrored correctly in Hebrew (RTL) and English (LTR). It opens the screen `chat/new`.
- AC2. With an empty search box the picker lists **the people I follow**, newest follow first (no separate "friends" concept; the follow graph is the source).
- AC3. Typing 2 or more characters filters the people I follow by display name or handle and adds a second group, **other people**, found by name or handle across all members. Followed people are never repeated in the second group. Fewer than 2 characters search nothing outside the followed list.
- AC4. A person is never offered when: it is me; the pair is blocked in either direction (`D105`); the account is not `active` or is removed.
- AC5. Choosing a person calls the same open-or-create use case as `FR-CHAT-006` (`anchor_post_id = null`, empty composer) and navigates to the conversation. An existing thread of the pair is reused (`FR-CHAT-004`), including after a personal hide the thread rules of `FR-CHAT-016` apply.
- AC6. Empty states: no one followed and no query shows a hint to search by name; a query with no match shows "no results"; a load failure shows a retry.
- AC7. Guests do not reach the screen (the Inbox itself is member-only).
- AC8. ⏳ **Organizations** (second result group, "people and organizations") are not offered yet: an organization has no account to message until `FR-ORG-006` / `FR-ORG-015` ship. This AC is closed by `FR-ORG-015`, which adds the group.
- AC9. ⏳ A member who does not accept messages is not offered. There is no such setting today; AC closes when one exists (no stub added).

**Related.** Screens: 4.1 · Domain: `Chat`.

---

| Version | Date | Summary |
| ------- | ---- | ------- |
| 0.1 | 2026-05-05 | Initial draft from PRD §3.4 and Decisions D-11, D-14. |
| 0.2 | 2026-05-09 | Extended `FR-CHAT-008 AC1` with 4th entry-point (Donations · Time) per `D-16` / `FR-DONATE-004`. |
| 0.3 | 2026-05-11 | Added `FR-CHAT-016` personal inbox hide + inbox dedupe / `preferNewThread` semantics. |
| 0.4 | 2026-05-17 | `FR-CHAT-014` AC1 + AC7: anchored-post card surfaces the counterpart's optional `users.contact_phone` (FR-AUTH-010 AC2.c) as a `tel:` link. Hidden for the Super Admin support thread and when the counterpart is null. |
| 0.5 | 2026-11-04 | `FR-CHAT-017` start a conversation from the Inbox; `FR-CHAT-008` AC2 superseded (D126, KC#1728). |
