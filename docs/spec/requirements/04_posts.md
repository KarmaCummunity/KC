# 2.4 Posts: Create, Edit, Discover

> **Status:** ✅ Core Complete — Create/edit/delete, images, visibility shipped. **2026-11-04 (G1 steps 4a–4b):** the post detail (FR-POST-014..018) is also the detail screen of every listing-world post — the listing's type sections and actions in place, with likes and comments — and an item post shows its reservation actions (reserve, confirm, hand over, cancel, rate). FR-POST-007 (local draft autosave) ✅ done under P2.22 (TD-108 resolved). **FR-POST-013** ✅ full FSM transition + Republish CTA shipped under P2.17 (migrations `0146`/`0147`/`0148`; TD-70 closed). **FR-POST-021 AC1** SELECT policy requires `auth.uid() IS NOT NULL` — guest projection defaults to `Public` exposure (no current leak surface; TD-81).



Prefix: `FR-POST-*`

---

## Scope

Authoring posts and the surfaces that show them, excluding feed composition (covered in [`06_feed_and_search.md`](./06_feed_and_search.md)) and closure / reopen (covered in [`05_closure_and_reopen.md`](./05_closure_and_reopen.md)).

Includes:

- Creating a "give" post and a "request" post (a single form with a prominent toggle).
- Required and optional fields, including images, address, location-display level, and post visibility.
- Post detail screen behavior across viewer/owner permutations.
- Editing an existing post, including visibility changes after publish (`FR-POST-009`).
- Deleting a post.
- Local draft autosave.
- Post lifecycle states.

---

## FR-POST-001 — Single creation form with type toggle

**Description.**
Tapping the "+" tab opens one form whose top control toggles between `🎁 Give` and `🔍 Request`. Most fields are shared; some differ.

**Source.**
- PRD: `03_Core_Features.md` §3.3.3, `05_Screen_UI_Mapping.md` §2.4, `04_User_Flows.md` Flows 4 & 5.
- Constraints: `R-MVP-Items-1`, `R-MVP-Items-2`, `R-MVP-Items-11`.

**Acceptance Criteria.**
- AC1. The toggle is the most prominent control on the screen and persists the chosen mode locally so the next visit defaults to the previous selection.
- AC2. Switching the toggle preserves shared fields (title, description, category, address, visibility) and clears type-specific fields (item condition, urgency).
- AC3. The form is the same screen used for editing an existing post (`FR-POST-008`); the route distinguishes them.
- AC4. *(KC#1296, 2026-10-30)* For the items and food giving worlds, the listing form offers an optional **world subcategory** (items → books, food → bakery…, `public.categories` children of the world). The choice is stored as the listing's `category_id`; a subcategory of another world is rejected (`category_world_mismatch`, migration `0462`). Matching uses it for its category score.
- AC5. *(KC#1101 / KC#1109, D-206, 2026-10-31)* A published open listing of a feed-mirrored world (`worlds.feed_mirror`: items, food) **appears in the main feed** through one mirror row in `posts` (`posts.listing_id`, migration `0466`). The mirror follows the listing's title, summary, subcategory, condition, photos (`media_assets.bucket = 'listing-images'`), privacy, status and deletion; opening it from the feed opens the listing detail. Mirrors do not count toward the open-posts cap (FR-POST-011) and are not listed under "my posts". "Share to feed" reuses the same mirror for every world and is hidden once the listing is mirrored.
- AC6. *(2026-11-01, `D-207`)* **Category first, then request / offer, then the category's own fields.** The top of the form is a category picker with one category per giving world (`D100`, `D107`), shown as **a single horizontally scrolling row of chips** (icon + name; every category one tap or a short swipe away; the chosen one highlighted and scrolled to the middle of the row; the row starts at the reading-start edge — right in Hebrew, left in English; KC#1741) so the fields below stay on screen, in the hub's order: **חפצים** (items), **אוכל** (food), **טרמפים** (rides), **זמן** (time), **כסף** (money), **דיור** (housing), **ידע** (knowledge), **רפואה** (medical), **בעלי חיים** (animals), **דמוקרטיה** (democracy), **תעסוקה** (employment), **אתגרים** (challenges); there is no "general" category. Under it sits the request / offer toggle (*לבקש* / *להציע*) — hidden for the link-only worlds below — and under that only the fields of the chosen category and direction (product book `docs/spec/07` §7.2):
  - *Items* — the post form of AC1–AC3 (photos, title, address + display level, item subcategory, condition + estimated value on offer, urgency on request, description, exposure). Items posts reach the items world through the posts → listings sync (migration `0243`).
  - *Rides* — the rides section of `docs/spec/05` §5.3 (D71, D75): origin, destination and up to 3 meeting points from the official places catalog, departure with shortcuts and a "leave now" switch (required; `FR-RIDE-003` AC7), "from my current location" switch for the origin (`FR-RIDE-003` AC6), estimated end, seats on offer, the remembered route / "publish again" seed; plus the cost model (free / expense share, capped) on offer and passengers + luggage on request.
  - *Food* — offer: food sub-category, which is the food type (cooked, fresh, packaged, frozen, dry, …), and expiry (both required), allergens, kosher, pickup / delivery; request: household size, dietary needs. There is no separate food-type field (D137, KC#1398).
  - *Housing* — offer: place type, guests, house rules; request: party size. Publishing needs a verified identity (D30, `world_permission_denied`).
  - *Time* — offer: duration; request: support type (companionship, practical help, escort — emotional support goes to a hotline, §5.4) + duration.
  - *Money, knowledge, medical, animals, democracy, employment, challenges* (worlds with no feed yet) — the form is **add a link**: URL, display name, optional description, written to that world's community links (`FR-DONATE-008`); a new link is reviewed before it goes live (`D9`) and its submitter sees it as pending meanwhile. After a successful add the form closes and returns to the screen it was opened from (AC9).
  - Every listing category also has photos, title, description and city. An offer in food, housing or animals needs at least one photo (as an items offer does, AC1 of `FR-POST-002`); requests and rides keep photos optional. A missing photo outlines the photo picker; a listing edit keeps its photos (D132, KC#1937). The kind is derived from the direction (one kind per direction per world), so members never pick a "listing type"; internal schema keys (linked ids, org slugs) are never shown.
  - The form reopens on the category the member last used (per user, on the device), in the direction (offer / request) last used **in that category** — items may reopen as an offer while rides reopen as a request; a `?category=` deep link wins over the remembered category but keeps that category's remembered direction. The "+" tab opens the form on the giving world on screen (`FR-FEED-020` AC4). A missing required field blocks publish with a message naming it: the form scrolls to the first field with a problem, outlines it in red and shows the message right under it (the title field shows its own error state); the outline clears as soon as the member edits the form. Only a problem no field owns (a server error) is shown above the bottom Publish button. Date fields open in a sheet (iOS) or the system dialogs (Android) — never an inline native picker (TestFlight 1.6.x crash).
- AC7. *(KC#1472)* Every category and direction shows the same compact kit Publish action in the screen header and a Publish action at the bottom. Both actions use the category's single submit path, validation, disabled and loading states; repeated taps while a publish is in progress start at most one submission. The header action works in RTL and web.
- AC8. *(KC#1741)* In every create sub-form (items, food, rides, time, housing, knowledge, link) labels, helper text, section headings and inline links align to the reading-start edge in both languages (right in Hebrew, left in English), as in `FR-SETTINGS-018`; a label never sits on the opposite edge from its field's other labels.
- AC9. *(2026-11-07)* The create form **opens on top of the screen it was launched from** (the "+" button, a world's request / offer buttons, "publish again", the feed's share prompt) and never replaces it: a feed, a world screen or a post detail stays underneath, unchanged. Closing the form (its × or tapping "+" again) or publishing successfully from any category (item post, listing, link, challenge) returns to that same screen. When nothing is underneath (deep link, reload), it returns to the Home Feed.

**Related.** Screens: 2.4 · Domain: `Post.type`, `Post.status`, `WorldSubcategory` · Code: `app/create.tsx`, `src/navigation/closeCreateForm.ts`, `src/lib/unifiedCreate/`, `src/components/CreatePostForm/`.

---

## FR-POST-002 — Required fields by type

**Description.**
The set of required fields depends on `Post.type`.

**Source.**
- PRD: `03_Core_Features.md` §3.3.3 (sub-section א).
- Constraints: `R-MVP-Items-1`, `R-MVP-Items-2`, `R-MVP-Items-13`.

**Acceptance Criteria.**
- AC1. For `type = Give`: `title` (≤80 chars) and at least one image are required.
- AC2. For `type = Request`: only `title` (≤80 chars) is required.
- AC3. For both types: `address` (city + street + number) is required (`R-MVP-Items-13`).
- AC4. The "Publish" control stays tappable while required fields are incomplete. Tapping it reveals validation: **address** gaps (city / street / house number) show a persistent red inline message under the address block (including feed-projection copy when street or number is missing); **other** gaps (title, Give photo) show a short Hebrew toast. Inline address errors appear only after the first Publish attempt and stay until the address validates. When all required fields validate, publish proceeds as usual. A second "Publish" control appears at the bottom of the create form for users who scroll past the header action.
- AC5. *(D132, KC#2020)* The server enforces the photo rule for offers in items, food, housing and animals, whichever app sends them: publishing such an offer with no photo is refused (`offer_photo_required`, shown with the same copy as the form's check), and its last photo can't be removed; deleting the whole post still removes its photos. Requests, rides and other worlds stay photo-optional. Offers published before the rule stay readable and editable.

**Related.** Screens: 2.4 · Domain: `Post`, `Address`.

---

## FR-POST-003 — Optional fields shared by both types

**Description.**
Shared optional fields and their defaults.

**Source.**
- PRD: `03_Core_Features.md` §3.3.3 (sub-section ב).

**Acceptance Criteria.**
- AC1. `description` accepts up to 500 characters; supports plain text only (no markdown, no rich text in MVP).
- AC2. `category` is selected from the canonical 10-category list (`R-MVP-Items-2`); default is `Other`.
- AC3. `location_display_level` is one of:
   - `CityOnly` 🏙️
   - `CityAndStreet` 🗺️ *(default)*
   - `FullAddress` 📍
- AC4. `visibility` is one of:
   - `Public` 🌍 *(default)*
   - `FollowersOnly` 👥 *(disabled when `User.privacy_mode = Public`)*
   - `OnlyMe` 🔒
- AC5. The disabled `FollowersOnly` option in `Public` profiles shows a tooltip pointing to Settings → Privacy.

**Related.** Domain: `LocationDisplayLevel`, `PostVisibility`.

---

## FR-POST-004 — Type-specific optional fields

**Description.**
Fields that exist for one type only.

**Source.**
- PRD: `03_Core_Features.md` §3.3.3 (sub-sections ג, ד).

**Acceptance Criteria.**
- AC1. For `Give`: up to 5 images total (the first being required), and an `item_condition ∈ { New, LikeNew, Good, Fair, Damaged }` (UI: שבור/תקול for `Damaged`).
- AC2. For `Request`: up to 5 images (all optional); a free-text `urgency` field (≤100 chars, e.g. "Need by Friday"). On the create screen, `urgency` is **not** grouped under the collapsible exposure section; it appears as its own field when type is Request (`FR-POST-003` address/visibility controls remain in exposure).
- AC3. Switching the toggle clears these fields with a confirmation if any value is present (to avoid accidental loss).

**Related.** Domain: `Post.item_condition`, `Post.urgency`.

---

## FR-POST-005 — Image upload constraints

**Description.**
Constraints on uploaded images (both types).

**Source.**
- PRD: `03_Core_Features.md` §3.3.3.

**Acceptance Criteria.**
- AC1. Allowed formats: JPEG, PNG, HEIC (HEIC is converted to JPEG client-side on iOS).
- AC2. Max 5 images per post; max 8 MB per image post-resize.
- AC3. Client-side resize to a max edge of 2048px before upload; further server-side derivatives produced for `feed_thumb` (640px), `detail_main` (1280px), and `original`.
- AC4. EXIF metadata is stripped server-side to prevent location leakage (`NFR-PRIV-002`).
- AC5. Failed uploads block "Publish"; partial successes can be retried individually without re-selecting all images.

**Related.** Domain: `Post.images[]`, `MediaAsset`.

---

## FR-POST-006 — Publish confirmations

**Description.**
Publishing a post confirms or warns based on chosen visibility.

**Source.**
- PRD: `03_Core_Features.md` §3.3.3 (sub-section ה), `04_User_Flows.md` Flow 4.

**Acceptance Criteria.**
- AC1. Visibility `Public`: no extra confirmation; success toast "✅ Your post is live!".
- AC2. Visibility `FollowersOnly`: an interstitial reminds the user how many approved followers will see it, with two CTAs ("Followers only" / "Make it public").
- AC3. Visibility `OnlyMe`: an interstitial reminds the user the post is saved privately and that they can change visibility later from the post **⋮** menu or edit screen; two CTAs ("Save private" / "Cancel").
- AC4. *(Updated 2026-11-07)* After successful publish, the success toast shows and the user returns to the screen the form was opened from (`FR-POST-001` AC9); the Home Feed is the fallback when the form had nothing underneath. Feed caches are refreshed so the new post appears wherever it belongs.

**Related.** Screens: 2.4 · Domain: `PostVisibility`.

---

## FR-POST-007 — Local draft autosave

> **Status:** ✅ Done — implemented under BACKLOG P2.22 (`feat/FR-POST-007-fe-draft-autosave`). Resolves TD-108. Design: [`docs/SSOT/archive/superpowers/specs/2026-05-17-post-draft-autosave-design.md`](../../archive/superpowers/specs/2026-05-17-post-draft-autosave-design.md).

**Description.**
The form persists its state to local storage to survive accidental closure.

**Source.**
- PRD: `03_Core_Features.md` §3.3.3 (sub-section ו), `04_User_Flows.md` Flow 4.A.

**Acceptance Criteria.**
- AC1. Every input change debounces (300 ms) and writes to local storage.
- AC2. Re-entering the form after backgrounding or app restart, with an unpublished draft present, surfaces a banner: *"You have an unpublished draft. Continue editing / Start fresh."*
- AC3. Drafts include image references (local URIs); if the underlying media is no longer accessible, those slots show a "missing image" placeholder and the user is prompted to re-add.
- AC4. A successful publish, an explicit "Start fresh", or a clean account-deletion clears the draft.
- AC5. Drafts are scoped per signed-in user identity; switching accounts on the same device does not expose drafts to the other user.

**Related.** Domain: `LocalDraft`.

---

## FR-POST-008 — Edit an existing post

**Description.**
The post owner **or** the Super Admin (`users.is_super_admin = true`) can re-open the form to edit fields of an `open` post. The Super Admin uses the same screen and update path; `posts.owner_id` stays immutable on the server.

**Source.**
- PRD: `03_Core_Features.md` §3.3.5, `04_User_Flows.md` Flow 10.
- Constraints: `R-MVP-Items-3`, `R-MVP-Privacy-9`.

**Acceptance Criteria.**
- AC0. **Authorization:** editing is allowed when `auth.uid()` is the post `owner_id` **or** `users.is_super_admin = true` for that session (re-checked by RLS on `posts` / `media_assets` updates; migration `0049_admin_post_edit_rls.sql`).
- AC1. Editable fields: title, description, category, address, location-display level, item condition (give-only), urgency (request-only), images, **and** visibility (any level may be chosen; `FR-POST-009`).
- AC2. The post `type` (Give vs Request) is **not** editable in MVP; the user must delete and recreate.
- AC3. Edits do **not** bump the post to the top of the feed; `created_at` is immutable while `updated_at` advances.
- AC4. Editing a post emits an `audit_event` (`R-MVP-Safety-3`) with the changed fields.
- AC5. When the post transitions to `removed_admin` (via `admin_remove_post`), the prior status is captured in `posts.status_before_admin_removal`. The owner's "פוסטים שהוסרו על ידי מנהל" overflow screen uses this field to split the list into prior-open and prior-closed sections (`D-35`). Legacy rows (NULL) render under the prior-open section.

**Edge Cases.**
- A post that has expired (`Post.status = expired`) cannot be edited; the form is disabled with a hint to "Republish".
- A post that has been auto-removed (`removed_admin`) cannot be edited (only the Super Admin may restore it).

**Related.** Screens: 2.4 · Domain: `Post`.

---

## FR-POST-009 — Post visibility may change after publish

**Description.**
The owner (or a closed-post participant for `surface_visibility`, `FR-POST-021`) may switch post audience among `Public`, `FollowersOnly`, and `OnlyMe` **at any time**, including restricting visibility after the post was already visible to others (e.g. moving from `Public` to `OnlyMe`). Product accepts that prior viewers may have cached or seen content; the control governs **current** discoverability in feeds and profile surfaces, not a retroactive erasure guarantee.

**Source.**
- Prior PRD text (`03_Core_Features.md` §3.2.4 sub-section ו) required upgrade-only; **superseded** by PM decision **`D-32` (2026-05-17)**.

**Acceptance Criteria.**
- AC1. Any transition `Public` ↔ `FollowersOnly` ↔ `OnlyMe` is allowed for `posts.visibility` on **open** posts (subject to `FR-POST-003` / `FR-PROFILE-*`: `FollowersOnly` remains unavailable when `User.privacy_mode = Public` — UI disables that option and surfaces the Settings → Privacy hint).
- AC2. The same freedom applies to each participant's `post_actor_identity.surface_visibility` on **closed** posts (`FR-POST-021`), with the same `FollowersOnly` / public-profile gate.
- AC3. Server and client must stay consistent: DB must **not** reject legal visibility writes solely for being a “downgrade”. Legacy `visibility_downgrade_forbidden` handling may remain in adapters for backwards compatibility with old DB snapshots but must not fire on current schema after migration `0094_posts_visibility_free_change.sql`.
- AC4. Profile mode flipping mid-flight (`Private → Public`) does not retroactively rewrite stored post visibility (`R-MVP-Privacy-13`).
- AC5. On `closed_delivered` and `deleted_no_recipient`, owner-driven Hide writes the owner's `post_actor_identity.surface_visibility = OnlyMe` (and auto-couples `hide_from_counterparty = true`). `posts.visibility` is **not** fanned out from this control — Hidden-screen routing (`FR-PROFILE-001 AC4`) reads the effective participant surface (migration `0107`, `D-39` supersedes `D-34`). `posts.visibility` on closed posts remains historically writeable via `UpdatePostUseCase` for legacy / admin paths, but the closed-post privacy UX no longer relies on it. `removed_admin` and `expired` remain locked.

**Related.** Domain: `Post.visibility`, `canUpgradeVisibility()` (non–no-op helper only), migration `0094_posts_visibility_free_change.sql`.

---

## FR-POST-010 — Delete a post

**Description.**
The owner can permanently delete their own post when it is **`open`**, or when there is **no row in `public.recipients`** for that post and status is **`deleted_no_recipient`** or orphan **`closed_delivered`** (e.g. recipient user removed — `recipients` cascaded away but status stayed closed). If a **`recipients`** row exists (`closed_delivered` with a live mark), owner delete is rejected; use reopen per `FR-CLOSURE-005` or admin paths.

**Source.**
- PRD: `03_Core_Features.md` §3.3.5.
- Constraints: `R-MVP-Items-3`.
- Decision: `D-18` (owner delete when unlinked).

**Acceptance Criteria.**
- AC1. Deletion is exposed only through the `⋮` menu on the post card and the post-detail screen, not as a primary CTA.
- AC2. Confirmation modal lists consequences: *"This post will be permanently deleted. Conversations started about this post will remain in the chat list."* and states which cases allow deletion (`open`; closed states only when there is no recipient / `recipients` row).
- AC3. On confirm, the post is hard-deleted along with its image assets; statistics counters update.
- AC4. Audit event recorded (`R-MVP-Safety-3`).
- AC5. After confirm, the user always gets explicit feedback: a short success toast when deletion succeeds, and a toast (plus inline error on the confirm modal when still open) when deletion fails (e.g. `closed_delivered` **with** a recipient row, `removed_admin`, or RLS no-op).

**Edge Cases.**
- Deleting a post does not delete chat threads that referenced it; those threads carry a "Original post no longer available" banner thereafter.
- A post with a `Recipient` row is treated as linked; owner delete is rejected even if status were inconsistent (defensive `NOT EXISTS` in RLS).
- **Orphan `closed_delivered`:** if the marked recipient's `users` row is removed, `recipients` may CASCADE-delete while `posts.status` still reads `closed_delivered`. Owner delete is allowed in that case (no `recipients` row), same as `deleted_no_recipient` without a mark.

**Related.** Screens: 3.1 · Domain: `Post` · Closure: `FR-CLOSURE-003`, `FR-CLOSURE-005`.

---

## FR-POST-011 — Maximum active posts per user

**Description.**
A user cannot have more than 20 posts in `open` status simultaneously, including `OnlyMe` posts.

**Source.**
- Constraints: `R-MVP-Items-8`, `R-MVP-Items-14`.

**Acceptance Criteria.**
- AC1. The 20-post limit is enforced server-side at publish time; the API returns `LIMIT_EXCEEDED` with the current count and limit.
- AC2. The UI surfaces a friendly modal explaining the limit and offering shortcuts to "View my active posts" and "Close older posts".
- AC3. `OnlyMe` posts count toward the limit (`R-MVP-Items-14`).
- AC4. Closure (`closed_delivered` or `deleted_no_recipient`) frees a slot; expiry frees a slot.

**Related.** Domain: `Post`.

---

## FR-POST-012 — Post lifecycle states

> ⚠️ **Superseded by the project book** — D21 (expiry per post type) and S1 (state machine incl. `hidden_pending_review`). Binding text: `docs/spec/07_cross_cutting_systems.md` §7.1. Evidence and status: `docs/spec/95_reconciliation.md` §2. The text below is kept as history (D35).

**Description.**
A post moves through a finite state machine.

**Source.**
- PRD: `03_Core_Features.md` §3.3.6 (sub-section ד).
- Constraints: `R-MVP-Items-4`, `R-MVP-Items-5`, `R-MVP-Items-6`, `R-MVP-Items-7`.

**Acceptance Criteria.**
- AC1. States: `open`, `closed_delivered`, `deleted_no_recipient`, `expired`, `removed_admin`. Initial state is `open`.
- AC2. Transitions:
   - `open → closed_delivered` (closure with recipient marked) — `FR-CLOSURE-002`
   - `open → deleted_no_recipient` (closure without recipient marking) — `FR-CLOSURE-003`
   - `closed_delivered → open` (reopen) — `FR-CLOSURE-005`
   - `deleted_no_recipient → open` (reopen, only within 7-day grace window) — `FR-CLOSURE-005`
   - `open → expired` (300 days inactivity) — automated, `FR-POST-013`
   - `* → removed_admin` (admin or 3-report auto-removal) — `FR-MOD-006`
- AC3. State machine is enforced as a pure function in `domain` (`PostStatus.transition()` invariant).
- AC4. The full state machine is diagrammed in [`03_domain_model.md`](../../SSOT/archive/SRS/03_domain_model.md) §3.4.

**Related.** Domain: `Post.status`, `PostStatus`.

---

## FR-POST-013 — Post expiry (300 days)

> ⚠️ **Superseded by the project book** — D21 — expiry per post type; items and all requests never expire (gap G32). Binding text: `docs/spec/07_cross_cutting_systems.md` §7.1. Evidence and status: `docs/spec/95_reconciliation.md` §2. The text below is kept as history (D35).

**Description.**
A post that has remained `open` for 300 days transitions to `expired` automatically.

**Source.**
- PRD: `03_Core_Features.md` §3.3.6 (sub-section ד).
- Constraints: `R-MVP-Items-5`.

**Acceptance Criteria.**
- AC1. A scheduled job (`bg-job-post-expiry`, see [`06_cross_cutting/05_background_jobs.md`](../../SSOT/archive/SRS/06_cross_cutting/05_background_jobs.md)) runs daily and transitions matching posts.
- AC2. Seven days before expiry, the owner receives a notification (`FR-NOTIF-010`) — Critical category.
- AC3. Expired posts disappear from the feed; they remain visible to the owner in the closed-tab area marked `expired`, with a "Republish" CTA that creates a new post pre-filled with the prior content (new ID).
- AC4. Expiry preserves the original `Post` row for audit; image assets may be garbage-collected after 30 additional days.

**Related.** Domain: `Post.status = expired`, `bg-job-post-expiry`.

---

## FR-POST-014 — Post Detail screen (viewer)

**Description.**
The screen rendered when any non-owner viewer opens a post they are allowed to see.

**Source.**
- PRD: `03_Core_Features.md` §3.3.4, `05_Screen_UI_Mapping.md` §2.3.

**Acceptance Criteria.**
- AC1. Renders: image carousel (or large category icon if a request without images), type badge `🎁`/`🔍`, title, category, owner row (avatar + name + city, tap → profile), full description, type-specific fields, computed location string per `location_display_level`, relative timestamp.
- AC2. When `Post.status === 'open'`, the primary CTA is "💬 Send Message to Poster" — opens chat with the contextual auto-message (`FR-CHAT-005`). See AC6 for non-open posts.
- AC3. Secondary CTA: dynamic follow button per `FR-FOLLOW-011`.
- AC4. `⋮` menu: "Report" (`FR-MOD-001`). (Per `EXEC-9`, the "Block User" item is removed from MVP scope.)
- AC5. If the post is no longer visible to the viewer (e.g., follower removed, post auto-removed) the screen renders an empty state: *"This post is no longer available. It may have been removed or limited to followers only."*
- AC6. The primary "Send Message to Poster" CTA (`FR-CHAT-005`) is shown only when `Post.status === 'open'`; it is hidden for any non-open lifecycle state (including `closed_delivered`, `expired`, `removed_admin`, etc.). The CTA renders as a compact floating pill (not a full-width bottom bar). It sits just above the docked comment composer and never covers it, including while the keyboard is open (KC#1946).
- AC7. When a viewer can still see a post in a limited/non-active state, the detail screen surfaces it explicitly: `removed_admin` and `expired` show both a hero status pill and an inline notice banner; `FollowersOnly` / `OnlyMe` visibility shows an inline notice (to owner and permitted viewers alike). Give posts additionally show an estimated-value chip when `estimated_value > 0`.

**Related.** Screens: 2.3 · Domain: `Post`, `LocationDisplayLevel`.

---

## FR-POST-015 — Post Detail screen (owner, open)

**Description.**
Same screen, owner-mode controls, `Post.status = open`.

**Source.**
- PRD: `03_Core_Features.md` §3.3.5, `05_Screen_UI_Mapping.md` §2.3.

**Acceptance Criteria.**
- AC1. Replaces viewer CTAs with: "Edit" (`FR-POST-008`), "Mark as Delivered" (`FR-CLOSURE-001`), "Delete" (`FR-POST-010`).
- AC2. Posts at visibility `OnlyMe` show a prominent banner: *"🔒 Private — only you can see this post."*
- AC3. Posts at visibility `FollowersOnly` show a small banner: *"👥 Visible to your approved followers."*
- AC4. The address shown to the owner is the **full** address regardless of `location_display_level` (the field affects only the public projection).

**Related.** Screens: 2.3.

---

## FR-POST-016 — Post Detail screen (owner, closed_delivered)

**Description.**
Owner-mode controls when the post is closed with a recipient marked.

**Source.**
- PRD: `03_Core_Features.md` §3.3.5.

**Acceptance Criteria.**
- AC1. Replaces all viewer CTAs with: "📤 Reopen" (`FR-CLOSURE-005`).
- AC2. Banner: *"Closed — delivered to [recipient name] on [date]."*
- AC3. The recipient row shows the recipient's avatar/name with a tap target to their profile (subject to that user's privacy mode).
- AC4. Closure metadata cannot be edited (the only mutation is reopen).

**Related.** Screens: 2.3.

---

## FR-POST-017 — Post Detail screen (recipient view)

**Description.**
A user marked as the recipient of a `closed_delivered` post sees a special view in their "Closed Posts" section, mirroring `FR-POST-016` minus owner controls plus a self-removal action.

**Source.**
- Decisions: `D-7`.

**Acceptance Criteria.**
- AC1. A user picked as the respondent of a `closed_delivered` post sees the post in their own profile's "פוסטים סגורים" tab. The post is **also** visible to other viewers of the respondent's profile, subject to the **respondent's** `post_actor_identity.surface_visibility` for that post (Public / FollowersOnly / OnlyMe; default `Public`). The publisher's `posts.visibility` no longer gates third-party access to the closed-post listing — each participant's `surface_visibility` governs their own profile tab independently (`D-28`, supersedes the `D-19` clause that read "subject to the post's original `visibility` setting"). The "Remove my recipient mark" CTA remains exclusive to the respondent themselves.
- AC2. Detail view renders the post's content read-only with a banner: *"You were marked as the recipient by [owner]."*
- AC3. CTA: "Remove my recipient mark" (`FR-CLOSURE-007`).
- AC4. No other actions are available; the recipient cannot reopen or edit the post.
- AC5. When a third party opens the post via the respondent's profile, the detail screen renders a read-only public view (no Reopen, no Remove-mark, no Edit). The `RecipientCallout` already adapts to post type — "נמסר ל-X" for `Give` posts, "ניתן על-ידי X" for `Request` posts — and is the canonical surfaced banner.

**Related.** Screens: 2.3 · Domain: `Recipient`, `Post`.

---

## FR-POST-018 — Quick-message affordance from feed card

**Description.**
A small message icon on each feed card opens the chat for that post directly from the feed.

**Source.**
- PRD: `03_Core_Features.md` §3.3.1.2, `05_Screen_UI_Mapping.md` §2.1.

**Acceptance Criteria.**
- AC1. Tapping the icon is equivalent to opening the post and tapping the primary CTA, but skips the post detail screen.
- AC2. The icon is hidden on the user's own posts.
- AC3. ~~The icon respects block state (`FR-MOD-009`).~~ Deferred — `FR-MOD-009` is deprecated per `EXEC-9`; no block state exists in MVP.

**Related.** Screens: 2.1.

---

## FR-POST-019 — Address validation

**Description.**
Address fields are validated for shape only, not against a geocoder.

**Source.**
- PRD: `06_Navigation_Structure.md` §6.6.4 ("city-name geographic, no geocoding").

**Acceptance Criteria.**
- AC1. `city` is selected from the canonical seeded list (no free text).
- AC2. `street` is 1–80 chars, trimmed. On Create Post + Edit Post the UI is a city-dependent canonical picker over `public.streets` (`D-36`) with a free-text fallback row for new construction / source gaps; the picker is disabled with helper text "בחרו עיר תחילה" until a city is selected, and tapping the disabled field surfaces an ephemeral toast. Switching the city resets street + number so a Tel Aviv street can never accompany a Jerusalem submission. The DB column remains `text` — what the UI saves is what the user picked or typed.
- AC3. `street_number` accepts digits and an optional single-letter suffix. The suffix may be a Latin letter (`12A`, `12B`) or a Hebrew letter (`12א`, `15ב`) to support Israeli street numbering conventions. Punctuation and multi-character suffixes are rejected.
- AC4. Geocoding to lat/lon is **not** performed in MVP.
- AC5. The composed display string follows `location_display_level`:
   - `CityOnly` → "Tel Aviv"
   - `CityAndStreet` → "Tel Aviv · Hayarkon"
   - `FullAddress` → "Tel Aviv · Hayarkon 12A"

**Related.** Domain: `Address`, `LocationDisplayLevel`.

---

## FR-POST-020 — Forbidden content guardrails (advisory)

**Description.**
At publish time, an advisory check warns users against posting forbidden categories.

**Source.**
- Constraints: `R-MVP-Items-9`, `R-MVP-Items-10`.

**Acceptance Criteria.**
- AC1. The check scans `title + description` for keywords from a configurable list (weapons, drugs, live animals, currency / sale terms).
- AC2. A match raises a soft warning modal: *"This may violate community rules — please review before publishing."* The user may proceed; the post is flagged for moderation telemetry.
- AC3. False negatives are expected; the moderator pipeline (`FR-MOD-*`) is the authoritative enforcement layer.

**Related.** Domain: `ContentAdvisory`.

---

## FR-POST-021 — Per-participant audience on closed posts + counterparty identity mask

**Description.**
Participants control **who may see the post** (audience), not a separate “identity chrome” tier in the MVP UI.

- **Open posts (`status = open`, owner on post detail):** the same three-level control as `FR-POST-003` edits `posts.visibility` (subject to `FR-POST-009` free changes + public-profile gate for `FollowersOnly`). Shown in the post-detail **⋮** menu (open or closed) for quick changes.
- **Closed posts (`status = closed_delivered`, owner or marked respondent):** each participant edits their own `post_actor_identity.surface_visibility` (`Public` / `FollowersOnly` / `OnlyMe`, default `Public`) — who, beyond the two participants, can discover the post **through that participant's surface** (their "פוסטים סגורים" profile tab and generic third-party fetch). Changes follow the same rules as open-post visibility (`FR-POST-009`, including the public-profile gate for `FollowersOnly`). The participant's audience is the **sole** truth for their profile-surface routing (Hidden tab vs Closed tab + third-party visibility) — `posts.visibility` is no longer fanned out from this control (`D-39` supersedes `D-34`). UI: the post-detail **⋮** menu (same surface as open-post visibility controls).
- **Third-party mask on the counterparty's profile surface (`hide_from_counterparty`):** when a marked respondent exists, each participant may toggle this flag so **non-participant viewers** who discover the post through the **counterparty's** "פוסטים סגורים" profile context see anonymous post chrome for that actor (name / avatar / profile link from the post row). The **counterparty** always sees the actor's real identity on post chrome (chat is the mutual-recognition surface — `D-39` removes the legacy `D-26` owner-OnlyMe counterparty mask). Picking `surface_visibility = OnlyMe` also implies the third-party mask on the counterparty's surface even when `hide_from_counterparty = false` (an OnlyMe author appearing under their full name on a partner's public tab would defeat the privacy intent). The historical column name `hide_from_counterparty` is retained in `public.post_actor_identity`; product semantics are defined in **`D-31`** and **`D-39`**.

The column `identity_visibility` remains in `public.post_actor_identity` for projection compatibility and is **written as `Public` by the app**; migration `0092_post_actor_identity_public_chrome.sql` normalizes legacy non-`Public` values. Advanced identity-chrome rules (`FollowersOnly` / `Hidden` on chrome only) are **out of MVP UI scope** (`D-30`).

**Source.**
- Design: `docs/SSOT/archive/superpowers/specs/2026-05-16-post-actor-privacy-design.md` (original) + addendum (2026-05-16) + PM revision (2026-05-16).
- Decisions: `D-26` (superseded in part by `D-39`), `D-28`, `D-30`, `D-31`, `D-39`.

**Acceptance Criteria.**
- AC1. Table `public.post_actor_identity` stores per `(post_id, user_id)`: `surface_visibility ∈ {Public, FollowersOnly, OnlyMe}` (default `Public`), `identity_visibility` (app writes `Public` only in MVP), and `hide_from_counterparty boolean` (default `false`). RLS allows read when the viewer may read the post; write only by the participant for their own row. The SELECT policy uses a `SECURITY DEFINER` helper to avoid recursion with `is_post_visible_to`.
- AC2. **Counterparty read invariant.** `posts.owner_id` and active `recipients.recipient_user_id` always retain read access to the post regardless of either participant's `surface_visibility`. Surface visibility governs **third-party** access only.
- AC3. **Closed-post third-party access.** `is_post_visible_to(post, viewer)` for `closed_delivered` returns true to a non-participant `V` iff **either** participant's `surface_visibility` admits `V` (Public always; FollowersOnly iff `V` follows that participant; OnlyMe never for `V`). `profile_closed_posts(profile, viewer)` gates each row by **that row's role-actor** effective `surface_visibility` — read from `post_actor_identity` and falling back to `posts.visibility` for the publisher (legacy preservation) and `'Public'` for the respondent (`D-28`, `D-39`, migration `0107`). The Hidden screen (`p_list_mode = 'owner_only_me'`, `FR-PROFILE-001 AC4`) and the owner's Standard exclusion both key on effective `surface_visibility = OnlyMe` — never on `posts.visibility` directly.
- AC4. **Identity projection (pure domain).** `projectActorIdentityForViewer` runs per participant after fetch. The viewer sees full identity unless **(a)** the actor's `surface_visibility = OnlyMe` **or** `hide_from_counterparty = true` AND the viewer is a **third party** (not actor, not counterparty) on a surface where masking applies (post detail, feed, or the counterparty's closed-post profile tab when `identityListingHostUserId = counterparty`), **(b)** legacy non-`Public` `identity_visibility` rows until migration `0092` runs, or **(c)** `exposure === 'FollowersOnly'` and viewer does not follow the actor. The **counterparty always** sees the other participant's **full** identity on post chrome — `D-39` removes the legacy `D-26` owner-OnlyMe → counterparty mask (chat is the mutual-recognition surface and the partner already knows the actor).
- AC5. When projection marks an identity as anonymous, post-detail must not offer a one-tap profile deep-link from that row (`ownerProfileNavigableFromPost` / `recipientProfileNavigableFromPost = false`).
- AC6. Chat headers and profile shells remain real-user surfaces; masking applies to **post chrome** only (`D-26`).
- AC7. **Create-time preference.** The new-post screen lets the publisher set `hide_from_counterparty` before publish. When enabled, the client upserts the owner's `post_actor_identity` row at publish time with `surface_visibility = posts.visibility` (at publish), `identity_visibility = Public`, and `hide_from_counterparty = true` (semantics per **`D-31`** — third parties on the counterparty's closed-post profile surface, not hiding from the counterparty in chat). When disabled, no row is written at create unless the user later changes closed-post surface settings from the post-detail **⋮** menu.
- AC8. **Delivered listing (D-229, migration `0740`).** The recipient is the user on the `handed_over` `post_handoffs` row (not the `recipients` row, which food and animals did not write before `0740`). The recipient always sees the delivered post and its listing screen and can rate it, even if the owner chose `OnlyMe`, and still sees it after rating; an admin or moderator sees every delivered listing. A participant with a `Private` profile counts as `FollowersOnly` for the third-party union in AC3; the recipient's default surface is `Public`, so a guest can open a share link to a delivered `Public` listing. The listing screens delegate delivered posts to `is_post_visible_to` so the post and listing screens never diverge. Items, food and animals hand-overs record the `recipients` row (single recipient per post); knowledge, rides, housing and events keep the handoffs as the record. Deleted accounts: visibility follows the remaining party; retention of the delivered post after account purge is #2088.

**Migrations.** `0083_post_actor_identity.sql`, `0085_post_actor_identity_audience_split.sql`, `0092_post_actor_identity_public_chrome.sql`, `0106_recipients_select_visible_viewers.sql`, `0107_profile_closed_posts_surface_visibility.sql`.

**Related.** `FR-POST-003`, `FR-POST-009`, `FR-POST-014`, `FR-POST-017` AC1, `FR-PROFILE-001` AC4, `FR-PROFILE-002` AC2, `FR-CLOSURE-005`, `FR-CLOSURE-007`.

---

## FR-POST-022 — Save / unsave post

**Description.**
A signed-in user may bookmark any post they can currently read (their own or another user's) for later access from My Profile.

**Source.**
- Product request (2026-05-16); deferred V2 bookmarks revived for MVP bookmark-lite.

**Acceptance Criteria.**
- AC1. Only authenticated users see save actions (guests have no post ⋮ menu).
- AC2. The user may save any post that passes `is_post_visible_to` at save time (owner, public, followers-only when following, closed-post rules, etc.).
- AC3. Post ⋮ menu shows **Save** when not bookmarked and **Remove from saved** when bookmarked (mutually exclusive). Applies to own posts and others' posts.
- AC4. Save is idempotent (duplicate save is a no-op).
- AC5. Unsave deletes the bookmark row.
- AC6. When the underlying post is hard-deleted, bookmark rows are removed via `ON DELETE CASCADE`.

**Related.** Screens: 2.3, 3.1 · Domain: `saved_posts` · Profile list: `FR-PROFILE-016`.

---

## FR-POST-023 — Share post via link with image preview

> **Status:** 🟡 In progress — ships under BACKLOG P2.33. Replaces the v0.9–v0.12 architecture (Supabase Edge Function) with a Hono web server on the same Railway service that serves the SPA — one canonical URL on `karma-community-kc.com`.
>
> **Hosting note (2026-10-31, historical context for AC4–AC5):** Railway is retired; the web app now ships as a static export on Cloudflare Pages (`deploy-web.yml`), which does not run the Hono server in `app/apps/mobile/web-server/`. AC4's crawler OG card is therefore not served until the route is ported (`TD-234`); AC5 holds through the Pages SPA fallback.

**Description.**
A signed-in viewer of a `Public` post that is `open` or `closed_delivered` may share a link to that post from the post-detail screen. The link is browsable to anyone (signed-in or not); social-media crawlers see an Open Graph card with the first post image, the post title, and the description; non-authenticated humans landing in the app are routed to the sign-in screen and, after sign-in, deep-linked back to the original post.

**Source.**
- Product request (2026-05-23). Re-scoped 2026-05-24 to eliminate the Supabase-domain leak observed in the prior shipped version.

**Acceptance Criteria.**
- AC1. When `post.status` is `open` or `closed_delivered` and either (a) `post.visibility === 'Public'` for any viewer, or (b) the viewer is a **participant** on a `closed_delivered` post (post owner **or** marked recipient — including after Hide / `surface_visibility` / counterparty privacy), a share affordance is available. Image presence is not required. **Surfaces:** (i) post-detail header — **in the trailing corner** (rightmost in RTL), with the existing ⋮ menu placed to its left; (ii) the post ⋮ menu on feed cards and profile post grids (same visibility gate, first row in the sheet).
- AC2. Tapping the affordance opens the platform share sheet. The accompanying message body is composed per-post by `buildPostShareMessage` as a structured, scannable block of labeled lines (WhatsApp-style bold via `*…*`). All literal strings resolve through the active i18next locale (MVP: Hebrew only; keys live under `post.detail.share*` and reuse `post.detail.statusOpen` / `statusClosed`). Headline and CTA vary by **post type** (`Give` / `Request`) and **lifecycle** (`open` vs `closed_delivered`):
   1. `shareHeadlineGiveOpen` / `shareHeadlineGiveClosed` / `shareHeadlineRequestOpen` / `shareHeadlineRequestClosed` + blank line.
   2. `*מפרסם:* <ownerDisplay>` — resolved via the same rules as post-detail owner chrome (`postOwnerDisplayLabel`): full name when identity is visible, `אנונימי` when masked.
   3. `*שותף/ה:* <counterpartyDisplay>` — only when `status = closed_delivered` and a marked recipient exists; resolved via `postRecipientDisplayLabel` (mirrors `RecipientCallout`). Omitted for open posts.
   4. `*כותרת:* <title>`.
   5. `*תיאור:* <description>` — truncated to 200 chars with `…`; whole line omitted when null/empty.
   6. `*קטגוריה:* <category>` — always included, even for `Other`.
   7. `*מיקום:* <address>` — `city`, `city + street`, or `city + street + number` per `locationDisplayLevel`.
   8. `*פורסם:* <relativeTime>` — `formatDistanceToNow` with the date-fns locale mapped from `i18n.language`.
   9. `*סטטוס:* <statusOpen|statusClosed>`.
   10. Blank line, then `shareCtaGiveOpen` / `shareCtaGiveClosed` / `shareCtaRequestOpen` / `shareCtaRequestClosed`.
   The share URL appears in the message body **exactly once** on every platform. iOS attaches the first image binary via the `url` field (`expo-file-system` cache download); Android never passes `url` (RN concatenates it onto EXTRA_TEXT, which is what caused the duplicated link in WhatsApp in the reverted version). Web uses `navigator.share({ files })` when Web Share Level 2 supports files; else `navigator.share({ title, text, url })`; else `navigator.clipboard.writeText(url)` with a Hebrew toast.
- AC3. The share URL is `https://karma-community-kc.com/post/<id>` — the same URL as the in-app deep link, the universal-link claim path, and the SPA route. There is **no** Supabase URL anywhere — neither as the user-visible URL, nor in a redirect chain, nor in WhatsApp's preview "via" line. Built from `EXPO_PUBLIC_WEB_BASE_URL` (defaults to `https://karma-community-kc.com` when unset).
- AC4. The Railway web service runs a Hono server (replaces `serve dist --single`) that, on `GET /post/:id` with a crawler UA, returns 200 `text/html` with `og:title`, `og:description`, `og:image`, `og:url`, `og:locale=he_IL`, `twitter:card=summary_large_image`. Posts the anon REST read cannot see (RLS), not-found, invalid UUIDs, and REST timeouts return a generic OG card pointing at the marketing landing — never the post's image or title.
- AC5. The same `GET /post/:id` from a human (UA not matching the BOT regex) returns the SPA `index.html`; Expo Router renders the post-detail screen.
- AC6. **Unauthenticated landing:** when an unauthenticated user follows `/post/<id>`, `AuthGate` captures the path before redirecting to `(auth)`, persists it in an in-memory store with a 10-minute TTL, and after sign-in / onboarding completion navigates to the captured path (`router.replace(pendingPath)`), then clears the intent. Refresh / app restart loses the intent, falling back to `(tabs)`.
- AC7. The OG image is the public Supabase Storage URL for `mediaAssets[0].path`. When the post has no media (e.g. Request posts without images), the OG image is `${APP_BASE_URL}/pwa-icon-512.png` (the 512×512 community logo bundled with the web app).
- AC8. The share action does not mutate post state, does not require a network round-trip on the client (the Hono server is hit only when the recipient opens the link), and emits no `audit_event` (read-only intent).

**Edge Cases.**
- Post deleted between share and link-open: crawler gets generic card (Hono REST filter excludes the row); human gets SPA → "not found" UX.
- Post closed between share and link-open (was open when shared): crawler/human may no longer resolve the post if RLS no longer admits the viewer; generic OG card / not-found UX.
- Owner shares a hidden (`OnlyMe`) closed post: share affordance remains; link opens for participants and for viewers RLS still admits; anon OG may fall back to the generic card.
- Marked recipient shares after setting their own `surface_visibility` to `OnlyMe`: share affordance remains for the recipient; third-party link resolution follows RLS as usual.
- Post shared while already `closed_delivered`: link and OG card resolve when RLS admits the recipient viewer (participant `surface_visibility` Public, or owner `posts.visibility` Public with default surface).
- User offline at share time: OS share sheet still opens. Recipient's connectivity governs link resolution.
- Image download failure on iOS: fall back to URL-only share. OG preview on the recipient still renders the image.

**Related.** Screens: 2.3 (post detail). Domain: `Post.visibility`, `Post.status`. Cross-refs: `FR-POST-014` (viewer detail), `FR-AUTH-014` (guest entry), `TD-66` (deep-link manifests). Server: `app/apps/mobile/web-server/server.mjs`. Decision: `D-38`.

## FR-POST-024 — Recurring time posts (a series of occurrences) 🟡
> Issue #2086; PM decisions `{{D:recurring-time-posts}}`, `{{D:series-end-cancels-booked}}`, `{{D:owner-cancel-notifies-registrants}}` (2026-11-11). Rides keep their own series (FR-RIDE-046) and move onto this model later.

**Description.**
A member who volunteers on a fixed schedule (for example every Tuesday at 17:00, three places), or an organization that runs the same event every week, publishes it once as a **series** from the regular time form. The series publishes each upcoming date as an ordinary time post (an **occurrence**), and each occurrence takes its own registrations, waitlist and attendance, exactly like a single event (G18). The owner manages the whole series in one place.

**Acceptance Criteria.**
- AC1. The time form (an event, which a volunteering shift is too) has a "recurring" switch under the schedule: weekdays, a start time and duration, an optional end date. The series' time zone is the member's (Israel by default); the first date opens after publishing. Any member publishes their own event from the time form by picking "volunteering with sign-up" (`time-offer-kind-personal-event`); a member of an organization may instead pick the organization's event. ✅
- AC2. A series publishes its dates for the coming 30 days and keeps that window filled; one date per series and day, never two, also when two runs overlap. ✅
- AC3. Each date is an event post with its own registrations: capacity, waiting list and registration policy come from the series, and the organizer marks attendance per date; only marked attendance earns karma (D124). A person's series (regular volunteering) and an organization's follow the same rules; an organization's dates are published only while the owner may act for it. ✅
- AC4. A local start time that does not exist on a clock-change day moves forward by the jump (02:30 → 03:30, as calendars do); a time that occurs twice takes the first. ✅
- AC5. **Edit all**: the owner edits the series (schedule, and the title, description and capacity of its template); upcoming dates nobody registered for are replaced; a date that has registrations keeps its time and details. ✅ server; the app edits the schedule, ⏳ the template text
- AC6. **Cancel one**: the owner cancels a single date, from the series or by deleting the date's post; its registrations are cancelled, each registrant gets a notification, and the day is not published again. ✅
- AC7. **Pause / resume**: pausing stops publishing new dates and removes the upcoming dates nobody registered for; dates with registrations go ahead. Resuming publishes again. ✅
- AC8. **End**: ending a series is final. Every upcoming date is cancelled, including those with registrations, and each registrant gets a notification. Past dates stay as they were. The scheduler also ends a series whose last day has passed. ✅
- AC9. The series moves on the kernel: `active ⇄ paused → ended`; any other move is refused (`illegal_transition`). ✅
- AC10. Not in the first version: editing a single date, and "this and the following".
- AC11. **One card per series** (`{{D:series-one-card-in-feed}}`). In the main feed, a world feed and post search a series is one card: its soonest open date. The later dates are reachable from that card ("other dates"), the map and the publisher's profile. When the date in the feed ends, is paused or is cancelled, the next one steps in; a date moved to be the soonest takes the place; a date that leaves its series is an ordinary post again. The series keeps one place in the feed and takes a new one at most once in 7 days: the date that steps in inherits the place of the one before it, or is published anew when that place is a week old. The same rule holds for recurring rides (FR-RIDE-046 AC4). The rule is kept on write (triggers, with a nightly repair job), so reading a feed page costs nothing more. ✅
- AC12. "My recurring events" is in the time world's menu (`world-hub-post-series`), next to "my shifts", and is linked from every date's post and from "my organizations". ✅
- Server (`0004_post_series.sql`, `0005_post_series_rpcs.sql`): `post_series` (schedule + post and event templates, optional organization), `post_event_details.series_id / series_on` (one date per series and day), `kc_private.post_series_skipped_days` (cancelled days), machine `post_series`, `kc_private.series_local_instant`, `kc_private.post_series_materialize` (daily job, and on every series RPC), RPCs `create_post_series`, `update_post_series`, `set_post_series_status`, `cancel_post_series_date`. `0006_series_feed_folding.sql`: `posts.feed_folded`, `kc_private.series_refold` (one series), its triggers on `posts.status` and on the event and ride detail rows, the nightly `series_feed_refold` job, `feed_page` and the main feed index without folded dates. Tests: `supabase/tests/075_post_series.sql`, `supabase/tests/077_series_feed_folding.sql`.

---

---

| Version | Date | Summary |
| ------- | ---- | ------- |
| 0.21 | 2026-11-11 | `FR-POST-024` AC1, AC11, AC12 — a member publishes their own recurring volunteering; a series is one card in the feeds; "my recurring events" moves to the time world's menu (#2086). |
| 0.20 | 2026-11-11 | `FR-POST-024` — recurring time posts: a series publishes occurrences that each take registrations; edit all, cancel one, pause / resume, end (#2086). |
| 0.19 | 2026-11-07 | `FR-POST-001` AC6 — a blocked publish scrolls to the field with the problem and outlines it in red, with the message under it, instead of one message above the bottom Publish button. |
| 0.18 | 2026-11-04 | `FR-POST-001` AC6 (#1411) — the rides form gets "from my current location" (origin) and "leave now" (departure) switches; see `FR-RIDE-003` AC6–AC7. |
| 0.17 | 2026-11-04 | `FR-POST-001` AC6 + AC8 (KC#1741) — the create category picker is one horizontally scrolling row of chips instead of a 4x3 grid; labels, helper text and inline links in every create sub-form align to the reading-start edge in Hebrew and English. |
| 0.16 | 2026-11-01 | `FR-POST-001` AC6 — five create categories (items, rides, food, housing, time) with the last used category + direction remembered; request / offer under the picker; curated per-category fields; no inline native date picker or slider (TestFlight crash). |
| 0.15 | 2026-05-24 | `FR-POST-023` AC2 — share body adds `*מפרסם:*` (owner identity per `postOwnerDisplayLabel`) and `*שותף/ה:*` on closed posts with a marked recipient (`postRecipientDisplayLabel`). |
| 0.15 | 2026-05-28 | `FR-POST-021` — `upsert_post_actor_identity` RPC (`0160`) replaces PostgREST `.upsert()` after TD-85 column-scoped UPDATE grants (fixes 403 on hide / exposure sync). |
| 0.14 | 2026-05-24 | `FR-POST-021` AC3/AC4 + `FR-POST-009` AC5 — dual-surface closed-post privacy (`D-39`). Hidden-screen routing now keys on effective participant `surface_visibility` (migration `0107`); `posts.visibility` fan-out removed from the closed-post Hide control. Counterparty always sees the actor's full identity on post chrome (`D-26` legacy owner-OnlyMe counterparty mask removed). `surface_visibility = OnlyMe` always implies third-party mask on the partner's surface even when `hide_from_counterparty = false`. Migration `0106` (recipients RLS for third-party post detail) shipped in the same set. |
| 0.13 | 2026-05-24 | `FR-POST-023` — re-architected to eliminate Supabase-domain leak. Hono server on the Railway web service replaces the Supabase Edge Function. One canonical URL `https://karma-community-kc.com/post/<id>` for share + deep link + SPA route. Share body adds `*פורסם:*` (relative time); category line is always included (incl. `Other`); address mirrors the post-detail screen's `locationDisplayLevel`. |
| 0.1 | 2026-05-05 | Initial draft from PRD §3.3.3–§3.3.5 and Flows 4, 5, 10. |
| 0.2 | 2026-05-12 | `FR-POST-008` — Super Admin may edit any open post; RLS `0049_admin_post_edit_rls.sql`; post overflow menu shows *Remove as admin* on own posts (`FR-ADMIN-009`). |
| 0.8 | 2026-05-17 | `FR-POST-008` AC5 + `D-35` — `posts.status_before_admin_removal` captured by `admin_remove_post`; `/profile/removed` splits by prior status. |
| 0.7 | 2026-05-17 | `FR-POST-009` AC5 + `D-34` — owner-driven Hide on `closed_delivered` / `deleted_no_recipient` writes `posts.visibility`; mobile fans out to owner's `surface_visibility`. |
| 0.6 | 2026-05-17 | `FR-POST-009` — visibility may change freely after publish (incl. hide after exposure); `FR-POST-021`/`FR-POST-006`/`FR-POST-008` aligned; migration `0094_posts_visibility_free_change.sql`; decision `D-32`. |
| 0.4 | 2026-05-16 | `FR-POST-022` — save/unsave post bookmarks; migration `0086_saved_posts.sql`. |
| 0.3 | 2026-05-16 | `FR-POST-021` rewritten for the three-axis per-participant model (`surface_visibility` × `identity_visibility` × `hide_from_counterparty`); `FR-POST-017` AC1 updated to point at per-participant `surface_visibility` instead of `posts.visibility` for closed posts. Driven by `D-28` (supersedes `D-19`'s third-party visibility clause; refines `D-26`). Migration `0085_post_actor_identity_audience_split.sql`. |
