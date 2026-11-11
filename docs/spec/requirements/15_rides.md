# 2.14 Rides (Hitchhiking V2.0 → V3.0 — Carpooling for Good)

> ⚠️ **Superseded in part by the project book** — D70–D75 (one rides flow, official places, map, bookings, saved routes, quick publish and feed; gaps G44–G49). Binding text: `docs/spec/05_giving_worlds.md` §5.3. Evidence and status: `docs/spec/95_reconciliation.md` §2. The text below is kept as history (D35).

> **Status:** 🟡 V2.0 minimal product shipped 2026-05-26 (FR-RIDE-001..010 ✅); UI temporarily hidden 2026-05-28 (D-51) while backend hardens. FR-RIDE-011 schema ✅ + FR-RIDE-012 application layer ✅. Backend participants (013–022) ✅ shipped. **V3.0 (2026-05-29) — D-55 supersedes D-51**: rides UI is restored alongside FR-RIDE-019 + FR-RIDE-023..045 to cover the full PRD scope (advanced publish, driver dashboard, active-ride lifecycle, emergency button, ratings, business rules, cross-world). Requires migrations `0122`..`0152` (existing) + `0161`..`0170` (new) on dev DB before runtime use.

Prefix: `FR-RIDE-*`

> **Scope (V3.0).** The Rides world delivers cooperative non-profit transportation across three modalities — passenger lifts, item shipping, and food-delivery shipping — plus a safety overlay (active-ride lifecycle, emergency button) and a settlement loop (post-ride ratings). All money flows are capped to symbolic expense-sharing per `R-Rides-1` / `R-Rides-2`; the platform never settles funds. International rides are banned.

> **Non-goals.** Real on-trip turn-by-turn navigation (we link out to Waze/Google Maps); insurance or driver-license verification beyond a declaration field (`R-Rides-4`); B2B fleet management; payment processing.

## FR-RIDE-001 — Donations entry: טרמפים tile
- AC1. Donations Hub shows tile **טרמפים** routing to `/(tabs)/donations/rides`.
- AC2. Former **תחבורה** tile href becomes `/(tabs)/donations/rides` (same destination).
- AC3. Tile uses existing `DonationTile` / Card styling (FR-DONATE-006 parity).

## FR-RIDE-002 — Rides Hub feed
- AC1. Screen at `/(tabs)/donations/rides` lists open ride listings, `departs_at` ascending.
- AC2. Mixed offer + request cards with mode badge (Hebrew i18n).
- AC3. Free-text search: 300ms debounce, ≥2 chars on title/description/city names.
- AC4. Filter sheet: origin city, dest city, optional date range, mode (all/offer/request).
- AC5. Footer section renders `<DonationLinksList categorySlug="transport" />`.
- AC6 (#1626, binding text `docs/spec/05_giving_worlds.md` §5.3 "Hub screen"). The hub opens on the feed (`list_rides_feed`, D75) on the shared `ListingCard`, grouped today / tomorrow / later. AC3 free-text search and the AC4 filter sheet are replaced by the offers / requests chips plus the route search as a collapsed filter (official places, D71). AC5's links footer starts collapsed. Code: `RidesHubScreen`, `useRidesHubFeed`, `RidesFeedList`, `RideRouteFilter`.

## FR-RIDE-003 — Publish ride (FAB + sheet)
- AC1. Single FAB `+` opens bottom sheet: choose **מציע נסיעה** | **מחפש נסיעה**.
- AC2. Defaults: last mode (AsyncStorage `rides.lastMode`), origin city = profile city, departs_at = now, seats = 3 (offer only).
- AC3. Required: origin city, dest city (≠ origin), departs_at. Offer: seats 1–8. Description optional ≤500.
- AC4. Title auto-generated; user does not edit title.
- AC5. On success: sheet dismisses, feed refetches, `rides.lastMode` saved.
- AC6. *(#1411, 2026-11-04)* **"From my current location"** switch above the origin: on, the origin becomes the official city nearest the device (never raw coordinates; the listing city follows, as for any origin). If the location is denied or unavailable the switch turns itself off and says so; picking the origin by hand also turns it off. *(2026-11-07)* The nearest city must lie within `RIDE_FROM_HERE_MAX_KM` (30 km, `rideOriginFromHere`); a device farther from every official city (e.g. abroad) counts as "location unavailable" instead of getting a far-away city. While the switch is on, the origin picker is hidden and the switch hint reads "locating…" and then "Origin: <place>"; turning it off shows the picker again with the found place, editable. A location read that finishes after the switch was turned off is ignored.
- AC8. *(2026-11-07)* **Drive now → Waze**: after a single ride **offer** is published with both "from my current location" (AC6) and "leave now" (AC7) on, the app opens Waze (`rideNavigationUrl('waze', …)`, universal link — the Waze app when installed, its web page otherwise) navigating to the ride's next stop: the first meeting point, else the destination (`rideNextStop`). Requests, recurring rides and rides with a hand-picked origin or a later departure never open navigation (`shouldNavigateAfterRidePublish`). A failure to open the link is silent; the published ride is unaffected. Code: `navigateAfterRidePublish` (mobile), `rideDriveNow.ts` (domain).
- AC9. *(2026-11-07)* **Private house number.** When the origin or destination is a street, the form offers an optional house number (digits 1–4 with an optional letter, e.g. `12`, `7א`; `isValidRideHouseNumber`) with the note that it is not published. The number never enters the listing details (so it is never in the public listing, its feed post, search or the map): it is saved after publishing to `ride_listing_house_numbers` (`0638`, RLS on, no table grants) through `set_ride_house_numbers(listing, origin?, dest?)` — owner only (`owner_only`), street ends only (`ride_house_number_not_street`), validated (`ride_house_number_invalid`); a blank end clears it. `get_ride_house_numbers(listing)` (listing or post id) returns the numbers only to the driver and to passengers whose booking is `confirmed` / `handed_over`; anyone else gets no rows; anon cannot call it. Those viewers see "Herzl 12, Tel Aviv" on the ride page with a "visible only to you and approved passengers" note, and "navigate" (and AC8's Waze handoff) uses the full address. Scope: origin and destination of single rides; meeting points and recurring rides have no house number yet (the boxes are hidden while "recurring" is on). Code: `rideHouseNumbers.ts` (domain), `Save/GetRideHouseNumbersUseCase` (application), `SupabaseRideHouseNumberRepository` (infra), `afterRidePublished`, `useRideHouseNumbers` (mobile). Tests: `supabase/tests/0638_ride_private_house_numbers.sql` and the unit tests of each layer.
- AC7. *(#1411, 2026-11-04)* **"Leave now"** switch above the departure: on, the ride departs 5 minutes after publishing (`RIDE_LEAVE_NOW_LEAD_MINUTES`; the server rejects a departure at or before its clock). The departure is re-timed at the moment of publishing, so a form left open does not publish a past departure; the estimated end keeps its distance from it. Picking a time by hand (field or shortcut) turns the switch off.

## FR-RIDE-004 — Ride detail + contact
- AC1. `/(tabs)/donations/rides/[id]` shows full listing + owner.
- AC2. Non-owner CTA **שלח הודעה** opens anchored chat (`anchorRideId`) with prefilled template.
- AC3. Owner may **סגור** (`closed`) or **בטל** (`cancelled`).

## FR-RIDE-005 — Chat anchor on ride
- AC1. `OpenOrCreateChatUseCase` accepts optional `anchorRideId` (exclusive with `anchorPostId`).
- AC2. Chat header shows ride summary when `anchorRideId` present (new `AnchoredRideCard`).
- AC3. Prefill key `chat.autoMessage.rideInitial` with ride title.

## FR-RIDE-006 — Permissions
- AC1. Any authenticated user may create offer or request and contact listings.
- AC2. RLS: owner insert/update; select respects `visibility` (Public default).

## FR-RIDE-007 — Visibility (V2.0 minimal)
- AC1. Create always `Public` (no UI for FollowersOnly/OnlyMe in V2.0).

## FR-RIDE-008 — Reporting
- AC1. Report owner from ride detail via existing user report flow (FR-MOD-001).

## FR-RIDE-009 — Domain validation
- AC1. `validateRideDraft` rejects origin === dest, missing seats on offer, seats on request.

## FR-RIDE-010 — Extension ports (no UI)
- AC1. `IRideJoinPolicy` + `IRideMatchScorer` interfaces exist; V2.0 uses DirectChat + chronological sort only.

## FR-RIDE-011 — Ride participants (request / approve / reject / cancel) ✅
> Backend-only as of writing (UI hidden under D-31). Adds a structured "intent of record" alongside the chat thread so rides have a real join model with seat enforcement.

- AC1. `ride_participants` table with row per (ride, user, attempt). Status machine: `requested → {approved, rejected, cancelled}`; `approved → cancelled`. `rejected` / `cancelled` are terminal.
- AC2. Unique-active invariant: at most one `requested` or `approved` row per (ride, user) at any time. Terminal rows accumulate as audit trail; a re-request requires a new row (insert-only via RPC).
- AC3. Seat cap enforced atomically at approve time: `count(status = 'approved') < ride.seats_available` (offers); requests have `seats_available = NULL` ⇒ no cap.
- AC4. RPC `rpc_ride_participants_request(p_ride_id, p_note)` — caller authenticated, not the ride owner, ride is `open` + `Public`. Note ≤ 500 chars optional.
- AC5. RPC `rpc_ride_participants_decide(p_participant_id, p_status)` — caller is ride owner, target row is `requested`, p_status ∈ {`approved`, `rejected`}; on `approved` also revalidates ride still `open` and seat cap.
- AC6. RPC `rpc_ride_participants_cancel(p_participant_id)` — caller is the participant; `rejected` rows are not transitionable; `cancelled` is idempotent.
- AC7. RLS SELECT: row visible to its `user_id` or the ride owner. INSERT/UPDATE/DELETE revoked — all mutations through the RPCs.
- AC8. Domain entity `RideParticipant` + value object `RideParticipantStatus`; application use cases mirror the three RPCs.

## FR-RIDE-012 — Ride participants application use cases ✅
- AC1. `RequestRideJoinUseCase` — wraps `rpc_ride_participants_request`, maps PG errors to domain `RideParticipantError`.
- AC2. `DecideRideJoinUseCase` — wraps `rpc_ride_participants_decide`; rejects non-owner / non-requested / non-open / `ride_full` paths via typed errors.
- AC3. `CancelRideJoinUseCase` — wraps `rpc_ride_participants_cancel`; idempotent on already-cancelled.
- AC4. `ListRideParticipantsUseCase(rideId)` — returns rows for the ride owner (any status); for non-owners, only their own row.
- AC5. `ListUserRideRequestsUseCase(userId)` — returns rows the caller owns, recent first.

## FR-RIDE-015 — Chat system message on ride lifecycle ✅
- AC1. When a ride transitions OUT of `status='open'` (closed / cancelled / expired), every chat with `anchor_ride_id = ride_id` receives a Hebrew system message describing the transition and `system_payload = {kind: 'ride_lifecycle', ride_id, status}`.
- AC2. The system message is emitted BEFORE `anchor_ride_id` is cleared (so the SELECT finds the anchored chats).
- AC3. Owner close/cancel via `CloseRideListingUseCase` and cron-driven expiry both trigger the same emission via the AFTER UPDATE trigger.
- AC4. The trigger function `ride_listings_clear_chat_anchor` is replaced (CREATE OR REPLACE) — the 0137 trigger registration still binds to it.

## FR-RIDE-016 — Realtime subscriptions ✅
- AC1. Tables `ride_listings` and `ride_participants` are members of `supabase_realtime` publication (broadcast still gated by RLS).
- AC2. `IRidesRealtime.subscribeToPublicRideInserts(cb)` — INSERT on `ride_listings` filtered to `visibility=Public`. Signals only; consumer refetches.
- AC3. `IRidesRealtime.subscribeToUserParticipantUpdates(userId, cb)` — UPDATE on `ride_participants` filtered to `user_id=eq.<userId>`. Fires for status transitions on the user's own rows.
- AC4. `IRidesRealtime.subscribeToRideParticipantInserts(rideId, cb)` — INSERT on `ride_participants` filtered to `ride_id=eq.<rideId>`. Lets the owner see new join requests live.
- AC5. Adapter `SupabaseRidesRealtime` mirrors `SupabaseFeedRealtime` (unique topics per call; CHANNEL_ERROR / TIMED_OUT → onError; returned unsubscribe calls `removeChannel`).

## FR-RIDE-014 — Inverse-mode ride matches ✅
- AC1. RPC `ride_listings_find_matches(p_ride_id, p_window_hours, p_limit)` returns rides with the inverse `mode` (offer ↔ request), the same origin/dest city pair, `status='open'`, `visibility='Public'`, and `departs_at` within ±`window_hours` of the source ride.
- AC2. Caller must own the source ride (`auth.uid() = ride.owner_id`); otherwise the RPC raises `not_ride_owner`.
- AC3. Results are ordered by absolute time delta from `source.departs_at` ascending; ties break by `created_at` descending.
- AC4. `window_hours` is clamped to [1, 72] (default 12); `limit` to [1, 50] (default 20).
- AC5. Application: `FindRideMatchesUseCase` + `IRideListingRepository.findMatches`.

## FR-RIDE-018 — Visibility tiers honored end-to-end ✅
- AC1. SELECT RLS on `ride_listings` permits: owner; or (`status='open'` AND (`visibility='Public'` OR (`visibility='FollowersOnly'` AND `is_following(viewer, owner)`))). `OnlyMe` rides are visible only to the owner.
- AC2. `ride_listings_search` widens its visibility predicate identically (SECURITY DEFINER bypasses RLS, so the function body is the source of truth for search results).
- AC3. `rpc_ride_participants_request` widens the joinability check the same way — a follower can request to join a FollowersOnly ride.
- AC4. Creation paths in V2.0 still default to `Public` (FR-RIDE-007). Allowing creation with non-Public tiers requires `CreateRideListingUseCase` to accept a `visibility` input — out of scope for this PR.

## FR-RIDE-022 — Recurring ride templates application layer ✅ (superseded by FR-RIDE-046)
- AC1. Domain entity `RideTemplate` + value object `RideTemplateStatus`.
- AC2. `validateRideTemplateDraft` mirrors `validateRideDraft` (route distinctness + seats-by-mode + description ≤ 500) and adds the recurrence checks (`weekday_mask` ∈ [1,127], `lookahead_days` ∈ [1,30]).
- AC3. Application use cases: `CreateRideTemplateUseCase` (validates + city-catalog check + defaults visibility to `Public`), `ListMyRideTemplatesUseCase`, `SetRideTemplateStatusUseCase` (enforces the status machine — `archived` is terminal), `DeleteRideTemplateUseCase`.
- AC4. Adapter `SupabaseRideTemplateRepository` calls `from('ride_templates')` directly (owner-only RLS handles authz; no SECURITY DEFINER RPCs required for templates).
- AC5. Snake_case → camelCase mapping via `mapRideTemplateRow`.

## FR-RIDE-021 — Recurring ride templates ✅ (superseded by FR-RIDE-046)
> DB schema + materializer + application layer in place; UI follows when the rides hub returns.

- AC1. `ride_templates` table holds one row per recurring slot: owner, mode, route (cities + streets + optional house numbers), `depart_time time`, `weekday_mask` (bitmask Sun=1..Sat=64), `seats_available` (offer-only, NULL on request), `visibility`, `status` ∈ {`active`,`paused`,`archived`}, `lookahead_days` (default 7, clamped 1..30).
- AC2. `ride_listings.template_id` (nullable FK) links materialized instances to their template; `ON DELETE SET NULL` preserves historical rides if the template is deleted.
- AC3. Partial unique index on `(template_id, departs_at::date)` makes the materializer idempotent — concurrent runs cannot duplicate a day.
- AC4. `ride_templates_materialize()` runs daily at `0 2 * * *` UTC. For each active template, it inserts a `ride_listings` row for every matching day in the next `lookahead_days` window that doesn't already have one.
- AC5. RLS on `ride_templates`: owner-only for SELECT/INSERT/UPDATE/DELETE. Templates are private intent; only the materialized public ride instances surface to other users (still gated by their own RLS + visibility tier).
- AC6. Status machine: `active ↔ paused`; either ⇒ `archived` (terminal — owner can re-create a new template if needed). Paused/archived templates do not materialize.
- AC7. Application layer + RPCs (`rpc_ride_templates_*`) ⏳ — follow in a sibling PR.

## FR-RIDE-020 — Owner can update ride visibility ✅
- AC1. RPC `rpc_ride_update_visibility(p_ride_id, p_visibility)` lets the ride owner change visibility on an existing open ride. `p_visibility` ∈ {`Public`, `FollowersOnly`, `OnlyMe`}; anything else raises `invalid_visibility`.
- AC2. Caller authenticated and the ride owner; otherwise `auth_required` or `not_ride_owner`.
- AC3. Target ride must be `status='open'`; closed/cancelled/expired raise `ride_not_open` (re-publish a new ride instead).
- AC4. Idempotent: if `p_visibility` matches the current value, the RPC returns the existing row without writing.
- AC5. Application: `UpdateRideVisibilityUseCase` + `IRideListingRepository.updateVisibility`. Errors map to typed `RideError` codes.

## FR-RIDE-017 — Auto-cancel stale participant requests ✅
- AC1. pg_cron job `ride_participants_expire_stale_check` runs `*/15 * * * *`. It cancels every `requested` row where `ride.departs_at + interval '3 hours' < now()`.
- AC2. System cancellation: `status = 'cancelled'`, `decided_at = now()`, `decided_by = NULL` (system marker).
- AC3. Silent — the decision-notification trigger (FR-RIDE-013) ignores `requested → cancelled` transitions, so no user-visible ping fires.
- AC4. Cadence matches the ride-listings expiry cron (15 minutes ⇒ bounded staleness ≤ ~3h15m past departure).

## FR-RIDE-013 — Ride participants notifications ✅
- AC1. On INSERT (`status = 'requested'`), the ride owner gets a `ride_request` critical notification with the rider's display name and the ride title; deep-link route `/donations/rides/[id]`.
- AC2. On UPDATE `requested → approved`, the participant gets `ride_approved` with the owner's name + ride title.
- AC3. On UPDATE `requested → rejected`, the participant gets `ride_rejected` with the owner's name + ride title.
- AC4. On UPDATE `approved → cancelled` (rider-initiated withdrawal of an approved seat), the ride owner gets `ride_participant_cancelled` with the rider's name + ride title. `requested → cancelled` is intentionally silent (polite withdrawal).
- AC5. Dedupe keys are per (participant, transition) so retries are idempotent.
- AC6. i18n keys live in `apps/mobile/src/i18n/locales/he/modules/notifications.ts` and the matching `supabase/functions/dispatch-notification/i18n.json` (server mirror).

---

## FR-RIDE-019 — Approved participants auto-cancelled when ride leaves `open`
> Backend invariant clarification. Closes the implicit gap: when an owner closes/cancels (or the cron expires) a ride, approved riders' seats must transition to a terminal `cancelled` row with system attribution so that (a) the participant sees their request was no longer reserved, (b) their notification fires (FR-RIDE-013 AC4), and (c) any future seat-count read returns the correct value.

- AC1. On `ride_listings.status` AFTER UPDATE from `open` → {`closed`,`cancelled`,`expired`}, a trigger marks every still-`approved` participant row for that ride as `cancelled` in the same transaction.
- AC1b. **(2026-11-10, `0734`)** On the post record (G1): when `rides_expired_listings_sweep` expires a ride that never set off, its live bookings are cancelled with it: an unanswered request as `expired` (`ride_booking_expired`), a confirmed seat as `system`, and that passenger is told the ride did not run (`ride_booking_lapsed`).
- AC2. System cancellation marker is the same as FR-RIDE-017: `decided_at = now()`, `decided_by = NULL`.
- AC3. The `approved → cancelled` transition fires `ride_participant_cancelled` per FR-RIDE-013 AC4, but with i18n variant key `ride_participant_cancelled_by_owner` when `decided_by IS NULL` AND the parent ride is in {`closed`,`cancelled`,`expired`} (rider-initiated vs system distinction).
- AC4. `requested` rows are handled separately by FR-RIDE-017 (silent cancellation).
- AC5. Idempotent — the trigger filters `WHERE status = 'approved'`; re-runs do nothing.

---

## FR-RIDE-023 — Restore rides hub UI (un-hide V2.0+)
> Reverses D-51's UI-only hide. The hub renders the live in-app rides experience (feed + create FAB + filters) AS THE PRIMARY VIEW; the NGO-links list moves into a collapsible secondary section below the feed.

- AC1. `RidesHubScreen` renders, top-to-bottom: hero header, search bar, filter sheet trigger, ride feed (`RideCard` list), create FAB ("**+**"), and a collapsed `<DonationLinksList categorySlug="transport" />` section labeled "ארגוני הסעה" (default expanded only when feed is empty).
- AC2. The feed pulls from `SearchRideListingsUseCase` (existing) with `status='open'`, ordered by `departs_at ASC`; pagination 30 per page; pull-to-refresh resets cursor.
- AC3. Empty feed shows a Hebrew CTA ("**אין נסיעות פתוחות. פרסם את הראשונה →**") that opens `RideCreateSheet`.
- AC4. Realtime: on `IRidesRealtime.subscribeToPublicRideInserts` signal, a "**N נסיעות חדשות — רענן**" banner appears above the feed (FR-RIDE-016 pattern), identical to feed-banner UX in `FR-FEED-013`.
- AC5. Tab-bar inset honored via `useShellTabBarScrollInset` so the last card clears the floating pill (`FR-RESP-006`).
- AC6. D-55 supersedes D-51; old hide-only fallback is removed.

---

## FR-RIDE-024 — Driver dashboard (my rides as owner)
> The owner of one or more rides needs a single screen to see their published rides, pending requests, and approved riders, with one-tap approve/reject/cancel actions.

- AC1. Route `/(tabs)/donations/rides/my-rides` is reachable from the rides hub via header `🛞 הנסיעות שלי` action and from the profile screen via a row `נסיעות שאני נוהג בהן`.
- AC2. Screen lists my rides where `auth.uid() = ride.owner_id`, grouped by lifecycle bucket: `Upcoming` (open AND `departs_at >= now()`) → `Active` (`status='in_transit'` per FR-RIDE-031) → `Past` (closed / cancelled / expired AND `departs_at < now()` — 30 day window).
- AC3. Each ride row shows: title, departs_at relative time, seats-approved/seats-available, count of pending requests, status pill. Tapping the row routes to ride detail (`[id].tsx`).
- AC4. Pending-requests count is a badge; tapping it expands an inline list of `requested` participants (avatar + display name + optional note) with Approve / Reject buttons that call `DecideRideJoinUseCase`.
- AC5. Owner can `סגור נסיעה` from a row's `⋮` menu (calls `CloseRideListingUseCase` with `status='closed'`) or `בטל נסיעה` (`status='cancelled'` — same use case, separate confirm dialog).
- AC6. Realtime: subscribes `IRidesRealtime.subscribeToRideParticipantInserts` for each Upcoming ride; on event, refetch that ride's participant counts.
- AC7. Empty state: "**עדיין לא פרסמת נסיעה. פרסם את הראשונה →**" with CTA opening `RideCreateSheet`.

---

## FR-RIDE-025 — My ride requests (passenger view)
> Counterpart of FR-RIDE-024: a rider who has requested seats on others' rides needs a single screen to track their request statuses and cancel pending ones.

- AC1. Route `/(tabs)/donations/rides/my-requests` is reachable from the rides hub via header `🧳 בקשות הצטרפות שלי`.
- AC2. Screen pulls from `ListUserRideRequestsUseCase` (existing), recent first. Grouped: `Pending` (`requested`) → `Approved` (active, departs in future) → `History` (terminal: rejected, cancelled, or past approved).
- AC3. Each row: counterpart owner's display name, ride title, departure time, status pill in Hebrew, optional cancel CTA.
- AC4. From `Pending` rows, `בטל בקשה` invokes `CancelRideJoinUseCase`; from `Approved` rows departing > 30 min in future, `בטל הצטרפות` cancels (`R-Rides-5`: free); within 30 min, the cancel CTA shows a confirm warning about rating impact (`R-Rides-6`).
- AC5. Tap on row routes to ride detail.

---

## FR-RIDE-026 — Advanced publish: cargo capacity (items shipping)
- AC1. `RideCreateSheet` advanced section toggle `שינוע חפצים`, default off.
- AC2. When on, the form requires three fields: `cargo_max_volume_l` (1..1000 liters; pick from preset chips or custom), `cargo_max_weight_kg` (1..200 kg), `cargo_allowed_types` (multi-select: רהיטים, מוצרי חשמל, חבילות קטנות, אחר).
- AC3. New columns on `ride_listings`: `cargo_enabled boolean DEFAULT false`, `cargo_max_volume_l int NULL`, `cargo_max_weight_kg int NULL`, `cargo_allowed_types text[] NULL`. CHECK: when `cargo_enabled=true`, `cargo_max_volume_l IS NOT NULL` AND `cargo_max_weight_kg IS NOT NULL`.
- AC4. Domain `validateRideDraft` validates the bounds + array length (1..4); rejects unrecognized type slugs.
- AC5. `RideCard` shows a 📦 chip when `cargo_enabled=true`; `RideDetailScreen` renders a structured "מסוגל לשנע" block.

---

## FR-RIDE-027 — Advanced publish: food shipping (perishable)
- AC1. `RideCreateSheet` advanced section toggle `שינוע מזון`, default off, **mutually exclusive** with `cargo_enabled` (food rides are a separate trip class — chilled, urgent, single-handler).
- AC2. When on, the form requires `food_max_kg` (1..50 kg) and `food_chilled boolean` (default true).
- AC3. New columns: `food_shipping_enabled boolean DEFAULT false`, `food_max_kg int NULL`, `food_chilled boolean NULL`. CHECK: when `food_shipping_enabled=true`, `food_max_kg IS NOT NULL` AND `food_chilled IS NOT NULL`.
- AC4. CHECK constraint: NOT (`cargo_enabled` AND `food_shipping_enabled`).
- AC5. `RideCard` shows a 🍱 chip + `❄️` if chilled; detail screen shows a structured block including pickup-only rule `R-Rides-10` (FR-RIDE-045 AC2).

---

## FR-RIDE-028 — Advanced publish: payment model + cap (R-Rides-1, R-Rides-2)
> ⏸ **UI hidden (PM 2026-11-07)** — rides are completely free in the launch phase; see `docs/spec/05_giving_worlds.md` §5.3 Rules.
- AC1. `RideCreateSheet` advanced section radio `מודל תגמול`: (a) `חינמי` (default), (b) `השתתפות סמלית בהוצאות`.
- AC2. When (b) is chosen, an input `סכום לראש (₪)` accepts integers in [1..70] for intercity (origin_city ≠ dest_city's region) OR [1..20] for intracity (same city). The cap is enforced **client-side + server-side**; server rejects with `RideError.payment_cap_exceeded`.
- AC3. New columns: `payment_model text` (enum `free` | `expense_share`; default `free`), `payment_amount_ils int NULL` (1..70).
- AC4. CHECK constraint: (`payment_model='free' AND payment_amount_ils IS NULL`) OR (`payment_model='expense_share' AND payment_amount_ils BETWEEN 1 AND 70`).
- AC5. Server-side validation: in `rpc_ride_create` (new), reject `payment_amount_ils > 20` when `origin_city_id = dest_city_id`; reject `payment_amount_ils > 70` always.
- AC6. UI label below the input: "המערכת תוסקור אם המחיר חורג מהמותר. **לא מאפשרים נהיגה לרווח**."
- AC7. `RideCard` shows a 💰 chip with `₪X / מקום` if `payment_model='expense_share'`; otherwise no chip (free).
- AC8. `RideDetailScreen` shows the legal disclaimer block explaining `R-Rides-1` and how to report price-gouging.

---

## FR-RIDE-029 — Advanced publish: passenger requirements
- AC1. `RideCreateSheet` advanced section multi-control `דרישות לנוסעים`: (a) `מגדר נוסעים` (radio: any | women-only | men-only), (b) `עישון מותר` (toggle), (c) `בעלי חיים` (toggle), (d) `אישור הורה לקטינים` (always-on note — see FR-RIDE-043), (e) `דרישת וי כחול` (toggle — only approve verified profiles).
- AC2. New columns: `req_gender text` (enum `any|women_only|men_only`; default `any`), `req_smoking_allowed boolean DEFAULT false`, `req_pets_allowed boolean DEFAULT false`, `req_verified_only boolean DEFAULT false`.
- AC3. Server-side enforcement in `rpc_ride_participants_request`: if `ride.req_verified_only AND NOT requester.account_status='verified'`, raise `RideParticipantError.requester_not_verified`. (Gender and other requirements are visible-on-card filters — no server enforcement; respecting them is the rider's responsibility, enforced post-facto via report flow.)
- AC4. `RideCard` shows chips: `👩` / `👨` for gender, `🚭` if no-smoking, `🐾` if pets allowed, `✓` for verified-only.
- AC5. `RideDetailScreen` renders an "**דרישות לנוסעים**" section with full descriptions.

---

## FR-RIDE-030 — Advanced publish: intermediate stops
- AC1. `RideCreateSheet` advanced section: `הוסף עצירת ביניים +` (up to 3 stops).
- AC2. Each stop is a `city_id + optional street + optional notes`; ordered.
- AC3. New table `ride_stops` (FK to `ride_listings`): `stop_id uuid PK`, `ride_id uuid FK`, `sort_order int`, `city_id text FK cities`, `street text NULL`, `notes text NULL ≤200 chars`. RLS: insert/update only via `rpc_ride_create` / `rpc_ride_update_stops` (owner-only).
- AC4. `validateRideDraft` rejects duplicate cities and ≥1 stop matching origin or dest.
- AC5. `RideDetailScreen` renders the route as a vertical stepper: origin → stop 1 → stop 2 → dest.
- AC6. `ride_listings_search` honors stops: a search match is granted if `(origin_city, dest_city)` matches OR if any pair `(stop_i, stop_j)` or `(origin, stop_i)` or `(stop_i, dest)` matches.

---

## FR-RIDE-031 — Active ride state machine (status extension)
> Adds two transient states between `open` and `closed`: `in_transit` (driver started the ride) and `completed_pending_rating` (driver marked arrived; ratings window open for 7 days).

- AC1. Extend the existing `ride_listings.status` enum to: `open` | `in_transit` | `completed_pending_rating` | `closed` | `cancelled` | `expired`.
- AC2. New RPC `rpc_ride_start(p_ride_id)` — caller is owner, ride is `open`, `departs_at <= now() + interval '30 minutes'` (start window: from 30 min before departure onward). Transitions `open → in_transit`. Idempotent on re-entry.
- AC3. New RPC `rpc_ride_arrive(p_ride_id)` — caller is owner, ride is `in_transit`. Transitions `in_transit → completed_pending_rating`. Sets `arrived_at = now()`.
- AC4. Cron `ride_complete_pending_rating_cleanup` runs daily; transitions `completed_pending_rating → closed` for rides where `arrived_at + interval '7 days' < now()`. (Ratings window expires; ride frozen for analytics.)
- AC5. Status transitions outside the FSM raise `RideError.invalid_status_transition`.
- AC6. The chat anchor lifecycle (FR-RIDE-015) emits system messages for `open → in_transit` (`kind='ride_started'`) and `in_transit → completed_pending_rating` (`kind='ride_arrived'`), in addition to the existing terminal transitions.

---

## FR-RIDE-032 — Active ride participant snapshot
> When a ride starts, the set of approved participants is **frozen** to that snapshot for rating + emergency purposes. Late `requested → approved` transitions are blocked once the ride is in_transit.

- AC1. `rpc_ride_participants_decide` rejects `approved` when `ride.status != 'open'`, raising `RideError.ride_not_open`.
- AC2. New column on `ride_participants`: `joined_active_at timestamptz NULL`. On `rpc_ride_start`, set to `now()` for every row where `status='approved'`.
- AC3. `joined_active_at IS NOT NULL` is the source-of-truth for "rode this ride" (ratings + emergency contact + insurance forensics).
- AC4. Participants with `status='approved'` who are NOT in the snapshot (rare edge: approved AFTER start window check was racey; should be 0 in practice) are filtered out of FR-RIDE-037 ratings.

---

## FR-RIDE-033 — Owner check-in: ride start gate
> Surface in the driver dashboard: "**🚗 התחל נסיעה**" CTA, enabled from 30 min before `departs_at` until the ride is marked started.

- AC1. CTA on a ride row (driver dashboard + ride detail) is enabled when `status='open'` AND `now() ≥ departs_at - interval '30 minutes'` AND there's at least one approved participant (or the ride is `mode='offer'` with seats > 0 and the driver explicitly opts in to "no passengers").
- AC2. Tapping CTA calls `rpc_ride_start` and routes to the Active Ride Screen (FR-RIDE-034).
- AC3. If `status != 'open'` or before window, CTA is hidden (state-machine guard).
- AC4. After 6 hours past `departs_at` with status still `open`, the ride is auto-expired by the existing cron (FR-RIDE-017's analog for listings, already implemented in 0135) and CTA disappears.

---

## FR-RIDE-034 — Active ride screen
- AC1. Route `/(tabs)/donations/rides/[id]/active` accessible to owner + approved participants while ride is `in_transit`.
- AC2. Screen shows: ride title, route (origin → stops → dest), participant list (avatars), large `🚨 חירום` button (FR-RIDE-035), and (if owner) `🏁 סיימתי` button calling `rpc_ride_arrive`.
- AC3. Header shows live elapsed time since `started_at`.
- AC4. Footer link: "פתח בווייז ↗" — `Linking.openURL(\`waze://?ll=<dest_lat>,<dest_lng>&navigate=yes\`)` with web fallback to Google Maps. Coordinates come from `cities.latitude`/`longitude` for dest city (already in DB).
- AC5. Pull-down to refresh re-fetches ride + participant state.
- AC6. Realtime: subscribes `subscribeToUserParticipantUpdates(myId)` and a new `subscribeToRideStatusUpdates(rideId)` so all riders see the `🏁 סיימתי` transition immediately.

---

## FR-RIDE-035 — Emergency button (R-Rides-8)
- AC1. The 🚨 button on the active ride screen is visible to owner and every approved participant in the snapshot.
- AC2. Single tap opens a confirm sheet ("**להפעיל קריאת חירום? המערכת תשלח התראה לתמיכה ולמספרים האישיים שלך**"); a second confirm tap dispatches.
- AC3. Dispatch calls new RPC `rpc_ride_emergency_trigger(p_ride_id, p_lat, p_lng, p_note)` which inserts a row into new table `ride_emergency_events` (`event_id`, `ride_id`, `triggered_by`, `triggered_at`, `lat`, `lng`, `note`, `resolved_at`).
- AC4. Trigger on `ride_emergency_events INSERT`: (a) fires `ride_emergency` critical push notification to all super-admins (`is_super_admin=true`) AND to every other approved participant of the ride; (b) emits a chat system message in the support thread of the triggering user with `system_payload={kind: 'ride_emergency', ride_id, event_id}`.
- AC5. The button is **rate-limited** to 1 trigger per user per ride per 5 minutes (DB-side check; `RideError.emergency_throttled`).
- AC6. After triggering, the active ride screen shows a persistent banner "**🚨 קריאת חירום פעילה — תמיכה בדרך**" until resolved (admin marks `resolved_at` in admin portal).
- AC7. Geolocation: if user grants permission, coords are captured at trigger time; if denied, RPC accepts `lat/lng=NULL` and the support thread message says "מיקום: לא משותף".
- AC8. RLS on `ride_emergency_events`: SELECT only by `triggered_by`, ride owner, or super-admin.

---

## FR-RIDE-036 — Optional real-time location sharing (consent-gated)
> Out-of-MVP for first ship; spec'd here to lock the contract.

- AC1. Status: ⏳ Deferred (P3).
- AC2. If enabled, location pings every 60s during `in_transit` to `ride_location_pings(ride_id, user_id, ts, lat, lng)`.
- AC3. Consent toggle per ride, opt-in only, defaults OFF.

---

## FR-RIDE-037 — Post-ride ratings
- AC1. Once a ride transitions to `completed_pending_rating`, owner + each snapshot participant gets a `ride_rate_prompt` notification with deep-link to ratings screen.
- AC2. Each side rates the OTHER side(s) on a 1..5 star scale + an optional ≤300 char Hebrew comment.
- AC3. New table `ride_ratings`: `rating_id uuid PK`, `ride_id uuid FK`, `rater_id uuid FK users`, `ratee_id uuid FK users`, `stars int CHECK (1..5)`, `comment text NULL`, `created_at`. Unique `(ride_id, rater_id, ratee_id)`.
- AC4. RPC `rpc_ride_rate(p_ride_id, p_ratee_id, p_stars, p_comment)`: caller must be owner or a snapshot participant; ratee must be the counterpart (owner-rates-participant or participant-rates-owner only — riders do not rate each other in V3.0).
- AC5. Submit-window: `arrived_at + interval '7 days'`. After window, RPC raises `RideError.rating_window_closed`.
- AC6. RLS: SELECT visible to ratee (their own ratings, aggregated) + super-admin. Rater can see their own. No cross-rider rating leakage.
- AC7. Ratings screen route `/(tabs)/donations/rides/[id]/rate`: lists eligible ratees with star pickers + comment fields; submit one row per ratee.

---

## FR-RIDE-038 — Rating aggregation + display

> ⚠️ **Superseded by the project book** — D24 — users never see ratings, not even their own (gap G4). Binding text: `docs/spec/07_cross_cutting_systems.md` §7.7. Evidence and status: `docs/spec/95_reconciliation.md` §2. The text below is kept as history (D35).
- AC1. New view `user_ride_rating_summary`: `user_id`, `ratings_count`, `avg_stars` (rounded to 1 decimal), `last_rated_at`.
- AC2. Profile screen renders the avg + count (`⭐ 4.8 · 27 דירוגי נסיעות`) only when `ratings_count >= 3` (privacy threshold; below 3, show "**עדיין מעט דירוגים**").
- AC3. Ride detail screen renders the owner's avg under their name.
- AC4. Aggregation refresh: view is materialized? **No** — simple view (cheap enough for MVP scale); refactor to MV when count >= 10k ratings.

---

## FR-RIDE-039 — Late cancellation rating penalty (R-Rides-5, R-Rides-6)
- AC1. If a participant cancels < 30 minutes before `departs_at`, server records `ride_participants.late_cancel = true` and the owner is auto-prompted to give a forced 1-star penalty rating ("**הנוסע ביטל ברגע האחרון — האם להחיל הערכה שלילית?**").
- AC2. If the owner cancels a ride < 60 min before `departs_at` with at least one approved participant, every snapshot rider is prompted to give a forced 1-star penalty rating on the owner.
- AC3. Forced ratings still use `rpc_ride_rate` but with `is_penalty=true` (new column); aggregation includes them with no special weighting (the threshold of 1 star is the penalty).
- AC4. UI Hebrew copy explains: "**ביטולים מאוחרים פוגעים בקהילה. הדירוג השלילי משקף את הנזק.**"

---

## FR-RIDE-040 — Payment cap enforcement end-to-end (R-Rides-1, R-Rides-2)
- AC1. The cap from FR-RIDE-028 AC2 is enforced at three layers: (a) client-side input bounds on `RideCreateSheet`, (b) domain `validateRideDraft.payment` predicate, (c) server-side in `rpc_ride_create` and `rpc_ride_update_payment`.
- AC2. Owner can update payment terms only while ride is `status='open'` AND no `approved` participants exist (prevent bait-and-switch).
- AC3. Any user can report a ride for price-gouging via the existing report flow with new reason slug `ride_payment_above_cap`; super-admin can take down ride + ban driver from rides world for 30 days.
- AC4. Migration adds CHECK constraint at the table level for belt-and-suspenders.

---

## FR-RIDE-041 — Driver license + insurance declaration (R-Rides-3, R-Rides-4)
- AC1. To publish a `mode='offer'` ride, the driver must have declared (one-time, on first publish): (a) `driver_has_license: true`, (b) `vehicle_has_insurance: true`, (c) `accepts_no_profit_rule: true`. Three checkboxes; all required.
- AC2. New table `driver_declarations(user_id PK, declared_at, license_declared, insurance_declared, no_profit_acknowledged)`. Inserted on first publish; updates allowed.
- AC3. Trigger on `ride_listings` BEFORE INSERT WHERE `mode='offer'`: raises `RideError.declaration_required` if no row exists for `owner_id`.
- AC4. The declaration sheet shows the legal text in full Hebrew with clear "**אני מצהיר/ה**" framing; once accepted, future offers don't re-prompt.
- AC5. A revocation path is **out of scope** for V3.0 — to revoke, user must contact support (creates a super-admin task).
- AC6. Declarations are NOT verified (per `R-Rides-4`'s explicit "declaration only" stance); this is a legal/UX shield, not enforcement.

---

## FR-RIDE-042 — Cancellation policy (R-Rides-5, R-Rides-6)
- AC1. Free participant cancellation window: ≥ 30 min before `departs_at` ⇒ no penalty.
- AC2. Late participant cancellation: < 30 min ⇒ FR-RIDE-039 AC1 penalty path.
- AC3. Owner cancellation: any time before `started_at`. If < 60 min before `departs_at` AND ≥ 1 approved participant ⇒ FR-RIDE-039 AC2 penalty path.
- AC4. After `status='in_transit'`, neither side can "cancel" — the ride is in progress. The only mid-ride state change is owner calling `rpc_ride_arrive` early (counts as completed).
- AC5. Cron `ride_no_show_detector` runs daily: rides still `open` 6h past `departs_at` are auto-expired (already by 0135); rides `in_transit` 24h past `departs_at` are flagged as anomalies for super-admin review (new admin task `ride_long_in_transit`).

---

## FR-RIDE-043 — Minor consent (R-Rides-9)
- AC1. When a requester's `birthdate` (from `users` table; if NULL, treated as `>= 18` and we skip this gate) implies age < 18, `rpc_ride_participants_request` requires `p_parent_consent_token` to be present and validates it against `minor_consent_tokens` table.
- AC2. New table `minor_consent_tokens(token uuid PK, user_id FK users, parent_email_or_phone text, issued_at, used_at NULL, expires_at = issued_at + interval '30 days')`.
- AC3. Mobile UX: when a minor attempts to request a ride, the form blocks and shows "**אתה צעיר/ה מ-18. נדרש אישור הורה**" with a CTA "**קבל קישור לאישור**" that triggers an Edge Function emailing/SMSing the parent with a single-use signed link. Out-of-band parent flow consumed via a public route `/parent-consent/<token>` that marks token `used_at`.
- AC4. After consent is granted, the minor's profile flips `minor_consent_active=true` for that month; subsequent requests skip the gate within the window.
- AC5. If `birthdate` is missing, request goes through; super-admin may post-facto require birthdate setting via task.

---

## FR-RIDE-044 — Cross-world: link an items post to a ride (shipping)
> The first concrete cross-world integration. A donor of a furniture/large item can publish a ride request that auto-links to a `posts` row (items world); a driver scanning the rides feed can see "I'm transporting this item too" and bid on it via chat.

- AC1. New column on `ride_listings`: `linked_post_id uuid NULL FK posts(post_id) ON DELETE SET NULL`. CHECK: when set, `mode='request'`.
- AC2. From a post detail screen (when `post.type='give'` AND post owner is the viewer AND `cargo_required_volume_l > 80` — a future-deferred field; for V3.0 always available on `give` posts), an action "**🚗 בקש שינוע**" opens `RideCreateSheet` pre-filled with `mode='request'`, origin = post pickup city/address, destination = "**לבחירת המשנע**" (left blank — the driver later fills via approval workflow).
- AC3. `RideDetailScreen` renders an `AnchoredPostCard` (existing component) when `linked_post_id IS NOT NULL`, with a tap-to-open hookup to the post.
- AC4. New view `posts_with_open_ride_request` joins posts + rides for the feed; an item post that has an open ride request shows a 🚗 chip on its card ("**שינוע מבוקש**").
- AC5. When the post is closed (delivered), the linked ride auto-closes via trigger; the closure flow ships its existing chat system message.

---

## FR-RIDE-045 — Edge cases catalog (R-Rides-10 + PRD §15 enumeration)
> Single FR enumerating MVP-relevant edge cases with their handlers.

- AC1. **Driver no-show.** If a snapshot participant taps "**הנהג לא הגיע**" in active ride screen, ride is auto-cancelled (status → `cancelled`), penalty rating applied to owner (FR-RIDE-039 AC2 path).
- AC2. **Food spoilage (R-Rides-10).** Food rides have a server-enforced pickup window of `departs_at + interval '2 hours'`. If owner doesn't mark arrived within window, cron `ride_food_overdue_alert` flags the ride for admin attention. The driver can mark the food as "**נמסר לארגון מזון אזורי**" — sets a new `ride_listings.food_handover_to_org boolean DEFAULT false`.
- AC3. **International rides ban.** Server-side check in `rpc_ride_create`: if both cities' country code != 'IL', raise `RideError.international_rides_banned`. (Currently both ends are constrained to `cities` table which is IL-only, so this is a forward-compat guard.)
- AC4. **Vehicle breakdown.** Owner cancels the ride mid-transit by calling `rpc_ride_arrive` early with `p_reason='breakdown'`; participants get a critical notification `ride_breakdown` with the owner's note. (Same RPC; the reason becomes a chat system message variant.)
- AC5. **Spontaneous publish.** Quick-publish mode with `departs_at=now()` and no approved participants is the empty-ride happy path: owner can simply not start. No special handling needed; the ride expires after 3 hours (0135).

---

## FR-RIDE-047 — The driver cancels a ride that has bookings ⏳
> PM decision `{{D:owner-cancel-notifies-registrants}}` (2026-11-11), extending D131 from events to rides.

- AC1. A driver may pause or delete a ride, or a single occurrence of a recurring ride, that has booked passengers. Before departure, every requested or confirmed seat is cancelled (`host_cancelled`) and each passenger gets one notification (`ride_booking_withdrawn`: the driver cancelled the ride; the booking is cancelled; look for another ride).
- AC2. A booking the driver cancels on its own (`cancel_ride_booking`, `driver_cancelled`) keeps its notification and may still be reinstated; a ride the driver called off (`host_cancelled`) is not reinstated.
- AC3. After departure, bookings are not cancelled by a pause or delete (the trip ran or lapses through FR-RIDE AC1b).
- AC4. Completing the trip (`complete_ride_listing`) is unchanged.

## FR-RIDE-046 — Recurring rides on the one rides flow ✅
> Issue #1413; product decision D103; `docs/spec/05_giving_worlds.md` §5.3 step 1. Supersedes FR-RIDE-021/022 (legacy `ride_templates` → `ride_listings`).

- AC1. `ride_series` (`0531`): owner, kind, direction, title, summary, the ride details template (route, seats, cost — never the times), `depart_time` (Israel time), `weekdays` bit mask (bit 0 = Sunday, 1..127), optional `duration_minutes`, `starts_on`, optional `ends_on`, `status` ∈ {`active`, `paused`, `cancelled`}. RLS: the owner reads their own rows; every write goes through an RPC.
- AC2. An occurrence is an ordinary native ride listing whose `details.ride_series = {id, on, weekdays, time}` (both ride kinds' detail schemas accept it); a partial unique index keeps one occurrence per series and day. Feed, search, matching, bookings, saved-route alerts, cost cap and the emergency call work on it unchanged.
- AC3. `ride_series_materialize(series?)` publishes the missing occurrences for today … today + 30 (Israel dates) whose departure is still ahead; `arrives_at` = departure + `duration_minutes`; a request occurrence expires 30 minutes after departure. Runs on create, resume and reschedule, and from `ride_series_sweep` every 10 minutes, which also expires departed request occurrences.
- AC4. Noise control: only the soonest upcoming occurrence of a series is mirrored into the main feed (`listings_feed_mirror_sync` skips the others); when it departs the sweep mirrors the next one. The rides feed (`list_rides_feed`) lists every occurrence of today and tomorrow (Israel time) and, from the day after tomorrow on, folds a series into its earliest remaining occurrence with `series_more` = the count of later dates. A saved-route follower is alerted once per series (`listings_ride_route_alerts`), not once per day.
- AC5. `create_ride_series(kind, title, details, direction, depart_time, weekdays, summary?, duration?, ends_on?)` → `(series_id, first_listing_id)`: active member, rides kind, the template validated as the occurrence it becomes, weekdays 1..127 (`ride_series_weekdays_invalid`), duration 1..1440 (`ride_series_duration_invalid`), end date not before today (`ride_series_ends_in_past`); refused when no occurrence would run (`ride_series_no_occurrence`).
- AC6. `set_ride_series_status(series, status)`: owner only (`ride_series_not_found`); `active ↔ paused`, either → `cancelled` (terminal, `ride_series_cancelled`). Pausing deletes the upcoming occurrences nobody booked; a booked occurrence stays an open ride. Resuming materializes again. **Cancelling the series cancels every upcoming occurrence, booked ones included: each booked passenger's seat is cancelled and the passenger is told the driver cancelled the ride** (FR-RIDE-047, `{{D:series-end-cancels-booked}}`).
- AC7. `update_ride_series(series, depart_time, weekdays, duration?, ends_on?)`: same checks; upcoming unbooked occurrences are replaced at the new schedule, a booked one keeps its agreed time. The route and the offer are not editable — publish a new series.
- AC8. `list_rides_feed` returns `recurrence` (the marker) and `series_more` per row; `list_ride_series_occurrences(series, limit?)` (public read, anon + authenticated) lists the series' upcoming open occurrences the caller may see, with free seats / passengers, so an occurrence shows "other dates" (`RideSeriesOccurrences`) and a tap opens the day to book. App: the "recurring ride" switch under the schedule in the create form (`RideRecurrenceFields`: weekdays, optional end date; the departure field's time of day is the series time) publishes through `CreateRideSeriesUseCase` and opens the first occurrence; cards and the ride detail show "every Sun–Thu at 07:30" (`rideSeriesLabel`); the owner reaches `/donations/rides/series` (`MyRideSeriesList`: pause / resume, reschedule, cancel behind a confirm step) from the rides hub and from an occurrence.
- Tests: `supabase/tests/0531_ride_series.sql` (materialization, idempotency, feed mirror hand-over, one alert per series, request expiry, pause / resume / reschedule / cancel with a booked occurrence, ownership and schedule checks, grants); `@kc/domain` `RideSeries.test.ts`; `@kc/application` `rideSeriesUseCases.test.ts`; `@kc/infrastructure-supabase` `SupabaseRideSeriesRepository.test.ts`; mobile `RideRecurrenceFields`, `MyRideSeriesList`, `RideSeriesOccurrences`, `ListingCreateForm` (series publish), `RidesFeedList`, `RideRouteCard`, `DateTimeField` (date / time modes).

---

## Notifications (consolidated catalog)

| Notification key                        | Triggered by                                              | Recipients                          | Critical |
| --------------------------------------- | --------------------------------------------------------- | ----------------------------------- | -------- |
| `ride_request`                          | `ride_participants` INSERT (`requested`)                  | Ride owner                          | ✅       |
| `ride_approved`                         | `ride_participants` UPDATE (`requested → approved`)       | Participant                         | ✅       |
| `ride_rejected`                         | `ride_participants` UPDATE (`requested → rejected`)       | Participant                         | —        |
| `ride_participant_cancelled`            | `ride_participants` UPDATE (`approved → cancelled`)       | Ride owner                          | ✅       |
| `ride_participant_cancelled_by_owner`   | `ride_participants` cancelled via FR-RIDE-019             | Participant                         | ✅       |
| `ride_started`                          | `ride_listings.status open → in_transit`                  | All approved participants           | ✅       |
| `ride_arrived`                          | `ride_listings.status in_transit → completed_pending_rating` | All snapshot participants        | —        |
| `ride_rate_prompt`                      | Same trigger as `ride_arrived` (24h after)                | Owner + snapshot participants       | —        |
| `ride_emergency`                        | `ride_emergency_events` INSERT                            | Super-admins + other snapshot riders | ✅       |
| `ride_breakdown`                        | `rpc_ride_arrive(... p_reason='breakdown')`               | Snapshot participants                | ✅       |
| `ride_match_found`                      | `ride_listings_find_matches` polled / realtime fired      | The querying owner                  | —        |

---

## Permissions matrix (V3.0)

| Action                                       | Guest | Auth user | Verified user | Super-admin |
| -------------------------------------------- | ----- | --------- | ------------- | ----------- |
| Browse rides feed (Public)                   | ❌    | ✅        | ✅            | ✅          |
| Publish ride request (`mode='request'`)      | ❌    | ✅        | ✅            | ✅          |
| Publish ride offer (`mode='offer'`)          | ❌    | ✅ + declaration | ✅ + declaration | ✅ |
| Join a ride (request seat)                   | ❌    | ✅        | ✅            | ✅          |
| Join a `req_verified_only=true` ride         | ❌    | ❌        | ✅            | ✅          |
| Approve/reject join requests                 | ❌    | Owner only| Owner only    | ✅          |
| Trigger 🚨 emergency                          | ❌    | Snapshot only | Snapshot only | ✅      |
| Resolve an emergency event                    | ❌    | ❌        | ❌            | ✅          |
| Ban driver for `ride_payment_above_cap`       | ❌    | ❌        | ❌            | ✅          |

---

## Success metrics (V3.0)

| Metric                                                    | Target (steady-state) |
| --------------------------------------------------------- | --------------------- |
| Open rides per week (active community)                    | ≥ 20 / 100 MAU        |
| Request → approved conversion                              | ≥ 40%                 |
| Cancellation rate (< 30 min)                              | ≤ 5% of all approvals |
| Emergency button false-trigger rate                       | < 1% (manual review)  |
| Avg driver rating                                          | ≥ 4.6 / 5             |
| Cross-world item-shipping pairings (rides linked to posts) | ≥ 5 / 100 give-posts  |

