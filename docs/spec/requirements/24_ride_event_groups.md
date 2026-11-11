# 2.24 Event ride groups (קבוצות טרמפים לאירוע)

> **Status:** ⏳ Spec v3 draft (2026-11-11), **pending PM approval**. Nothing is implemented. Product decision: `{{D:event-ride-groups}}`; working assumptions are the `S` fills below; implementation gap: `{{G:event-ride-groups}}`. v3 = v2 (PM direction: each publisher chooses a ride's audience and anonymity; the first release is the group as an organized board with a one-tap post) **plus** the findings of three independent reviews (privacy and abuse, performance and scale, feasibility against the code). Delivery plan: [`docs/SSOT/archive/superpowers/plans/2026-11-11-event-ride-groups.md`](../../SSOT/archive/superpowers/plans/2026-11-11-event-ride-groups.md).

Prefix: `FR-EVRIDE-*`

> **Source of truth.** Product book [`05_giving_worlds.md` §5.3](../05_giving_worlds.md) wins where it disagrees (D35). Built on the one rides flow (D70–D75, D103): a group ride **is** an ordinary ride post, so places, seats, bookings, the cost caps, the emergency call, karma and completion are reused. Also: D16 (visibility and anonymity), D23 (verification shown, not blocking), D31 (events), D33 (reports), D95 (rides urgency), `G61` (one status graph per lifecycle), [ADR-006](../../architecture/adr/ADR-006-one-post-model.md), [ADR-007](../../architecture/adr/ADR-007-event-group-audience.md).

> **Why.** A rides group lives in WhatsApp today: "who drives from Haifa to the wedding? who takes me home at 1am?". A ride in the general feed reaches strangers, exposes the event and drowns among unrelated rides. An **event ride group** is a small room around one event (wedding, party, bar mitzvah, concert, conference, trip, funeral). Its members see its rides in one orderly place; each publisher decides who else may see a ride; every ride is **to** or **from** the event; the organizer sees whether everyone has a way there and back. Each group is also an acquisition channel: one wedding brings 100–500 guests through one link (D38, D47). The feature is expected to be popular from day one, so speed, privacy and the night-return experience are requirements, not polish.

> **Scope.** Create a group; invite by link, code or QR; join; publish and book rides inside it; announcements; the lifecycle (moved, cancelled, ended, archived, purged); moderation; analytics; performance budgets; the UX contract.

> **Non-goals.** Group chat (a different chat model, P3, `FR-EVRIDE-032`); tickets or any fee (always free, `S55`); cost splitting (rides are free at launch); live location sharing (`FR-RIDE-036`); chartered shuttles; running the event itself (guest list, RSVP: an organization's event is `G18`); importing a WhatsApp group (`G27`); recurring event rides.

## Design principles

1. **Minimum exposure.** Every screen and push shows the least that still works; precision is revealed by booking, not by browsing.
2. **Fail closed.** A reader that forgets the audience rule returns nothing (ADR-007).
3. **Fast by construction.** A post is two taps and a city; the board paints from cache in ≤ 300 ms; budgets are in `FR-EVRIDE-023`.
4. **The ride home is first-class.** Midnight returns are the heart of a wedding; they get their own nudges, live status and exemptions from quiet hours.
5. **Reuse the rides flow.** No second booking engine, no second places catalog, no second emergency button.
6. **Measure everything that can fail** (analytics, alerts, load tests) and keep a kill switch.

## Terms

| Term | Meaning |
|---|---|
| Event ride group (**group**) | The room around one event: organizer, members, event place and window |
| Event place | An official place (D71) — city, optional official street, optional house number — the fixed end of every group ride; a venue label is descriptive and never routes |
| Leg | `to_event` (ends at the event place) or `from_event` (starts there) |
| Group ride | A ride offer or request that carries a group and a leg |
| Audience | Who may see a group ride beyond its publisher: `group_only` (default), `group_and_followers`, `everyone` |
| Ceiling | The widest audience the organizer allows in the group |
| Name display | `named` or `anonymous` (name and avatar hidden until a booking is confirmed; city and time stay visible) |
| Organizer / co-organizer | The one creator / up to 3 promoted members (everything but delete or transfer) |
| Member | A person with an `active` membership |

## Product decisions recorded for this spec (pending PM approval; defaults apply until answered)

| ID | Decision (working assumption) |
|---|---|
| `{{S:event-group-access-model}}` | Groups are **invite-only and unlisted** by default; public (listed) groups arrive in P2. Join by link, code or QR |
| `{{S:event-group-ride-audience}}` | The publisher of each ride chooses its audience (`group_only` default, `group_and_followers`, `everyone`) and its name display; the organizer sets a **ceiling** (default `group_only` for an invite-only group). A `group_only` ride never reaches the general feed, search, map, matching, saved-route alerts, subscription alerts, embeddings, the WhatsApp bot, public statistics or a non-member's push; it is stored fail-closed (ADR-007) |
| `{{S:event-group-nonmember-view}}` | A non-member who can see a wider-audience ride sees an ordinary ride whose event end is shown at **city level**, with no group name and no "event" marker. The exact event place is shown only to members and to passengers with a confirmed booking. A non-member's booking always needs the driver's approval (as every booking does, D73), shown to the driver as "not in the event group" |
| `{{S:event-group-origin-privacy}}` | Members see a ride's other end at **city** level; a **request** shows its origin city only to members who have an active offer on that leg. The street, junction and private house number go only to the driver and confirmed passengers, and the exact start of a ride is the **meeting point the driver picked**, never a home address |
| `{{S:event-group-join-controls}}` | The link is a bearer secret, so joining has brakes: a **join spike freeze** (> 60 joins in 10 minutes pauses joins and alerts the organizer), a one-tap **freeze joins**, an optional **join note** ("who invited you") shown to the organizer, a **join log** (time and count only), **bulk removal by join time**, and `approval` as a switch. A member removed from an open group needs re-approval to return |
| `{{S:event-group-no-group-chat}}` | No group chat in P1/P2: pair chat per ride (inquiries limited, `FR-EVRIDE-018`) plus one-way organizer announcements |
| `{{S:event-group-request-flow}}` | A request is answered by a driver's **"I can take you"** offer; the requester accepts or declines; no member opens a chat with a requester unasked |
| `{{S:event-group-night-return}}` | The ride home is first-class: a "leaving now" live status, a "no ride home yet" nudge at `ends_at − 1 h`, a departure-update push, and an exemption of event-window pushes from quiet hours (`starts_at − 2 h … ends_at + 3 h`) |
| `{{S:event-group-content-filter}}` | Titles, notes, constraints and announcements are screened for phone numbers, links and payment words (rides are free); a hit is refused with a clear message |
| `{{S:event-group-retention}}` | Retention (pending counsel): membership rows, announcements and join notes purged at `ends_at + 30 d`; invite hashes at the end of the event; private house numbers at `ends_at + 7 d`; closed rides keep only city-level places after `ends_at + 30 d`; organizer-action audit 12 months; no group ride is ever embedded or sent to a third party |
| `{{S:event-group-limits}}` | One config object `EVENT_RIDE_GROUP_LIMITS`: title 3–80, description ≤ 500, note ≤ 280; event ends in the future, starts ≤ 365 d ahead, lasts ≤ 14 d (default 6 h); ≤ 3 active groups per organizer (≤ 5 creations/day, account ≥ 24 h old), ≤ 3 co-organizers; members 2–1000 (default 500); ≤ 20 active groups per person; per member and leg ≤ 3 active offers and ≤ 1 active request (the existing 20 open posts per person still applies); ≤ 5 announcements/day, ≤ 70 per group; invite code 10 characters |
| `{{S:event-group-lifecycle}}` | Publishing is open until `ends_at + 12 h`; the group is **ended** (read-only, running rides finish) from then, **archived** at `+7 d`, personal data purged per the retention fill. An organizer may extend `ends_at` while the group is still within its 12 h grace |
| `{{S:event-group-ride-windows}}` | `to_event` departs between `starts_at − 24 h` and `ends_at − 1 h`; `from_event` between `starts_at` (a mid-event return is legal) and `ends_at + 24 h`; a request follows the same windows. Publishing closes at `ends_at + 12 h` whatever the departure |
| `{{S:event-group-leg-rule}}` | A person holds at most **one confirmed booking per leg of a group**; a driver's second confirmation is refused (`leg_already_covered`, never naming the other ride); a confirmation supersedes the person's other pending bookings on that leg (cancel reason `superseded`, the housing pattern) |
| `{{S:event-group-notification-budget}}` | Group-level pushes carry **no ride details** ("יש עדכון בקבוצה"); no push per new ride; ≤ 6 non-booking pushes per member per group per day (booking, safety, cancel and move are exempt); counted at enqueue; an organizer digest for join requests above 50 members |
| `{{S:event-group-mvp-board}}` | Delivery in release trains: **R1 closed pilot** (the group as an organized board with a quick post) → **R2 launch quality** (announcements, request answering, night-return tools, trust details, analytics) → P2 → P3. See the plan |
| `{{S:event-group-sober-driver}}` | A return-leg driver may tick a self-declared "sober driver" chip (P2); a declaration, never a check |

## Who sees a ride (normative matrix)

`G` = viewer is an active member of the ride's group · `F` = viewer follows the publisher · rows evaluated top to bottom, first match wins. "Blocked" = either side blocked the other.

| # | Viewer | Rule |
|---|---|---|
| 1 | The publisher | Sees and manages it |
| 2 | Blocked either way | Never sees it or its chat card |
| 3 | A person with a booking on it (any status), after the ride narrowed or the group left/removed them | Keeps access to **their own booking and its chat**, not to the ride in lists |
| 4 | `G`, group `active/ended/archived/cancelling` | Sees it in the group's area and its detail whatever the audience, **except** a request's origin city (`S` origin privacy) |
| 5 | `audience = everyone` | Sees an ordinary ride (event end at city level) |
| 6 | `audience = group_and_followers` and `F` | Sees an ordinary ride (event end at city level) |
| 7 | Anyone else | Not available, indistinguishable from a deleted post |

Operators (KC admin) reach rides only through audited admin tools, never through reader functions. A closed ride (trip completed) follows rows 1–3 and 7 only: completion never widens it.

## Roles & permissions

| Action | Signed out | Non-member | Pending | Member | Co-organizer | Organizer | KC admin |
|---|---|---|---|---|---|---|---|
| Open an invite link | landing + sign-in | minimal preview | minimal preview | opens the board | ✅ | ✅ | ✅ |
| Join / request to join | ❌ | ✅ | — | — | — | — | ✅ |
| See the group, board, announcements | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ (audited) |
| Publish a ride, choose its audience and name display | ❌ | ❌ | ❌ | ✅ (within the ceiling) | ✅ | ✅ | — |
| Book a seat | ❌ | per the ride's audience | ❌ | ✅ | ✅ | ✅ | — |
| See / share the invite link | ❌ | ❌ | ❌ | per setting | ✅ | ✅ | ✅ |
| Approve/decline, remove, ban, freeze joins, bulk-remove | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Announce, edit the event, set the ceiling | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Promote/demote, transfer, cancel the group | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Hide / remove a group (moderation) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

Every action requires an `active` account (suspended and pending-deletion accounts are refused, S2). A person organizes; an organization profile cannot own a group in P1. Known minors (date of birth < 18) can join as passengers only: no offers, audience fixed to `group_only`, never `named` to non-members (S16 applies to the rest).

## Data model (summary; final in the migrations)

- `ride_event_groups` — organizer, title, event kind, `starts_at`, `ends_at`, event place (kind, id, label, coordinates, house number), venue label, access note, `join_policy` (`open_with_link` | `approval`), `joins_frozen`, `ride_audience_ceiling`, `invite_sharing`, `member_cap`, `member_count`, `visibility` (`invite_only` | `public`), `status`, token and code hashes, `purge_at`, `board_rev` (coalesced realtime ping).
- `ride_event_group_members` — (group, user) primary key; `role`; `status` (see the membership graph); `join_note`; `joined_at`; `decided_by`. Indexes: `(user_id) where status='active'`, `(group_id) include (user_id) where status='active'`.
- `ride_event_group_updates` (announcements), `ride_event_group_join_attempts` (failed-code counters), `ride_event_group_audit`.
- Ride extension on `ride_post_details`: `event_group_id`, `event_leg`, `audience`, `name_display`, `seats_booked` (maintained by the booking RPCs) and, in P2, `paired_post_id`. A CHECK keeps `event_group_id` and `event_leg` together. Group, leg, audience, event end and name display are **never accepted from the client `details` JSON**: only the group RPCs write them. Partial indexes: board `(event_group_id, event_leg, departs_at, post_id) where event_group_id is not null`; global readers `(departs_at) where event_group_id is null`.
- Stored visibility mirrors the audience (`OnlyMe` / `FollowersOnly` / `Public`) as the fail-closed layer of ADR-007; the triggers that key off `OnlyMe` (operator-case queue, anonymity derivation, public counters) skip group rides.
- Config flag `app_flags.rides_event_groups_enabled` (the pattern of `0441`).

## Status graphs (declared in `@kc/domain` `fsm/machines/`, mirrored in `fsm_state` / `fsm_edge`, G61)

- **Group:** `active → ended → archived → purged` · `active|ended → cancelling → cancelled` (cancelling = tokens dead, board closed, cascade running) · `cancelled → active` (un-cancel within 24 h while the event is in the future; rides stay cancelled) · `active ↔ hidden_pending_review` · any `→ removed_admin` (restore returns to the previous state). **Effective state is derived from timestamps inside every RPC**; the sweep only persists it, so a late sweep never lets an action through.
- **Membership:** `(none) → pending` (approval) `| active` (open) · `pending → active | declined | cancelled` (group ended/cancelled, or withdrawn) · `active → left | removed | banned` · `left → pending|active` (per policy) · `removed → pending` (re-approval, even in an open group) · `banned → (none)` by unban only · `declined → pending` (once more, after 24 h).

## Errors (typed codes; user-facing keys in i18n)

`feature_disabled` · `group_not_found` (generic: unknown, rotated, expired, banned and dead links all answer this, same shape and timing) · `group_not_active` · `group_ended` · `group_full` · `joins_frozen` · `not_a_member` · `already_member` · `join_attempts_locked` · `account_too_new` · `group_limit_reached` · `member_cap_below_members` · `event_window_invalid` · `ride_place_invalid` · `ride_outside_event_window` · `audience_above_ceiling` · `ride_limit_reached` · `leg_already_covered` · `leg_unavailable` · `organizer_must_transfer` · `transfer_target_invalid` · `announcement_rate_limited` · `announcement_total_limit` · `content_not_allowed` · `organizer_banned_from_creating` · `minor_not_allowed`.

## Concurrency (normative)

- **Lock order:** group row → advisory lock `(group, person, leg)` → ride posts in ascending id → handoffs. Join, cancel, ceiling change, joins freeze and member removal take the group row `for update`; publish and booking take it `for share`.
- Mutating RPCs accept a client `request_id` and are idempotent on it (double taps on a weak venue connection are certain).
- Every case below has a paired-transaction SQL test: join vs last place · join vs rotation · join vs ban · publish vs ceiling lowering · audience change vs booking · two drivers confirming one passenger · removal vs confirmation · cancel vs booking · un-cancel vs republish · two organizers deciding one request · transfer vs organizer deletion · move vs publish near a window edge.

## Retention and erasure

| Data | Purpose | Kept until |
|---|---|---|
| Invite hashes | Joining | The event's end |
| Join notes | Organizer decisions | `ends_at + 30 d` |
| Private house numbers | Pickup | `ends_at + 7 d` |
| Membership rows, announcements | Operation, disputes | `ends_at + 30 d` |
| Closed rides' places | History of participants | City level after `ends_at + 30 d` |
| Organizer-action audit, bans | Safety | 12 months |
| Aggregate counters | Product analytics | Indefinitely |

An account's deletion removes its memberships at once, cancels its rides through the existing deletion flow, and pseudonymizes its audit rows. Embeddings and third-party processing never apply to group rides. Periods are working values pending counsel (Amendment 13 review, L1).

## Performance budgets (p95 unless stated)

| Item | Budget |
|---|---|
| Board first content from cache | ≤ 300 ms · network refresh ≤ 800 ms on 4G |
| Board reader (30 rows, keyset) | ≤ 150 ms server |
| Counters | ≤ 20 ms |
| Join RPC | ≤ 150 ms (the group lock is held only for the cap check, count and insert; notifications run after commit) |
| Quick-post sheet opens | ≤ 250 ms · publish RPC ≤ 300 ms · median time on task ≤ 10 s, ≤ 3 taps for a repeat poster |
| Cancel RPC returns | ≤ 100 ms (state flip); cascade done ≤ 60 s for 500 bookings |
| Push fan-out | 95% of 500 recipients ≤ 60 s; moved ≤ 30 s; duplicates 0 |
| Realtime | ≤ 1 board ping per 5 s per group, ids and counters only; delivery ≤ 2 s |
| Invite landing | LCP ≤ 1.2 s on 4G (p75) |

## UX specification

**Screens and their rules**

1. **Hub card** "האירוע שלך": nearest upcoming group (title, countdown, "N rides"); collapses once I hold a confirmed seat on both legs, and after the event.
2. **Create** (one screen, ≤ 60 s): title, kind chips, date and time, event place, one **privacy preset** ("פרטי לאורחים — מומלץ" / "פתוח עם הקישור"); everything else (end, cap, approval, ceiling, notes) behind "הגדרות מתקדמות". Success lands on the invite screen. Kind sets the tone of the copy (celebration / neutral / memorial; a memorial uses no cheerful empty states).
3. **Invite**: a big "שיתוף בוואטסאפ" with a ready message (no event details), copy, a full-screen QR, the code in large type, a three-item organizer checklist (share, ask three drivers to post, pin the link).
4. **Join**: the static landing opens in ≤ 1.2 s with "open in the app" / "continue on the web" / store links; after tapping, **minimal sign-up** (phone or e-mail only; the profile wizard is deferred until after joining, with a "step 1 of 2" indicator); the signed-in preview shows title and organizer name only; a join note when the group asks; a pending state reads "ממתין לאישור המארגן" with a rate-limited "תזכורת למארגן".
5. **Board**: header (title, date, place — exact for members — countdown, "navigate"), pinned announcement, two tabs **הלוך / חזור**, offers and requests chips, text-only compact cards (time, origin city → event, seats, name or "מצטרף/ת אנונימי/ת", verification badge, a small chip when the audience is wider), a floating button with **"יש לי מקום ברכב"** and **"מחפשים טרמפ"**, "ride home" panel from `ends_at − 2 h`, organizer strip, **states**: skeleton, cached-then-refresh, offline banner, error with retry, empty ("היו הראשונים"), filtered-empty, ended, cancelled, hidden. Before/during/after the event grouping for returns.
6. **Quick post sheet**: (1) **leg is an explicit choice** (two big buttons, never guessed), (2) origin city (recent and "my location" chips), time (smart chips relative to the event, "בערך" allowed on both legs), seats stepper, (3) "עוד אפשרויות" collapsed: audience (always defaults to **group only** for each group, never inherits a wider past choice), name display (remembered, shown as an inline chip), meeting points, note; one **Publish** button. Wider audiences show a plain warning ("הנסיעה תהיה גלויה גם למי שמחוץ לקבוצה").
7. **Ride detail and booking**: route, "בקשת מקום" with a seat stepper; after confirmation the driver's photo and optional car details, a "navigate" button, an opt-in "אפשר להתקשר אליי" contact consent, the pair chat, and "I'm here".
8. **Manage** (organizer): requests with note and bulk actions, members (counts only per city, ≥ 5), join log, freeze joins, ceiling, announcements, invite rotation, cancel.

**Principles.** Hebrew first, gender-neutral phrasing ("יש לי מקום ברכב", "מחפשים טרמפ", no slash forms), neutral decline copy ("לא התאפשר להצטרף כרגע"), full RTL, text scaling, 48 dp targets, screen-reader labels, color never the only signal, optimistic updates with an idempotent retry, haptics on confirm, skeletons instead of spinners, no blocking modals during the event window.

---

## Phase 1 — The group as an organized board

## FR-EVRIDE-001 — Entry points
- AC1. The rides hub header gets **"קבוצות לאירועים"**: my groups (active first, then past), "הצטרפות עם קוד", "קבוצה חדשה"; the hub card of UX 1 sits above the feed.
- AC2. The create-post "+" never offers a group ride: group rides are published from inside the group.
- AC3. Guests see nothing; an invite link routes through sign-in (`FR-EVRIDE-005`).
- AC4. Behind `rides_event_groups_enabled`; off ⇒ no entry point and every RPC answers `feature_disabled`.

## FR-EVRIDE-002 — Create a group
- AC1. Any active member whose account is ≥ 24 h old may create (an organization profile may not). Fields: title, event kind, `starts_at`, `ends_at` (optional; default `starts_at + 6 h`; required for trip/camp/conference/festival), event place (D71 picker, optional house number for a street, venue label ≤ 80), access note, join policy, ceiling (default per `S`), optional member cap.
- AC2. Validation (`validateRideEventGroupDraft`, mirrored in SQL): lengths; `ends_at > starts_at` and in the future; `starts_at` ≤ 365 d ahead; duration ≤ 14 d; the place from a catalog; screened text (`FR-EVRIDE-036`).
- AC3. An event that already started can still get a group until it ends; a funeral an hour away is valid.
- AC4. A venue off any street: the nearest official junction or the city plus the access note.
- AC5. The creator becomes `organizer`; tokens (128-bit, hashed) and a 10-character code (alphabet without `0 O 1 I L`, normalized for case and look-alike input) are issued; the creator lands on the invite screen.
- AC6. Limits per `S`; a group with a cap above 100 created by an account younger than 7 days waits for a light admin review before its link goes live (config, with an SLA of 2 h in the event window).
- AC7. A legal acknowledgement is shown at first creation, first join and first booking: KC and the organizer only connect people; each driver and passenger is responsible for their trip; rides are free (L3; text by KC, reviewed by counsel; development does not wait).
- AC8. Content moderation as for any post; the group is never indexed.

## FR-EVRIDE-003 — Edit the event
- AC1. Organizers and co-organizers edit title, description, note, venue label, times, join policy, ceiling and member cap while the group is `active`. The event place and the organizer cannot change (cancel and create instead).
- AC2. The cap cannot go below the member count (`member_cap_below_members`).
- AC3. A time change follows `FR-EVRIDE-015`. `ends_at` may be extended while the group is `ended` but within its 12 h grace (it returns to `active`).
- AC4. Each edit is audited.
- AC5. **Lowering the ceiling** narrows every wider ride to it, tells publishers once and keeps bookings. **Raising** it never widens an existing ride.

## FR-EVRIDE-004 — Invite: link, code, QR, share
- AC1. The invite screen shows the link `https://karma-community-kc.com/rides/join/<token>`, the code `KC-XXXXX-XXXXX`, a QR (saveable and printable), a WhatsApp share with a ready message, and copy.
- AC2. Token and code are random, hashed at rest, constant-time compared. A wrong code is a failed attempt: **5 failures in 10 minutes** lock code entry for that person for 30 minutes, and there is a per-day cap on all join attempts per person and per device; a step-up challenge follows 3 failures (`join_attempts_locked`).
- AC3. **Rotate**: new token and code, old ones dead at once, members stay; atomic against joins.
- AC4. Leak response toolkit: switch to `approval`, **freeze joins**, **bulk-remove** by join-time range, the **join log** (time and count only).
- AC5. `invite_sharing`: `members` (default) or `organizers`.
- AC6. The shared message and the OG preview carry no event details; the landing sends `noindex`, `no-store`, `Referrer-Policy: no-referrer`; the token is kept out of analytics and error reports.
- AC7. Tokens die when the group is `ended`, `cancelling`, `cancelled` or removed. **All failure answers (unknown, rotated, dead, banned) are one `group_not_found` with the same shape and comparable timing**, covered by a test.

## FR-EVRIDE-005 — Join
- AC1. Opening the link or entering a code shows a signed-in person a **minimal preview**: title and organizer display name. Date, city, counts and the organizer's verification level appear only after joining (or approval). A non-member never sees a member count.
- AC2. `open_with_link`: "הצטרפות" makes the person `active`. `approval`: "בקשת הצטרפות" creates `pending` with an optional note ≤ 140; one pending request per person; ≤ 2 requests per group.
- AC3. Race-safe and idempotent: the cap, ban, freeze and insert are one short transaction with the group row locked (`group_full`, `joins_frozen`); the member count updates inside it; notifications and audit run after commit.
- AC4. **Signed out or new**: the intent (the path with the token) is **persisted** so it survives a cold start, e-mail confirmation and a 10-minute wait; sign-up is minimal and the profile wizard is deferred; the web landing returns to the same link. A person who installed later joins by typing the code. `/rides/join/` is added to the restorable path prefixes and to the three link manifests.
- AC5. A banned person gets `group_not_found`. A removed person must be re-approved. A member of an ended group sees the read-only past group.
- AC6. A pending request is cancelled when the group ends or is cancelled.
- AC7. Known minors per the roles note. Joining a group of 50+ members will require a verified phone once phone verification is live (open item).

## FR-EVRIDE-006 — Organizer manages members
- AC1. The manage screen lists requests (display name, note, verification level) and active members (name, level, role, join time, ride count); no contact data; city aggregates only with a bucket ≥ 5.
- AC2. Approve/decline are race-safe against the cap, the ban and a second organizer; "approve all" and "approve those with a note" exist; switching `approval → open` approves nobody automatically.
- AC3. Promote/demote co-organizers (≤ 3): organizer only.
- AC4. Every action is audited.

## FR-EVRIDE-007 — Leave, remove, ban
- AC1. **Leave:** pending bookings and requests end silently; a confirmed passenger booking is cancelled through the standard flow; an offer **with confirmed passengers** needs an explicit confirmation and is cancelled as a driver cancellation (passengers are offered replacements); an offer without passengers closes. The organizer must transfer first.
- AC2. **Remove:** same cascade, no late-cancel penalty to the removed person, no push to them, neutral copy to the others ("הנסיעה בוטלה"); the removed person sees "הקבוצה אינה זמינה" and needs re-approval to return.
- AC3. **Ban:** removal plus no return for that group; a ban never reveals itself; KC admins can also ban from the rides world.
- AC4. Realtime access ends at once (a `kicked` event to the person's own channel; the topic policy refuses re-subscription).
- AC5. All cascades write `post_handoffs` directly with new cancel reasons (`group_left`, `group_removed`, `event_cancelled`) and never leave a booking the person cannot see: they keep their own booking and chat (matrix row 3).

## FR-EVRIDE-008 — The group board
- AC1. Tabs **הלוך / חזור**, offers and requests chips, counters "N drivers · M free seats · K looking" (members only), keyset paging by `(departs_at, post_id)`, grouping before / during / after the event.
- AC2. Cards are text-only and compact; the other end shows the city; a request's city appears only to members with an active offer on that leg; filter by origin area (15 km) shows offers only.
- AC3. Pinned announcements, the organizer strip, the "ride home" panel from `ends_at − 2 h` (`FR-EVRIDE-035`).
- AC4. All UX states of the specification above.
- AC5. Realtime: a topic per group authorized by membership; **one coalesced ping per 5 s** carrying a revision number; the client refetches with 0–3 s jitter; a 60 s polling fallback; unsubscribe on blur after 60 s. Presence and `postgres_changes` are not used.
- AC6. Ended/archived read-only with a banner; cancelled shows the message and no rides.

## FR-EVRIDE-009 — Publish a ride (quick post)
- AC1. One floating button, two choices, the sheet of UX 6: an explicit leg, the event end locked, origin city, time chips, seats (offer, default 3) or passengers (request), meeting points ≤ 3 (official catalogs, D71), a note ≤ 280, audience (default `group_only`, never inherited, never wider than the ceiling), name display (remembered, shown inline).
- AC2. Departure must fall in the leg's window or `ride_outside_event_window`; defaults: `to_event` arrives ≈ `starts_at − 30 min`; `from_event` departs ≈ `ends_at` with chips "בסוף האירוע / חצות / 01:00 / 02:00"; "בערך" on either leg.
- AC3. Limits per `S` (`ride_limit_reached`).
- AC4. Published only through `create_event_group_ride` (a definer RPC): membership, group state, ceiling, window and limits checked; the group, leg, audience, name display and event end are forced from the group; the existing triggers run (places canonical, schedule, cost cap, rate limit). `FollowersOnly` is allowed here although a normal profile cannot choose it elsewhere. An old app version that sends no audience gets `group_only`.
- AC5. Likes and comments are off on group rides in R1/R2 (server-side switch); series, cargo and food are not offered; the Waze handoff after publishing is off; the remembered last route, "publish again" and `afterRidePublished` ignore group rides.
- AC6. Edits go through a group-aware update that cannot change group, leg, audience (use the audience RPC), event end or name display.
- AC7. A request is closed `expired` with reason `event_ended` when the group ends; a request asks "still looking?" 2 h before its window and hides itself unconfirmed (`FR-EVRIDE-035`).
- AC8. Existing rules unchanged: driver declaration, cost caps, emergency window, offer expiry 30 min after its estimated end, `complete_ride_trip`.

## FR-EVRIDE-010 — Book a seat
- AC1. The existing booking flow with guards inside the RPCs: group state, ban, the matrix (a person books only what they may see), blocked pairs.
- AC2. A non-member booking carries the "not in the event group" tag for the driver, who must confirm (as always) and sees no group data.
- AC3. **Leg rule** (`S`): enforced under the advisory lock `(group, person, leg)` — a post row lock cannot order two drivers; `leg_already_covered` never names the other ride; confirming supersedes other pending bookings on that leg. `reinstate_ride_booking` obeys the same guard.
- AC4. No overbooking: the ride is locked before recounting; `seats_booked` is maintained in the same transaction.
- AC5. Overlapping departures on one leg warn but are allowed.
- AC6. New cancel reasons and neutral copy are added to the cancel-reason constraint and the booking notification mapping.

## FR-EVRIDE-011 — Audience and privacy
> Core safety requirement. Design: ADR-007.
- AC1. The audience matrix above is the contract; the audience is also stored as visibility (`OnlyMe` / `FollowersOnly` / `Public`) so every reader already honours it.
- AC2. **Two predicates, one rule.** The member clause is added to every post and listing visibility predicate, gated on rides carrying a group, placed before the owner-closing branches: `is_post_visible_to`, `post_listing_visible_to`, `is_listing_visible_to` (the engagement variants stay closed for group rides).
- AC3. **Structural exclusion.** Every general reader excludes `group_only` group rides by predicate (partial index) regardless of the caller's membership: main feed, ranked feed, search, `list_rides_feed`, map pins and clusters, `browse_listings`, similar, recommend, matching v2 and its delivery, saved-route alerts, subscription alerts, embeddings, the WhatsApp bot, profile tabs seen by others, the share page and its link preview, public statistics, the activity log. Members reach group rides only through the group readers and the ride detail. Alerts re-check the audience at delivery time.
- AC4. **Writers cannot widen.** The audience changes only through the group RPC (ceiling-checked, both directions, while open); the visibility RPC, the view update guard and the "share to feed" action refuse group rides.
- AC5. The reader inventory is a **test**: every SQL function that reads posts or listings is listed with assertions per audience (non-member, banned, removed, `anon`, follower, operator); a function missing from the list fails CI.
- AC6. A completed group ride follows matrix rows 1–3 and 7: the closed-delivered branch of the visibility predicates never widens it.
- AC7. Changing the audience later (both ways, within the ceiling) keeps booked people's access to their booking.
- AC8. Anonymity means "name and avatar hidden until a booking is confirmed; city and time remain visible", and the sheet says so. The organizer moderates by ride; the server resolves an anonymous author for a ban; admins see identity.
- AC9. The exact event place, the access note and the exact start are visible only per the matrix; the ride-end house number follows the private-number rule.
- AC10. Blocks hold (matrix row 2), also for the organizer: a blocked organizer–member pair keeps working through admin tools.
- AC11. Group-level pushes and notification text carry no ride details; the lock screen shows "יש עדכון בקבוצה".
- AC12. Operators read group data only through audited admin tools, with role scoping and bulk-read alerts.
- AC13. No analytics or admin view lists members' home cities or streets.

## FR-EVRIDE-012 — Announcements
- AC1. One-way updates ≤ 500 chars, screened (`FR-EVRIDE-036`), ≤ 5/day and ≤ 70 per group; each triggers one generic push to active members (budget exempt on the event day).
- AC2. Members read, cannot reply; organizers can delete (the push is not recalled). Templates: "החניה מלאה", "האירוע התחיל", "מבקשים מנהגים לפרסם".

## FR-EVRIDE-013 — Notifications
- AC1. New kinds registered end to end: the domain union, the push-route allowlist (UUID params only, `/rides/events/[groupId]`), the Hebrew server i18n, the inbox world mapping (`event_group_*` is a rides kind), a settings group toggle: `event_group_join_request`, `event_group_join_decision`, `event_group_announcement`, `event_group_moved`, `event_group_cancelled`, `event_group_ride_home`, `event_group_request_offer`.
- AC2. **Dedupe keys are per recipient** (`group:<id>:<kind>:<ref>:<user>`); the outbox key is globally unique.
- AC3. **Budget and quiet hours are enforced at enqueue** (the dispatcher has neither): ≤ 6 non-booking pushes per member per group per day; quiet hours hold everything except cancel, move, safety and anything inside the event window (`starts_at − 2 h … ends_at + 3 h`).
- AC4. Group fan-out is **set-based and queued**: chunks of 200 members; a batch dispatcher sends 100 messages per call; the retry job claims rows; the per-booking trigger is suppressed for system cancellations so a cascade yields **one** push per person.
- AC5. A removed or banned person receives no group push after removal; organizers get join requests as a digest above 50 members.

## FR-EVRIDE-014 — Event cancelled
- AC1. The organizer cancels with confirmation and an optional message: the group becomes `cancelling` in ≤ 100 ms (tokens dead, board closed).
- AC2. A worker cascades in chunks of 25 rides (`skip locked`, idempotent, resumable): each ride closes with reason `event_cancelled` and its bookings cancel with system attribution, **no penalty, no karma loss, no rating prompt**; each ride is atomic. The group becomes `cancelled` when done; target ≤ 60 s for 500 bookings.
- AC3. One consolidated push per person, per-recipient dedupe.
- AC4. Un-cancel within 24 h only if the event is still in the future; rides stay cancelled. Admins can restore a wrongly removed group.
- AC5. Per D142 there is no post `cancelled` state: the reason lives in the transition log.

## FR-EVRIDE-015 — Event moved
- AC1. A change > 30 min is a **move**: one generic push to members, a banner for 3 days.
- AC2. Rides keep their times; those outside the new window are flagged `outside_event_window`; **their driver and booked passengers get a specific push**, the driver has 12 h to update or cancel without penalty, and an unanswered flagged ride is proposed for cancellation without penalty (never deleted silently).
- AC3. A move to the past or an `ends_at` before now is refused.
- AC4. Reminders and the night-return nudge recompute from the new window.

## FR-EVRIDE-016 — Lifecycle
- AC1. The graphs above; transitions only through RPCs and sweeps calling `fsm_assert_transition`, each logged with its reason.
- AC2. Sweep every 10 minutes, **chunked** (≤ 50 groups, `skip locked`), idempotent, catching up on the next run; the purge runs nightly.
- AC3. Every RPC derives the effective state from `now()`; the sweep persists it.
- AC4. At `ends_at + 12 h` open requests expire in chunks; pending joins cancel.
- AC5. Time is `timestamptz`, shown in Israel time including the DST nights.

## FR-EVRIDE-017 — Succession
- AC1. Transfer to a co-organizer who accepts; the organizer cannot leave without it; a suspended or banned co-organizer is not a valid target.
- AC2. Organizer deletion: during the grace the group stays; at deletion the oldest co-organizer inherits, else the oldest active member is invited for 48 h, else the group ends and its rides finish.
- AC3. A suspended organizer's group keeps running; with no co-organizer an admin may act (audited).
- AC4. Concurrent organizer edits: last write wins per field; the audit keeps both.

## FR-EVRIDE-018 — Safety
- AC1. The emergency call works on group rides and also tells the group's organizers that "an emergency was raised", without location or names.
- AC2. Minors per the roles note; drivers are adults.
- AC3. The return leg shows "אל תנהגו אחרי שתייה"; KC never claims to verify sobriety.
- AC4. Verification is shown on every driver and passenger; the organizer sees the count of unverified drivers.
- AC5. "Report a problem with this ride" uses the report flow with the group as context.
- AC6. Booking pre-contact: at most one open inquiry per ride per person and 10 inquiries/day per group.

## FR-EVRIDE-019 — Reports and moderation
- AC1. Group, announcement and ride are reportable; new reasons: fake or commercial event, harassment in the group, personal-data harvesting.
- AC2. A hide threshold counts distinct accounts older than 7 days; a hidden group freezes its **organizer** functions (join, announce, member data) while members keep their rides and the way home; a human review within 2 h during the event window.
- AC3. Admin portal: list, open read-only, hide/restore/remove, ban from creating groups; removal cascades like a cancellation with reason `removed_admin`.
- AC4. Admins never see a member's exact street; member lists need a stated reason (audited).
- AC5. Three removed groups block the organizer from creating for 30 days.

## FR-EVRIDE-020 — Abuse and limits
- AC1. Every limit of the `S` fills is enforced in SQL and mirrored in the domain validator, with typed errors.
- AC2. Rate limits: ≤ 5 creations/day, ≤ 30 join attempts/day, 5 failed codes/10 minutes, announcements, inquiries.
- AC3. A new account (< 24 h) may join but not create.
- AC4. Karma is unchanged; the existing handoff karma rules cut sock-puppet farming.

## FR-EVRIDE-021 — Completion, karma, ratings
- AC1. Group rides complete and earn existing karma and the optional driver rating as in 05.3 step 7; no organizer karma in R1/R2.
- AC2. A ride ended by the event or a removal earns nothing and costs nothing. D24 holds.

## FR-EVRIDE-022 — Analytics and the growth loop
- AC1. Events (no personal data in properties): `ride_group_created`, `_invite_shared`, `_link_opened`, `_signup_started`, `_member_joined` (source, is_new_user, step), `_join_requested`, `_ride_published` (leg, audience), `_booking_confirmed`, `_trip_completed`, `_cancelled`, `_freeze_triggered`.
- AC2. Admin card: groups, members per group, funnel link → sign-up → join with drop-off per step, new accounts via invites and their 30-day retention, rides and seats per group, coverage at the start, cancellations.
- AC3. Groups under 5 members are excluded from breakdowns.

## FR-EVRIDE-023 — Non-functional
- AC1. The budgets table is the contract; each has a test or a monitor (k6 for realtime and dispatch with 500 virtual members before any pilot).
- AC2. i18n and a11y per the UX principles; no literals in code or SQL; server i18n is Hebrew-only, the app has he + en.
- AC3. Platforms: iOS, Android and the Expo web export, which supports join, board, publish and booking (parity); the invite landing is static.
- AC4. Files ≤ 300 lines, one use case per file, ports/adapters per AGENTS §5, ADR-002 RPC checklist per RPC.
- AC5. Server clock only; clients never decide a window.
- AC6. Observability: alerts on dispatch backlog > 200 rows older than 2 min, cascade lag, join-spike freezes, reader-inventory test failures; an ops-health row per sweep.
- AC7. Kill switches: the flag, and per-feature switches for joins and for audience above `group_only`.

## FR-EVRIDE-034 — Answering a request
- AC1. A driver taps **"אפשר לקחת"** on a request, picks one of their offers on that leg (or creates one in the sheet); the requester gets a generic-safe push with the driver's name and badge and accepts or declines; acceptance confirms the booking.
- AC2. No member opens a chat with a requester unasked; one tap blocks a member and hides requests from them.
- AC3. A requester may restrict their request's visibility to drivers they approve (women-only preferences stay an open item).

## FR-EVRIDE-035 — The night return
- AC1. **Leaving now:** a driver of a `from_event` leg taps "יוצאים עכשיו" (seats left); a live card shows on the board for 30 minutes and pings members with an open request on that leg within 15 km; a requester has "מחפשים עכשיו". These are exempt from the per-leg request limit.
- AC2. **No ride home yet:** at `ends_at − 1 h` a member with a confirmed `to_event` seat and no `from_event` seat gets one push with the count of available rides (inside the quiet-hours exemption).
- AC3. **Update departure:** a driver sends "יוצאים בעוד N דקות" to confirmed passengers (≤ 3 per ride).
- AC4. A request asks "still looking?" 2 h before its window.
- AC5. When a driver cancels, affected passengers see up to 3 replacements in the app.

## FR-EVRIDE-036 — Content safety
- AC1. Group titles, notes, constraints, join notes and announcements refuse phone numbers, links and payment words with a clear message (`content_not_allowed`); text is normalized (digits, spacing, look-alike letters) before matching.
- AC2. The note field warns that it can identify a person; free-text accessibility and child-seat needs are offered as chips first.

## FR-EVRIDE-037 — Retention and erasure
- AC1. The retention table is implemented by the nightly purge, and each period is a config constant with a test.
- AC2. Account deletion removes memberships at once and cancels group rides through the existing flow; a deleting driver with confirmed passengers is a driver cancellation without penalty.
- AC3. A person can ask for an export or erasure of their group data through the existing privacy path.

---

## Phase 2

- **FR-EVRIDE-024 Round trip:** two linked posts; cancel asks about the other leg; "book both" is all-or-nothing (`leg_unavailable`).
- **FR-EVRIDE-025 Matches:** group-scoped matching (never the global engine), a push when an offer fits my request, replacements on a cancellation.
- **FR-EVRIDE-026 Reminders:** 24 h and 2 h before departure; jittered, set-based, per-recipient dedupe.
- **FR-EVRIDE-027 Sober-driver chip:** self-declared, framed like the licence declaration.
- **FR-EVRIDE-028 Coverage:** per leg offered / requested / confirmed / uncovered, members without a ride (a count); an announcement to "members without a ride home".
- **FR-EVRIDE-029 Public groups:** listed, searched, reviewed for new organizers, duplicate hint, rides still members-only unless the ceiling says otherwise; political or hateful events are not listed.
- **FR-EVRIDE-030 Ride waitlist.**
- **FR-EVRIDE-038 Trust details:** driver photo, optional car make/color/plate tail for confirmed passengers, "invited by", organizer "I know this driver", booking for someone else (a name-only passenger), contact consent.
- **FR-EVRIDE-039 Printable summary:** a shareable text/PDF board for non-app guests.

## Phase 3 (outline)

- **FR-EVRIDE-031** Link to an organization's event (`G18`), by invitation only.
- **FR-EVRIDE-032** Group chat on a new multi-party model with its own spec and ADR.
- **FR-EVRIDE-033** Trust options: verified-only drivers (after `FR-VERIFY`), pre-approved drivers, structured gender-separated preference, wrap-up estimate, multi-day shuttles.

---

## Edge-case catalog

| # | Case | Handling | FR |
|---|---|---|---|
| 1 | Link forwarded to strangers | Spike freeze, approval, bulk-remove, rotate, join log | 004, 005 |
| 2 | Code guessing, many accounts | 10 chars, 5/10 min lock, device and daily caps, step-up | 004 AC2 |
| 3 | Two joins for the last place | Locked transaction, `group_full` | 005 AC3 |
| 4 | Join racing rotation/ban/freeze | Atomic; the restriction wins | 004, 005 |
| 5 | Banned/expired/rotated link | One identical `group_not_found` | 004 AC7 |
| 6 | Signed-out or new user | Persisted intent, minimal sign-up, deferred wizard | 005 AC4 |
| 7 | Universal links not live yet | Web landing; manifests (PM A2/A3) | 005 |
| 8 | WhatsApp preview leaks | Generic preview, noindex, no names | 004 AC6 |
| 9 | Event started / funeral in an hour | Allowed until it ends | 002 AC3 |
| 10 | Multi-day event | Windows and ≤ 14 d | windows |
| 11 | Venue off any street | Junction or city + note | 002 AC4 |
| 12 | Free-text venue as a route | Label never routes | 002 |
| 13 | Two groups for one wedding | Separate; share one link; P2 duplicate hint | 029 |
| 14 | Event moved | Generic push, flagged rides, driver 12 h, no silent delete | 015 |
| 15 | Event cancelled with bookings | Async cascade, no penalty, one push | 014 |
| 16 | Cancelled by mistake | Un-cancel within 24 h | 014 AC4 |
| 17 | Event overruns | Extend `ends_at` within the grace | 003 AC3 |
| 18 | A return at 01:00 | Before/during/after grouping | 008 |
| 19 | DST night | `timestamptz`, correct display | 016 AC5 |
| 20 | Driver leaves with passengers | Confirm, driver cancellation, replacements | 007 AC1 |
| 21 | Passenger removed | Neutral cancel, no penalty to them | 007 AC2 |
| 22 | Removed member returns via an open link | Re-approval required | 005 AC5 |
| 23 | Organizer deletes account / suspended | Succession | 017 |
| 24 | Two confirmed rides on one leg | `leg_already_covered`, supersede | 010 AC3 |
| 25 | Two drivers confirm one passenger | Advisory lock | 010 AC3 |
| 26 | Full ride | Waitlist P2 | 030 |
| 27 | One-way offers | Independent legs | 008 |
| 28 | Late/changed departure | Update-departure push | 035 AC3 |
| 29 | Unsafe driver / no-show | Report, emergency call | 018 |
| 30 | Alcohol | Reminder, chip P2 | 018, 027 |
| 31 | Kids, wheelchairs, instruments | Chips first, then a screened note | 036 |
| 32 | Gender-separated events | Open item; request visibility to approved drivers | 034 AC3 |
| 33 | Minors | Passengers only, group-only, never named outside | roles |
| 34 | Mutual block inside a group | Matrix row 2 | 011 |
| 35 | A `group_only` ride in any general reader | Structural exclusion + inventory test | 011 |
| 36 | Public feed broadcast carries a group ride | Only `everyone` rides, never `group_only` | 011 AC3 |
| 37 | Remembered route pre-fills the venue | Group rides ignored | 009 AC5 |
| 38 | Waze handoff exposes the venue | Off | 009 AC5 |
| 39 | Stale push/link to a group ride | Same as a deleted post | 011 |
| 40 | Fake/commercial group | Weighted hide, organizer frozen, members keep rides | 019 |
| 41 | Notification storm at 400 members | Set-based, budget at enqueue, batch dispatch | 013 |
| 42 | Spam announcements | Caps, filter, report | 012, 036 |
| 43 | Cap below members | Refused | 003 AC2 |
| 44 | Pending requests at the end | Cancelled | 005 AC6 |
| 45 | Small-group fingerprinting | No counts for non-members; buckets ≥ 5 | 005, 006 |
| 46 | Sweep missed or doubled | Effective state in RPCs, idempotent chunks | 016 |
| 47 | Data kept too long | Retention table, nightly purge | 037 |
| 48 | Account deleted mid-event | Memberships removed, rides cancelled | 037 AC2 |
| 49 | Flag off | No entry; RPCs refuse | 001 AC4 |
| 50 | Publisher picks `everyone` for a private wedding | Above ceiling, refused | 011 |
| 51 | Ceiling lowered | Narrowed, told once, bookings kept | 003 AC5 |
| 52 | Audience changed after bookings | Allowed; booked people keep access | 011 AC7 |
| 53 | Anonymous author misbehaves | Moderate by ride; server resolves author | 011 AC8 |
| 54 | Outsider books a wider-audience ride | Driver sees the tag and confirms; no group data | 010 AC2 |
| 55 | Non-member sees an `everyone` ride | City-level event end only | S nonmember-view |
| 56 | Request origin stalking | City only to members with an offer; approved-driver restriction | 034 |
| 57 | Chat spam | One inquiry per ride, 10 per day per group | 018 AC6 |
| 58 | Dead socket after removal | `kicked` event, policy refuses re-subscribe | 007 AC4 |
| 59 | Narrowing leaves a pending alert | Alerts re-check audience at delivery | 011 AC3 |
| 60 | Visibility writers bypass the ceiling | Group rides refuse the generic writers | 011 AC4 |
| 61 | Completed ride widens | Closed branch cannot widen | 011 AC6 |
| 62 | Embedding provider receives a ride | Group rides never embedded | 037, 011 |
| 63 | Duplicate taps on a weak network | Idempotent `request_id` | concurrency |
| 64 | Old app version publishes without audience | Server default `group_only` | 009 AC4 |
| 65 | Impersonating the organizer by name | Organizer badge on the board header and manage lists | UX |
| 66 | Two events at one venue the same night | Separate groups; rides are per group | — |
| 67 | A member of 20 groups | Cap 20; hub card shows the nearest | 001, limits |
| 68 | Dead cellular at a field venue | Cached board, queued idempotent post | 023, UX |

## Notifications (catalog)

| Key | Trigger | Recipients | Critical |
|---|---|---|---|
| `event_group_join_request` | `pending` created | Organizers (digest above 50) | — |
| `event_group_join_decision` | Approve / decline | Requester | ✅ on approve |
| `event_group_announcement` | Posted | Active members | — |
| `event_group_moved` | Change > 30 min | Members; drivers/passengers of flagged rides specifically | ✅ |
| `event_group_cancelled` | Cancelled or removed | One per person | ✅ |
| `event_group_ride_home` | `ends_at − 1 h`, leaving now | Members with an open need | ✅ in the window |
| `event_group_request_offer` | Driver answers a request | Requester | ✅ |

## Test plan (every layer, tests first)

- **Domain:** draft validation (all bounds), windows, code format and normalization, both status graphs, content filter, audience/ceiling order.
- **Application:** one use case per RPC, happy and error.
- **Infrastructure:** `map*Row` and `{code}` → domain error.
- **SQL (inside `begin; … rollback;`):** RLS and grants (`anon` calls nothing), limits and boundaries, **paired-transaction race tests** (concurrency list), cascades, sweeps (idempotent, catching up, chunked), DST window, purge, `kicked`, notification budget and per-recipient dedupe, suppression of per-booking pushes on system cancels, and the **reader-inventory leak matrix** (non-member, banned, removed, `anon`, follower, operator × audience × reader).
- **Mobile:** create, invite, join (signed-out resume), board states, quick post (taps and time), manage, deep-link handling.
- **E2E:** a four-user journey (organizer, driver by link, passenger by code, outsider) including cancel; a Maestro flow; a k6 load test (500 members: realtime, dispatch, board) before the pilot.
- **Non-functional:** budgets as automated checks; an a11y pass; a copy review in Hebrew.

## Success metrics (hypotheses, tuned after the pilot)

| Metric | Target |
|---|---|
| Link opened → joined | ≥ 50% (funnel per step is reported) |
| Landing LCP | ≤ 1.2 s (p75, 4G) |
| Median time to post | ≤ 10 s |
| Time from creation to the first offer | < 24 h |
| Members with a confirmed ride to the event at its start | ≥ 30% |
| Members who asked for a ride home and got one | ≥ 70% |
| New accounts from invites retained at 30 days | ≥ 25% |
| Critical safety incidents per 1000 group rides | 0 |
| Reader-leak findings (tests, pilot, reports) | 0 |

## Open items for the PM (non-blocking; defaults apply until answered)

1. Private only at launch, or public groups too? Default: private in R1/R2, public in P2.
2. Group chat? Default: no (announcements and pair chat).
3. "Friends only" without the group: the audiences are additive (the group always sees its rides). Confirm.
4. Phone verification required to join groups of 50+ once the SMS provider is live (A7)? Default: yes then.
5. Gender-separated rides (religious weddings): request visibility to approved drivers is in R2; a structured preference needs a decision on `FR-RIDE-029`.
6. Event content policy for rallies and demonstrations. Default: allowed, not listed publicly.
7. Retention periods and the legal texts (counsel; L1, L3).
8. Link manifests: the Apple Team ID and the Android SHA-256 (A2/A3).
9. Anonymity semantics: "name hidden until a booking is confirmed" instead of the operators-only meaning of the lowest D16 level. Confirm.
10. UI name: "קבוצת טרמפים לאירוע" (tile "קבוצות לאירועים").
