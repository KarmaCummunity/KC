# 2.24 Event ride groups (קבוצות טרמפים לאירוע)

> **Status:** ⏳ Spec v1 draft (2026-11-11), **pending PM approval**. Nothing is implemented. Product decision: `{{D:event-ride-groups}}`. Assumptions awaiting approval are the `S` fills in the table below. Implementation gap: `{{G:event-ride-groups}}`.

Prefix: `FR-EVRIDE-*`

> **Source of truth.** Product book [`05_giving_worlds.md` §5.3](../05_giving_worlds.md) wins where it disagrees (D35). Built on the one rides flow (D70–D75, D103): a group ride **is** an ordinary ride post, so places, seats, bookings, the cost caps, the emergency call, karma and the completion flow are reused, never copied. Also relevant: D16 (visibility and anonymity), D23 (verification shown, not blocking), D31 (events), D33 (reports), D95 (rides urgency), `G61` (one status graph per lifecycle), [ADR-006](../../architecture/adr/ADR-006-one-post-model.md) (one post model), [ADR-007](../../architecture/adr/ADR-007-event-group-audience.md) (audience of an event group).

> **Why.** Today a rides group lives in WhatsApp: "who drives from Haifa to the wedding? who takes me back at 1am?". A ride published to the general rides feed reaches strangers, exposes the event, and drowns among unrelated rides. An **event ride group** is a small private room around one event (wedding, party, bar mitzvah, concert, conference, trip, funeral): only its members see its rides, every ride is either **to** or **from** the event, and the organizer can see at a glance whether everyone has a way there and back. Each group is also an acquisition channel: one wedding brings 100–500 guests through a shared link (D38, D47).

> **Scope.** Create a group for one event; invite by link, code or QR; join with or without approval; publish ride offers and requests that live only inside the group; book seats; organizer announcements; the full lifecycle (moved, cancelled, ended, archived, purged); moderation; analytics. Phase 2 and 3 are specified in outline so P1 does not close doors.

> **Non-goals.** Group chat (a different chat model, P3 — `FR-EVRIDE-032`); selling tickets or any fee (always free, `S55`); a payment or cost split (rides are free at launch, 05.3 Rules); real-time location sharing (`FR-RIDE-036`); chartered buses or shuttles; running the event itself (guest list, RSVP, seating — an organization's event is `FR-ORG`/`G18`, a different thing); importing a WhatsApp group (`G27`); recurring event rides (`FR-RIDE-046` covers recurring commutes, an event happens once).

## Terms

| Term | Meaning |
|---|---|
| Event ride group (**group**) | The room around one event; has an organizer, members, an event place and window |
| Event place | An **official place** (D71): a city, optionally an official street and a private-to-members house number, or a junction. The venue name is a label only and never routes |
| Leg | The direction of a group ride: `to_event` (ends at the event place) or `from_event` (starts there) |
| Group ride | A ride offer or request post that carries a group and a leg; visible only to active members |
| Organizer / co-organizer | The creator (exactly one) / up to 3 members the organizer promotes; co-organizers do everything but delete or transfer the group |
| Member | A person with an `active` membership |
| Invite link / code / QR | The three ways to the same secret token; rotatable |
| Coverage | The share of a leg's expected travellers that hold a confirmed seat (`FR-EVRIDE-028`) |

## Product decisions recorded for this spec (pending PM approval; defaults apply until answered)

| ID | Decision (working assumption) |
|---|---|
| `{{S:event-group-access-model}}` | A group is **invite-only and unlisted** by default: it cannot be found, searched or seen without the invite token. Public groups (listed, searchable) arrive in P2. Join is by link, code or QR; the organizer picks **open with the link** or **approval for each join** |
| `{{S:event-group-ride-audience}}` | A group ride is visible **only to active members**, and **never** reaches the general rides feed, main feed, search, map, matching, saved-route alerts, the WhatsApp bot, public statistics or push to non-members. Fail-closed by design (ADR-007) |
| `{{S:event-group-no-group-chat}}` | No group chat in P1/P2: coordination uses the existing pair chat per ride plus one-way **organizer announcements**. Group chat is P3 (needs a new chat model; the chat today is strictly one pair) |
| `{{S:event-group-limits}}` | Limits (one config object `EVENT_RIDE_GROUP_LIMITS`, tunable like `KARMA_POINT_VALUES`): title 3–80 chars; description ≤ 500; access note ≤ 280; event ends in the future, starts ≤ 365 days ahead, lasts ≤ 14 days (default 6 h when no end is given); ≤ 3 active groups per organizer; ≤ 3 co-organizers; members 2–1000 (default 500); a person is in ≤ 20 active groups; ≤ 5 announcements per group per day (≤ 500 chars); per member and leg ≤ 3 active offers and ≤ 1 active request |
| `{{S:event-group-lifecycle}}` | Publishing is open from creation until `ends_at + 12 h`; the group is read-only from then (**ended**), archived at `ends_at + 7 d`, and its personal data purged at `ends_at + 90 d` (only aggregate counters stay) |
| `{{S:event-group-ride-windows}}` | A `to_event` ride departs between `starts_at − 24 h` and `ends_at − 1 h`; a `from_event` ride departs between `starts_at` and `ends_at + 24 h`. A request follows the same windows |
| `{{S:event-group-origin-privacy}}` | Members see a group ride's other end at **city** level; the street, junction and private house number are shown only to the driver and to passengers with a confirmed booking (a guest list is a "who is away from home tonight" list) |
| `{{S:event-group-leg-rule}}` | A person holds at most **one confirmed booking per leg** of a group. The driver's confirmation of a second one is refused; a confirmation withdraws the passenger's other pending bookings on that leg (the housing pattern, `S54`) |
| `{{S:event-group-notification-budget}}` | No push per new group ride. Pushes: join request/decision, organizer announcement, event moved/cancelled, a match for my request, booking changes (D73), and ride reminders. At most 6 non-booking pushes per member per group per day; booking and safety pushes are never capped |
| `{{S:event-group-sober-driver}}` | A driver of a return leg may tick a self-declared **"sober driver"** chip (P2). It is a declaration, not a check, with the same legal framing as the licence declaration (`FR-RIDE-041`) |

## Roles & permissions

| Action | Guest (signed out) | Non-member | Pending | Member | Co-organizer | Organizer | KC admin |
|---|---|---|---|---|---|---|---|
| Open an invite link and see the preview | sign-in first | ✅ preview only | ✅ | ✅ | ✅ | ✅ | ✅ |
| Join (open policy) / request to join (approval) | ❌ | ✅ | — | — | — | — | ✅ |
| See the group, board, announcements | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Publish a ride offer / request in the group | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | — |
| Book a seat | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | — |
| See / share the invite link | ❌ | ❌ | ❌ | per setting (`FR-EVRIDE-004` AC5) | ✅ | ✅ | ✅ |
| Approve or decline join requests, remove or ban a member | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Post an announcement, edit the event | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Promote / demote a co-organizer, transfer, cancel the group | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Remove the group (moderation) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

Every action also requires an `active` account (suspended and pending-deletion accounts are refused, S2). An organization profile cannot own a group in P1: a person organizes.

## Data model (summary; names are indicative, final in the migrations)

- `ride_event_groups` — organizer, title, event kind, `starts_at`, `ends_at`, event place (kind, id, label, coordinates, optional street house number), venue label, `access_note`, `join_policy` (`open_with_link` | `approval`), `visibility` (`invite_only` | `public`, P2), `invite_sharing` (`members` | `organizers`), `member_cap`, `status`, token hash, short code, `purge_at`.
- `ride_event_group_members` — group, user, `role` (`organizer` | `co_organizer` | `member`), `status` (`pending` | `active` | `left` | `removed` | `banned`), `joined_at`, `decided_by`. One row per (group, user); history is the status.
- `ride_event_group_updates` — organizer announcements (author, body, created_at).
- Ride extension: `ride_post_details` gains `event_group_id`, `event_leg` (`to_event` | `from_event`) and, in P2, `paired_post_id` (the other leg of a round trip). A CHECK keeps the three together.
- Status graph `rideEventGroup` in `@kc/domain` `fsm/machines/` mirrored in `fsm_state` / `fsm_edge` (G61); membership status has its own graph.
- Config flag `app_flags.rides_event_groups_enabled` (off in prod until the pilot passes; the pattern of `0441`).

## Routes

`/(tabs)/donations/rides/events` (my groups + join with a code) · `…/events/new` · `…/events/[groupId]` (board) · `…/events/[groupId]/manage` (members, requests, announcements, invite) · web invite landing `https://karma-community-kc.com/rides/join/<token>` (needs the `/rides/join` path prefix in the universal-link and Android intent-filter manifests, plan item A2/A3 of [96](../96_launch_and_first_group_plan.md)) · push deep links open the board or the ride.

---

## Phase 1 — A private group that works end to end

## FR-EVRIDE-001 — Entry points
- AC1. The rides hub header gets **"קבוצות לאירועים"** (event groups): my groups (active first, then past), **"הצטרפות עם קוד"** and **"קבוצה חדשה"**. When I belong to ≥ 1 active group, the hub shows a compact card for the nearest upcoming one above the feed (event title, date, "N rides").
- AC2. The create-post "+" never offers a group ride directly: group rides are published from inside the group (`FR-EVRIDE-009`), so a ride can never be published into a group by accident from the general form.
- AC3. Guests see nothing of this feature (it needs an account); a guest opening an invite link is routed through sign-in/sign-up and then to the join step (`FR-EVRIDE-005` AC4).
- AC4. Behind `rides_event_groups_enabled`; flag off ⇒ no entry point, and every RPC refuses with `feature_disabled`.

## FR-EVRIDE-002 — Create a group
- AC1. Any active member may create (an organization profile may not, P1). Fields: **title** (required), **event kind** (wedding, bar/bat mitzvah, brit, henna, party, birthday, concert/festival, conference, sports, memorial/funeral, trip/camp, other — drives the icon and suggested copy only), **starts_at** (required), **ends_at** (optional; default `starts_at + 6 h`, required explicitly when the kind is trip/camp/conference/festival), **event place** (official place picker of D71, plus an optional house number for a street, plus a venue label ≤ 80), **access note** ("how to find us / parking", members only), **join policy**, optional **member cap**.
- AC2. Validation (`validateRideEventGroupDraft`, mirrored in SQL): title and note lengths per `S` limits; `ends_at > starts_at`; `ends_at` in the future; `starts_at` ≤ 365 days ahead; duration ≤ 14 days; the place must come from a catalog (`ride_place_invalid`); a venue label never replaces a place. Typed errors, never raw `Error`.
- AC3. An event that **already started** can still get a group while it has not ended (guests need return rides during the party). A funeral or shiva with a start an hour away is valid: there is no minimum lead time.
- AC4. **Venue not on a street** (a field, a beach, a kibbutz hall, a forest): the organizer picks the nearest official junction or the city and describes the way in the access note; navigation uses the official place and house number, never the label.
- AC5. The organizer is added as member with role `organizer`; the group is `active`; an invite token (128-bit, only its hash stored) and a short code are generated; the creator lands on the invite screen (`FR-EVRIDE-004`).
- AC6. Limits: ≤ 3 active groups per organizer (`group_limit_reached`); creation is rate-limited (≤ 5 per day) to blunt spam.
- AC7. A **legal acknowledgement** is shown once on first creation and once on first join: KC and the organizer only connect people; every driver and passenger is responsible for their own trip; rides are free, no profit (L3 in [96](../96_launch_and_first_group_plan.md); text drafted by KC, reviewed by counsel before launch, development does not wait).
- AC8. The title and notes pass the same content moderation as any post (07.15); the group is never indexed by search engines (`noindex`), and its link preview is generic (`FR-EVRIDE-004` AC6).

## FR-EVRIDE-003 — Edit the event
- AC1. Organizer and co-organizers edit title, description, access note, venue label, times and the join policy at any time while the group is `active`. The event place and the organizer cannot be changed after creation (a new place is a different event — cancel and create; this keeps every ride's fixed end true).
- AC2. Editing the member cap below the current member count is refused (`member_cap_below_members`).
- AC3. Changing `starts_at` / `ends_at` follows `FR-EVRIDE-015` (rides outside the new window are flagged, members told once).
- AC4. Each edit is audited (who, what, when); the audit is visible to organizers and admins only.

## FR-EVRIDE-004 — Invite: link, code, QR, share
- AC1. The invite screen shows the link `https://karma-community-kc.com/rides/join/<token>`, a short code (8 characters from an alphabet without look-alikes `0 O 1 I L`, shown as `KC-XXXX-XXXX`), a **QR** image (saveable and printable, "put it on the invitation"), a **"share to WhatsApp"** button with a ready Hebrew message, and "copy".
- AC2. The token and code are random, unguessable, stored only as hashes, and resolve to exactly one group. A wrong code costs a failed attempt; **10 failed attempts in an hour** lock code entry for that person for an hour (`join_attempts_locked`).
- AC3. **Rotate** (organizer/co-organizer): a new token and code are issued and the old ones stop working at once; existing members stay. Used when a link leaks (for example forwarded to the wrong WhatsApp group). Rotation is atomic: a join racing a rotation either uses the old token fully or fails.
- AC4. Switching the join policy to **approval** is the second leak response: new joiners wait for a decision.
- AC5. `invite_sharing` — `members` (default: the invite is shown to every member, who may forward it) or `organizers` (only organizers see it).
- AC6. The shared message and the link preview carry **no event details** — a generic "הוזמנת לקבוצת טרמפים לאירוע" with the KC logo — and the landing page sends `noindex`. Event details appear only after a signed-in preview (`FR-EVRIDE-005`).
- AC7. Tokens and codes die when the group is `ended`, `cancelled` or removed (`link_expired`); an unknown, rotated or dead token answers with the same generic message (never reveals that a group exists or that the caller is banned).

## FR-EVRIDE-005 — Join
- AC1. Opening the link (app or web) or entering a code shows a **preview** to a signed-in person: title, event kind, date, event **city** (not the street), the organizer's display name and verification level, the member count, and the join policy. Nothing else (no rides, no members, no access note).
- AC2. `open_with_link`: "הצטרפות" makes the person an `active` member at once. `approval`: "בקשת הצטרפות" creates a `pending` membership (optional note ≤ 140) and the organizers are told (`FR-EVRIDE-013`). One pending request per person; a second tap is idempotent.
- AC3. **Idempotent and race-safe**: joining twice returns the same membership; the cap check, the ban check and the insert are one transaction with the group row locked, so two joins at the last place cannot both succeed (`group_full`).
- AC4. **Signed out / new user**: the app stores the token, runs the normal sign-in or sign-up and onboarding, and then resumes at the preview; on the web the landing asks to sign in and returns to the same link. If the app is not installed the link opens the web app; the short code lets a person who installed later join by typing it.
- AC5. A **banned** person gets the generic invalid-link answer; a person who **left** or was **removed** may join again through the link unless banned (removal is not a ban); a member of an ended group sees the read-only past group, not the join step.
- AC6. A pending request is cancelled when the group ends or is cancelled; a member count shown to non-members is rounded down to "10+" style buckets below 10 to avoid fingerprinting small groups ("2 members").
- AC7. A suspended or deleted account cannot join; a blocked-either-way pair is not prevented from sharing a group, but their rides stay mutually invisible (`FR-EVRIDE-011` AC6).
- AC8. Joining is free of ID or profile gates in P1 (D23); a group may require a verified driver level in P3 (`FR-EVRIDE-033`).

## FR-EVRIDE-006 — Organizer manages members
- AC1. The manage screen lists active members (display name, verification level, role, joined time, number of rides) and pending requests with approve / decline. No phone, e-mail, street or city is shown per person; organizers see **aggregate** city counts instead.
- AC2. Approve is race-safe against the cap and against a ban; decline is silent except for the neutral "הבקשה לא אושרה" in the requester's list. A bulk "approve all" exists for large weddings.
- AC3. Promote to co-organizer (≤ 3) and demote: organizer only.
- AC4. Every moderating action is audited.

## FR-EVRIDE-007 — Leave, remove, ban
- AC1. **Leave** (member): allowed any time. The consequences run through the existing rules, in one transaction: pending bookings and requests are cancelled silently; a confirmed booking as passenger is cancelled through the standard cancel flow (late-cancel rules unchanged); an offer **with confirmed passengers** needs an explicit confirmation ("הנסיעה תבוטל והנוסעים יקבלו הודעה") and is then cancelled as a driver cancellation; an offer with no passengers is closed. The organizer cannot leave without transferring (`FR-EVRIDE-017`).
- AC2. **Remove** (organizer/co-organizer): same cascade, but no late-cancel penalty for the removed person, the removed person's pushes are suppressed, drivers and passengers affected get the neutral booking-cancelled message ("הנוסע או הנהג אינו חבר בקבוצה") with replacement suggestions (`FR-EVRIDE-025`), and the removed person sees "הקבוצה אינה זמינה". Removal is not announced to the group.
- AC3. **Ban**: removal plus the person can never rejoin that group (survives link rotation). Unban is possible. A ban never reveals itself (`FR-EVRIDE-004` AC7). KC admins can ban from a group and, separately, from the rides world (existing 30-day ban).
- AC4. The cascade never leaves a booking pointing at a ride the viewer cannot see, and a chat between two former co-members stays (it is theirs), but its ride card shows "הנסיעה אינה זמינה".

## FR-EVRIDE-008 — The group board
- AC1. The board has two tabs, **"הלוך לאירוע"** (`to_event`) and **"חזור מהאירוע"** (`from_event`), plus a **"הבקשות שלי"** section. Each tab splits **offers** and **requests** and sorts by departure; it shows the counters "N drivers · M free seats · K people looking".
- AC2. It reuses the rides card and the route map; the event end of the route is fixed and labelled "האירוע"; the other end shows the **city** (`S` origin privacy). Filters: origin city/area (15 km via `find_ride_listing_matches`), seats needed. A return leg is grouped **before / during / after the event**, not "today/tomorrow", because a 01:00 return belongs to the night of the event.
- AC3. Announcements sit pinned on top (latest first, ≤ 3 shown, "all updates" opens the list). An organizer sees the coverage strip (`FR-EVRIDE-028`, P2: placeholder counts in P1).
- AC4. Empty states: no rides yet → "היו הראשונים — פרסמו נסיעה או בקשה" with both buttons; filtered-empty → "no rides from your area yet, publish a request and we will tell you when one appears".
- AC5. Live updates: realtime refresh of the board counters on ride changes inside the group (a topic per group, authorized by membership — ADR-003); never broadcast on the public feed topic.
- AC6. A group in `ended` / `archived` shows the board read-only with a banner; a `cancelled` group shows the cancellation message and no rides.

## FR-EVRIDE-009 — Publish a ride inside the group
- AC1. From the board: **"אני נוהג/ת"** (offer) and **"אני צריך/ה טרמפ"** (request), each for a chosen leg. The form is the quick-publish form of the rides flow with the event end **locked**: `to_event` ⇒ destination = event place; `from_event` ⇒ origin = event place. Seats 1–8 for an offer (default 3), `passengers` 1–8 for a request, up to 3 meeting points, a constraints note ≤ 280 (kids' seats, accessibility, luggage, pets, instruments).
- AC2. The other end and the meeting points come only from official catalogs (D71). The "from my current location" and "leave now" switches work; the Waze handoff of `FR-RIDE-003` AC8 is **off** for group rides (the destination would expose the event outside the group).
- AC3. Departure must fall in the leg's window (`S` ride windows) or the form refuses with `ride_outside_event_window`. Defaults: a `to_event` ride suggests arrival ≈ `starts_at − 30 min` (`suggestRideArrival`); a `from_event` ride suggests departure ≈ `ends_at`, with chips "בסוף האירוע / חצות / 01:00 / 02:00" and a free time. The departure of a return ride can be marked "בערך" (approximate).
- AC4. Limits per member and leg (`S` limits): ≤ 3 active offers, ≤ 1 active request (`ride_limit_reached`).
- AC5. The ride is created with `event_group_id`, `event_leg`, visibility `OnlyMe`, `feed_hidden = true`, `anonymity` fixed to named (a small trusted audience; the driver's name and verification level are shown), likes and comments **off** (every comment is a leak surface; the pair chat is the channel). Series (`FR-RIDE-046`) and cargo/food shipping are not offered.
- AC6. The group rides never feed the "publish again" memory or the device's **last route** (`rideStartDetails`) of the general form, so the event place cannot be pre-filled into a public ride by accident.
- AC7. The existing rules apply unchanged: the driver declaration (`FR-RIDE-041`), the cost caps (rides are free at launch), the emergency call window, expiry of an offer 30 min after its estimated end, `complete_ride_trip`.
- AC8. A **request** never expires on its own (D21) but is closed `expired` with the reason `event_ended` when the group reaches `ended`; an unanswered request gets a nudge (`FR-EVRIDE-025`, `FR-EVRIDE-026`).

## FR-EVRIDE-010 — Book a seat in the group
- AC1. The booking flow is the existing one (`book_ride_seat`, `confirm_ride_booking`, `decline_ride_booking`, `cancel_ride_booking`, expiry after 12 h or at departure, one `important` push per change, D73/D96); the new guards below run **inside** those RPCs.
- AC2. Only an active member of the ride's group may book (`not_group_member`); the driver is a member too (`FR-EVRIDE-011`).
- AC3. **Leg rule** (`S`): a second *confirmed* booking on the same leg for the same person is refused to the driver as `leg_already_covered` with the passenger's other ride named; a confirmation withdraws the passenger's other pending bookings on that leg, and tells the other drivers neutrally.
- AC4. Seats are never overbooked: confirmation locks the ride before recounting (`0533` pattern), also against a concurrent group cancellation, a removal and a rotation.
- AC5. A passenger can hold bookings on **different** legs of different drivers; overlapping departures on the same leg warn but are allowed (`overlapping_booking` warning).
- AC6. When the passenger or driver leaves, is removed, or the group is cancelled, bookings end through `FR-EVRIDE-007` / `FR-EVRIDE-014` with system attribution and no rating or karma penalty for the innocent side.

## FR-EVRIDE-011 — Audience and privacy: fail closed
> The core safety requirement of the feature. Design: [ADR-007](../../architecture/adr/ADR-007-event-group-audience.md). A wedding's date, place and guests are exactly what a stranger must not be able to read.

- AC1. A group ride is readable only through membership: `is_post_visible_to` gains one clause (viewer is the owner, or an `active` member of the ride's group, or a KC operator) and **every other branch** denies. Because the stored visibility is `OnlyMe`, a reader that forgets the new rule returns **nothing** instead of leaking.
- AC2. **Reader inventory.** These paths must exclude group rides for everyone except members (SECURITY DEFINER functions bypass RLS, so each one is checked on its own): the main feed view and ranked RPC, the new-post broadcast on the public feed topic, `list_rides_feed`, `find_ride_listing_matches`, `ride_listings_search`, the rides map RPC, `browse_listings`, post and user search, the semantic-search embeddings and the embed queue, `match_candidates` and its delivery, `posts_ride_route_alerts` / `ride_route_alerts_sweep`, the WhatsApp bot's search and match notices, public/community statistics and the activity log (aggregates only, never rows), a user's profile posts tab as seen by others, the share page `/post/<id>`, sitemaps, and notification payload text sent to non-members.
- AC3. The reader inventory is a **maintained list in a test**: a new SQL function that reads ride posts must either appear in the list with a member-only assertion or the test fails.
- AC4. A non-member who opens a group ride link (`/post/<id>`) or a stale push sees the same "not available" screen as a deleted post; nothing about the group is revealed.
- AC5. The **event place's house number** and the access note are members-only; the **ride's** street/junction/house number at the non-event end follow `S` origin privacy (city for members, exact for the driver and confirmed passengers; the private house number uses `get_ride_house_numbers`).
- AC6. Blocks hold: if either side blocked the other, the two never see each other's group rides or chat anchors (`is_blocked`), although both stay members.
- AC7. Chat anchored to a group ride shows the ride card only while the viewer can see the ride; a removed member's chat keeps messages but not the card.
- AC8. Realtime channels for a group authorize by membership at subscribe time and are torn down on removal.
- AC9. Purge removes membership rows, announcements, invite hashes and the ride→group link; closed rides stay only as the participants' own history (karma, ratings) and remain invisible to everyone else.
- AC10. No admin or analytics surface lists members' home cities or street data; admin tools show a group's counters and its organizer.

## FR-EVRIDE-012 — Organizer announcements
- AC1. Organizers post one-way updates (≤ 500 chars, plain text, no links to unknown domains is a P2 filter): "החניה מלאה, חנו ב…", "האירוע התחיל באיחור". Each triggers one push to active members (`FR-EVRIDE-013`), ≤ 5 per group per day, ≤ 30 per group.
- AC2. Members read them on the board; they cannot reply (a reply goes to the organizer by pair chat). Organizers can delete an announcement; deletion does not recall the push.
- AC3. Announcements pass content moderation and the report flow; spam from a group is a reason for `hidden_pending_review` (`FR-EVRIDE-019`).

## FR-EVRIDE-013 — Notifications
- AC1. New kinds (registered in the app and the server mirror `dispatch-notification/i18n.json`, he + en): `event_group_join_request` (organizers; grouped per hour, S10), `event_group_join_decision` (requester), `event_group_announcement`, `event_group_moved`, `event_group_cancelled`, `event_group_ride_match` (`FR-EVRIDE-025`), `event_group_ride_reminder` (`FR-EVRIDE-026`). Ride booking changes stay the existing `ride_*` kinds.
- AC2. **No push for a new ride** in the group. The board badge and the hub card are the discovery surface; a request creator gets a push when a match appears.
- AC3. Budget (`S`): ≤ 6 non-booking pushes per member per group per day; announcements and cancellation/move are exempt on the event day; quiet hours (D95) hold everything except cancellations, moves and safety within 6 hours of the event start.
- AC4. All copy lives in i18n; the push never contains the street, the house number or other members' names beyond what the recipient may already see.
- AC5. A removed or banned person receives no group push after removal; an organizer receives join requests as one daily-capped digest for groups above 50 members.

## FR-EVRIDE-014 — Event cancelled
- AC1. The organizer cancels with a confirmation and an optional message. The group becomes `cancelled`; tokens die; the board shows the cancellation.
- AC2. In **one transaction** every open group ride is closed with reason `event_cancelled`; every pending booking is cancelled; every confirmed booking is cancelled with system attribution (`decided_by` null), **no late-cancel or driver-cancel penalty, no karma loss, no rating prompt**.
- AC3. Each affected person gets **one** consolidated push, not one per booking (dedupe key `group:<id>:cancelled`), listing the effect in the app ("הנסיעות בקבוצה בוטלו").
- AC4. A cancelled group can be un-cancelled by the organizer within 24 h only if the event is still in the future (rides stay cancelled; people re-publish); afterwards it is terminal. KC admins can restore a wrongly removed group.
- AC5. Per D142 a post has no `cancelled` state: the rides end in the existing states and the reason `event_cancelled` is kept in the status-transition log.

## FR-EVRIDE-015 — Event moved
- AC1. A time change > 30 min is a **move**: every member gets one `event_group_moved` push ("האירוע עבר ל…"), the board shows a banner for 3 days.
- AC2. Rides keep their own departure times (a driver's plan is theirs). Those now outside the leg window get the flag `outside_event_window`, shown to the driver and their passengers, with "עדכנו שעה" and the driver's hint to re-confirm; a flagged ride expires per the normal rules if never updated, and is never silently deleted.
- AC3. A move into the past, or one that makes `ends_at` earlier than now, is refused (`event_window_invalid`).
- AC4. The reminders (`FR-EVRIDE-026`) re-compute from the new window.

## FR-EVRIDE-016 — Lifecycle
- AC1. Statuses: `active` → `ended` (at `ends_at + 12 h`: publishing and joining close; running rides continue to their own completion; pending join requests are cancelled; unanswered requests expire) → `archived` (at `ends_at + 7 d`: hidden from my lists, readable in "past groups" for members until purge) → purged (at `ends_at + 90 d`, `FR-EVRIDE-011` AC9). Side exits: `cancelled` (`FR-EVRIDE-014`), `hidden_pending_review` ↔ `active` and `removed_admin` (`FR-EVRIDE-019`).
- AC2. One graph in `@kc/domain` `fsm/machines/rideEventGroup`, mirrored in `fsm_state`/`fsm_edge`; transitions go only through RPCs/sweeps that call `fsm_assert_transition`; each transition is logged with its reason.
- AC3. A sweep (every 10 minutes, like `ride_series_sweep`) performs the time-based transitions idempotently; a missed run catches up on the next.
- AC4. A group whose event never takes place on its day (no activity, no admin action) still ends by time; ending is not "event happened".
- AC5. Time is stored as `timestamptz`; the UI renders in Israel time (`Asia/Jerusalem`) including the DST change nights, where a "01:30" return is displayed with the offset-correct instant rather than as a duplicate wall-clock hour.

## FR-EVRIDE-017 — Organizer succession
- AC1. The organizer **transfers** the group to a co-organizer (accepts first) before leaving; leaving without transferring is refused (`organizer_must_transfer`).
- AC2. Organizer **account deletion**: during the grace period (0549) the group stays; on actual deletion ownership passes to the oldest co-organizer, else the oldest active member is invited by a push to take over for 48 h, else the group is `ended` with a notice and its rides finish normally.
- AC3. A **suspended** organizer's group keeps running; co-organizers act; with none, a KC admin may act in their place (audited).
- AC4. Two organizers editing at once: last write wins per field, the audit keeps both.

## FR-EVRIDE-018 — Safety
- AC1. The emergency call (`ride_listing_emergency`, `FR-RIDE-035`) works on group rides unchanged and additionally tells the organizers of the group that "an emergency was raised on a group ride" **without** location or names.
- AC2. **Minors.** Drivers must be adults (licence declaration). A minor may be a passenger only per S16 (with a parent); the group's own rules add nothing weaker. An event kind aimed at children does not lift this.
- AC3. **Alcohol.** The return leg shows a reminder "אל תנהגו אחרי שתייה" and, from P2, the sober-driver chip (`FR-EVRIDE-027`). KC never claims to verify sobriety.
- AC4. **Verification** is shown on every driver and passenger (D23); the organizer sees the number of unverified drivers. Requiring a verified level 2 for drivers waits for identity verification (`FR-VERIFY`) and is `FR-EVRIDE-033`.
- AC5. **"Report a problem with this ride"** (late driver, unsafe driving, harassment, ride not as described) uses the report flow with the group as context; three distinct reports hide the ride for review (D33).
- AC6. The legal acknowledgement of `FR-EVRIDE-002` AC7 is repeated at the first booking.

## FR-EVRIDE-019 — Reports and moderation
- AC1. A group, an announcement and a group ride are reportable targets (`FR-MOD`); reasons add "fake or commercial event", "harassment in the group", "personal-data harvesting".
- AC2. Three distinct reports on a group hide it for review (`hidden_pending_review`); the organizer is told neutrally; members keep seeing their rides until an admin decides (a hide must not strand people on the way home).
- AC3. Admin portal: list groups (status, organizer, counters, reports), open one read-only, hide/restore/remove, ban an organizer from creating groups. Removing a group cascades like a cancellation but with the reason `removed_admin`.
- AC4. An admin never sees a member's exact street; a member list is shown only with a stated reason (audited).
- AC5. Repeated abuse (≥ 3 removed groups) blocks the organizer from creating groups for 30 days.

## FR-EVRIDE-020 — Abuse and limits
- AC1. All limits of the `S` limits fill are enforced in SQL (the only trustworthy place) and mirrored in the domain validator for instant form feedback, with typed errors (`group_limit_reached`, `group_full`, `ride_limit_reached`, `announcement_rate_limited`, `join_attempts_locked`).
- AC2. Per-person rate limits: ≤ 5 group creations/day, ≤ 30 join attempts/day, ≤ 10 failed codes/hour.
- AC3. A new account (< 24 h) may join but not create a group (P1 default; revisited with data).
- AC4. Karma farming through sock-puppet groups is cut by the existing handoff karma rules (distinct counterpart, daily caps) — no new karma source is introduced.

## FR-EVRIDE-021 — Completion, karma, ratings
- AC1. Group rides complete, earn the existing driver/passenger karma and allow the optional driver rating exactly as `FR-RIDE` §5.3 step 7. **No organizer karma** in P1 (`S`).
- AC2. A ride cancelled by the event (`FR-EVRIDE-014`) or a removal earns nothing and costs nothing.
- AC3. D24 holds: ratings are never shown to users.

## FR-EVRIDE-022 — Analytics and the growth loop
- AC1. Events (the existing analytics pipeline, no personal data in properties): `ride_group_created`, `ride_group_invite_shared` (channel), `ride_group_link_opened`, `ride_group_member_joined` (source: link/code/qr, is_new_user), `ride_group_join_requested`, `ride_group_ride_published` (leg, kind), `ride_group_booking_confirmed`, `ride_group_completed_trip`, `ride_group_cancelled`.
- AC2. Admin statistics add an **event rides** card: groups created, members per group, link-open → joined conversion, new accounts created through invites and their 30-day retention, rides and seats per group, coverage at the event start, cancellations.
- AC3. Counts are aggregates; groups under 5 members are excluded from any breakdown (small-group fingerprinting).

## FR-EVRIDE-023 — Non-functional
- AC1. **i18n/RTL/a11y**: Hebrew first with English parity, no literals in code or SQL (D-24), all controls labelled, touch targets and contrast per the design system, QR has a text alternative (the code).
- AC2. **Platforms**: iOS, Android and the Expo web export; the invite landing works without the app installed.
- AC3. **Performance**: the board loads ≤ 500 members' rides with keyset paging; the member list pages; counters are cheap aggregates, not row scans.
- AC4. **Files ≤ 300 lines**, one use case per file, ports in `@kc/application`, adapters in `@kc/infrastructure-supabase`, no Supabase in domain/application (AGENTS §5). Every RPC follows the ADR-002 checklist.
- AC5. **Time**: all comparisons use the server clock; clients never decide a window.

---

## Phase 2 — Make it smart and comfortable

## FR-EVRIDE-024 — Round trip: publish and book both
- AC1. A driver publishes **"הלוך וחזור"** in one form: two linked posts (`paired_post_id`), each with its own departure and seats; cancelling one leg asks whether to cancel the other, and never does it silently.
- AC2. A passenger books **both legs** of one driver in one tap: two bookings in one transaction, all-or-nothing (`leg_unavailable`).

## FR-EVRIDE-025 — Matches and uncovered guests
- AC1. A request creator is told once when an offer within 15 km and the window appears (`event_group_ride_match`); a driver is told once when a request fits their route. Matching is **scoped to the group** and computed by a group-aware function, never by the global matching engine.
- AC2. When a ride is removed, cancelled or its group changes, affected passengers get up to 3 replacement suggestions in the app.
- AC3. The nudges respect the notification budget.

## FR-EVRIDE-026 — Reminders and "need a ride home?"
- AC1. Confirmed driver and passengers get a reminder 24 h and 2 h before departure (booking facts only).
- AC2. At `ends_at − 1 h` a member with a confirmed `to_event` seat and **no** `from_event` seat gets "עדיין אין לך טרמפ חזרה — N נסיעות זמינות" (once). A member with a request and no match gets a prompt to widen their area.
- AC3. A driver can **"update departure"** (e.g. "leaving in 15 min") with a push to confirmed passengers (`important`), rate-limited to 3 per ride.

## FR-EVRIDE-027 — Sober-driver chip
- AC1. A return-leg offer may carry the self-declared chip "🚫🍷 נהג/ת מפוכח/ת"; the declaration text is explicit that it is a statement. Reports against a falsely marked driver are weighted higher.

## FR-EVRIDE-028 — Co-organizers and coverage
- AC1. The organizer promotes up to 3 co-organizers (`FR-EVRIDE-006` AC3).
- AC2. The coverage strip shows, per leg: offered seats, requested seats, **confirmed**, **uncovered requests**, and the members with no ride at all (a count, never names). An organizer can send an announcement to "members without a ride home".

## FR-EVRIDE-029 — Public groups and discovery
- AC1. `visibility = public` lists the group in the hub under "אירועים פתוחים" (city, kind, date, member count) and in search; the event place is shown at the venue label + city; join policy still applies; public groups are subject to a **review step** for new organizers.
- AC2. A public group's rides remain members-only (`S`); only the group card is public. Political or hate-adjacent events follow the moderation policy (07.15) and are never listed.
- AC3. Duplicate prevention: creating a public group shows existing public groups for the same city and date first.

## FR-EVRIDE-030 — Ride waitlist
- AC1. A full ride offers "הודיעו לי אם מתפנה מקום"; a freed seat notifies the first waiter once, who has 2 hours to book before the next is told.

---

## Phase 3 — Outline only

## FR-EVRIDE-031 — Link to an organization's event
An organization's event post (`G18`) may offer "קבוצת טרמפים" which creates a group with the event's place and window and joins registered attendees by invitation (never automatically).

## FR-EVRIDE-032 — Group chat
Only with a new multi-party chat model (a separate spec and ADR): membership-scoped, no media at first, mute, report per message, retention aligned with `FR-EVRIDE-016`.

## FR-EVRIDE-033 — Trust options
Drivers-must-be-verified (level 2, after `FR-VERIFY`), organizer pre-approved driver list, women-only / gender-separated ride preference (structured, today a note — open item), an event wrap-up ("N trips, M people, estimated cars saved") shown as an estimate, and multi-day shuttles.

---

## Edge-case catalog

| # | Case | Handling | FR |
|---|---|---|---|
| 1 | Invite link forwarded to a stranger or posted publicly | Rotate the link, switch to approval, remove/ban; the old link says only "invalid" | 004 AC3–4 |
| 2 | Someone guesses codes | 10 failed attempts/hour lock; 8 chars from a 31-char alphabet | 004 AC2 |
| 3 | Two guests join for the last place | One transaction with the group row locked; one gets `group_full` | 005 AC3 |
| 4 | Join racing a link rotation or a ban | Atomic; the ban and rotation win | 004 AC3, 005 AC3 |
| 5 | Banned person opens the link | Generic invalid-link, never "you are banned" | 004 AC7 |
| 6 | Signed-out or brand-new user opens the link | Token kept through sign-up/onboarding, resumes at preview; web fallback; code works after install | 005 AC4 |
| 7 | App not installed / universal links not yet configured | Web landing; manifests need `/rides/join` (PM item A2/A3) | routes |
| 8 | Link preview in WhatsApp leaks the event | Generic preview, `noindex`, no names or place | 004 AC6 |
| 9 | Event already started / ends in an hour / funeral at short notice | Allowed until it ends; no minimum lead | 002 AC3 |
| 10 | Multi-day event, overnight stay | Window `starts_at − 24 h` … `ends_at + 24 h`; ≤ 14 days | windows |
| 11 | Venue is a field/beach/kibbutz hall | Nearest official junction or city + access note | 002 AC4 |
| 12 | Venue label tries to carry a free-text address | Label never routes; navigation uses the official place | 002 AC2 |
| 13 | Two relatives create two groups for one wedding | Each is separate; one link can be shared; (public) duplicate hint in P2; no merge | 029 AC3 |
| 14 | Event moved or time edited | One push; rides flagged `outside_event_window`, never deleted | 015 |
| 15 | Event cancelled with confirmed rides | One transaction; no penalties; one consolidated push | 014 |
| 16 | Cancelled by mistake | Un-cancel within 24 h if still in the future | 014 AC4 |
| 17 | Event ends but a return ride is still on the road at 03:00 | Publishing closes at +12 h; running rides finish | 016 AC1 |
| 18 | Return at 01:00 — which "day" is it? | Grouped before/during/after the event, not by calendar day | 008 AC2 |
| 19 | DST change night | `timestamptz`, offset-correct display | 016 AC5 |
| 20 | Driver leaves the group with confirmed passengers | Explicit confirm; driver cancellation; passengers notified and offered replacements | 007 AC1 |
| 21 | Passenger removed by the organizer | Bookings cancelled, neutral message, no penalty to the removed | 007 AC2 |
| 22 | Organizer wants to leave | Must transfer first | 017 AC1 |
| 23 | Organizer deletes the account / is suspended | Succession; co-organizers; admin acts | 017 |
| 24 | Passenger holds two confirmed rides to the event | Refused as `leg_already_covered`; confirmation withdraws other pending | 010 AC3 |
| 25 | Two drivers confirm the same passenger at once | Locked ride + leg check; the second fails | 010 AC3–4 |
| 26 | Ride full; someone wants in | Waitlist (P2); otherwise request again or choose another | 030 |
| 27 | One-way offer (no return) | Legs are independent; the return board shows the gap | 008, 028 |
| 28 | Round trip: one leg cancelled | Ask about the other; never silent | 024 |
| 29 | Driver leaves late / changes the time | "Update departure" push, ≤ 3 per ride | 026 AC3 |
| 30 | Driver no-show / unsafe | Report from the ride; 3 reports hide it; emergency call stays | 018 |
| 31 | Alcohol on the way home | Reminder; sober chip (P2); no claim of verification | 018 AC3, 027 |
| 32 | Kids, car seats, wheelchairs, pets, instruments | Constraints note ≤ 280 shown prominently; no automatic filter | 009 AC1 |
| 33 | Gender-separated events (religious weddings) | Today the note; structured preference is an open item | 033 |
| 34 | Minors | Never drivers; passengers per S16 | 018 AC2 |
| 35 | A and B blocked each other but are in one group | Mutually invisible rides and chat card | 011 AC6 |
| 36 | Group ride leaks into the general feed, map, search, alerts, bot, stats, share page | Fail-closed audience + reader inventory test | 011 |
| 37 | The public-feed realtime broadcast carries a group ride | Group rides never broadcast on the public topic | 008 AC5, 011 AC2 |
| 38 | Last-used route pre-fills the event venue in a public ride | Group rides excluded from remembered routes | 009 AC6 |
| 39 | Waze handoff after publishing exposes the venue | Off for group rides | 009 AC2 |
| 40 | A non-member opens a stale push/link to a group ride | Same screen as a deleted post | 011 AC4 |
| 41 | Group reported as fake/commercial | 3 reports ⇒ hidden for review; rides keep working; admin decides | 019 |
| 42 | Notification storm in a 400-guest group | No push per ride; per-group daily budget; digest for organizers | 013 |
| 43 | Spam announcements | ≤ 5/day, ≤ 30 total, reportable | 012 |
| 44 | Cap lowered below the current members | Refused | 003 AC2 |
| 45 | Join requests pending at event end | Cancelled by the sweep | 005 AC6, 016 |
| 46 | Small group fingerprinting through counts | Buckets "10+", analytics exclude < 5 | 005 AC6, 022 AC3 |
| 47 | Sweep missed or runs twice | Idempotent, catches up | 016 AC3 |
| 48 | Data kept forever | Purge at +90 d: members, announcements, hashes, links | 011 AC9 |
| 49 | User deletes their account mid-event | Membership removed, their rides cancelled by the existing deletion flow, partners notified | 007 |
| 50 | Feature flag off in prod | No entry point; RPCs refuse | 001 AC4 |

## Notifications (catalog)

| Key | Trigger | Recipients | Critical |
|---|---|---|---|
| `event_group_join_request` | `pending` membership created | Organizers (hourly grouped) | — |
| `event_group_join_decision` | Approve / decline | Requester | ✅ on approve |
| `event_group_announcement` | Announcement posted | Active members | — |
| `event_group_moved` | Time change > 30 min | Active members | ✅ |
| `event_group_cancelled` | Group cancelled or removed | Active members, one per person | ✅ |
| `event_group_ride_match` | P2 match found | The request creator / the driver | — |
| `event_group_ride_reminder` | P2 reminders | Confirmed driver and passengers | ✅ within 6 h |

## Test plan (every layer, tests first)

- **Domain** (`@kc/domain`): `validateRideEventGroupDraft` (all limits and windows, both bounds), leg/window helpers, invite-code format, the two status graphs.
- **Application**: one use case per RPC with happy and error paths (`CreateRideEventGroup`, `JoinRideEventGroup`, `DecideGroupJoin`, `LeaveGroup`, `RemoveMember`, `RotateInvite`, `CancelGroup`, `PostAnnouncement`, `ListGroupBoard`, …).
- **Infrastructure**: `map*Row` mappers and `{code}` → domain error tests.
- **SQL** (`supabase/tests`, inside `begin; … rollback;`): RLS and grants (anon cannot call anything), each limit and boundary, join races as paired transactions, cascades (leave/remove/ban/cancel/end), sweep idempotency and catch-up, DST window, purge, and the **reader inventory leak matrix** — a non-member, a banned person, a removed person and an anonymous caller each get zero rows from every reader of `FR-EVRIDE-011` AC2.
- **Mobile**: components (create form, invite screen, join preview, board, manage), hooks, deep-link handling for signed-out start.
- **E2E**: a three-user journey (organizer creates and shares; driver joins by link and publishes both legs; passenger joins by code and books; an outsider sees nothing; organizer cancels and everyone is told once) and a Maestro flow for the mobile path, wired like the other worlds (`G40`).

## Rollout

`rides_event_groups_enabled`: on in kc-dev, off in kc-prod. Pilot with one real event on kc-dev and then prod for invited organizers; widen after the leak matrix and the pilot pass. Migrations claim `0750–0769` ([`MIGRATION_RANGES.md`](../../agents/MIGRATION_RANGES.md)). Delivery slices (one issue each): (1) data model + audience + leak matrix, (2) create/edit/invite/join, (3) members and succession, (4) group rides + booking guards, (5) board + notifications + announcements, (6) lifecycle + cancel/move, (7) moderation + admin + analytics, (8) E2E + pilot. Phase 2 and 3 follow.

## Success metrics (hypotheses, tuned after the pilot)

| Metric | Target |
|---|---|
| Invite link opened → joined | ≥ 50% |
| Members per group | ≥ 30 at a wedding-size event |
| Time from creation to the first ride offer | < 24 h |
| Guests with a confirmed ride to the event, at its start (P2) | ≥ 30% of members |
| New accounts created through invites, retained at 30 days | ≥ 25% |
| Critical safety incidents per 1000 group rides | 0 |
| Group-ride leak findings (test matrix, pilot, reports) | 0 |

## Open items for the PM (non-blocking; defaults apply until answered)

1. **Private only at launch, or public groups too?** Default: invite-only in P1, public in P2.
2. **Group chat?** Default: no, announcements plus pair chat; group chat is a separate project (P3).
3. **Who may create a group?** Default: any active member with an account older than 24 h, ≤ 3 active groups.
4. **Gender-separated rides** (religious weddings): today a free-text note; a structured "women only / men only" preference needs a decision on `FR-RIDE-029`.
5. **Event content policy**: political rallies and demonstrations as events — allowed under the general moderation policy, never listed publicly? Default: allowed, not listed.
6. **Group rides in the general feed for public groups?** Default: never.
7. **Sober-driver chip** wording and legal comfort (counsel).
8. **Link domain and manifests**: `/rides/join` in universal links and Android App Links depends on the Apple Team ID and Android SHA-256 (A2/A3).
9. **Legal text** for the join/creation acknowledgement and organizer responsibility (L3).
10. **UI name**: "קבוצת טרמפים לאירוע" (tile "קבוצות לאירועים").
