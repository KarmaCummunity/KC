# 2.21 Housing & Spaces (`housing`) — free space sharing

> **Status:** 🟡 Spec v1 (2026-11-03); every PM question decided, nine fills pending approval. **Implementation:** H1.1 server (migrations `0600`–`0603`, flow test `supabase/tests/flows/housing_lifecycle.sql`) — sub-categories, binding stay schemas and rules, conduct gate, private details with the reveal window and the fuzzed public point, booking request / decision with capacity and first-confirmation-wins, cancellation with late marks, completion with karma, no-show, sweep, host and guest lists, booking pushes. H1.2–H1.3 (part) client — domain rules and use cases, the Supabase adapter, and the stay section of an offer for the guest (request with the conduct gate, status, cancel, address, rating) and the host (every booking with its actions). Not yet: the host's exact-place and availability editors, "my stays" / "my hosting" screens, verification pre-check (`TD-245`), chat system messages, emergency button, safety freeze, search filters, matching. The world stays a portal (`world_housing_enabled` = off).

Prefix: `FR-HOUSING-*`

> **Source of truth.** Product book [`docs/spec/05_giving_worlds.md` §5.6](../05_giving_worlds.md) wins where it disagrees with this file (D35). This file is the detailed FR layer under it. Decisions: D30 (both sides verified), D24 (no visible ratings), D21 (expiry by type), D42 (emergency mode), D104 (owner management), D105 (blocking), `D112` (scope of this world), `D113`, `D114`, `D115`, `D116`, `D117`, `D118`. Fills pending approval: S16 and `S52`, `S53`, `S54`, `S55`, `S56`, `S57`, `S58`, `S59`. Legal texts: [`docs/legal/drafts/housing_and_verification_he.md`](../../legal/drafts/housing_and_verification_he.md) (drafts, counsel review before launch). Vision mined from `PRD_V2_NOT_FOR_MVP/donation_worlds/05_Housing.md` (R-Housing-1…10).

> **Scope.** The housing world lends **space**, for free, between verified members and organizations: a bed for a night, a roof in a crisis, a room for a gathering, a corner to store belongings. Four sub-categories share one booking engine (on `giving_handoffs`), one privacy model (exact place only after approval) and one safety layer (verification, code of conduct, emergency button, incident reports).

> **Non-goals (v1).** Money of any kind between the sides (no rent, no deposit, no "symbolic" fee, no required donation — D4, R-Housing-7 superseded by "always free" in §5.6); stays longer than 30 nights in the community track; damage insurance or escrow; a calendar sync with external platforms (Airbnb, Google Calendar); identity checks beyond the platform verification levels (D23); legal custody of stored goods.

---

## 0. Glossary (binding names — `docs/spec/94_glossary_and_naming.md`)

| Term (HE) | Term (EN) / code | Meaning |
|---|---|---|
| מארח | Host | The member or organization that offers a space (`direction='give'`). |
| אורח | Guest | The member who uses the space (`direction='request'` poster, or the booker of an offer). |
| הצעת מקום | Space offer | A housing listing with `direction='give'`. |
| בקשת מקום | Space request | A housing listing with `direction='request'`. |
| הזמנה | Booking | One guest's reservation of an offer for a date range — a `giving_handoffs` row with `world_slug='housing'`. |
| שהייה | Stay | A confirmed overnight booking from check-in to check-out. |
| פרטים חסויים | Private details | Exact address, entrance and access instructions — revealed only per FR-HOUSING-012. |
| מאגר אירוח מוגן | Shelter pool | Hosts who agreed to host people referred by an organization (FR-HOUSING-030). |
| רכז/ת אירוח | Housing coordinator | A member of a verified organization that runs the assisted track (FR-HOUSING-032). |
| שיבוץ | Placement | A booking created by a coordinator on behalf of a person in need. |

## 1. Sub-categories and listing kinds

The world has four **housing sub-categories** (the "item subcategory" pattern, D18). The sub-category is derived from the listing kind on the server (`listings.category_id` set from the kind; the client never sends it separately).

| Sub-category (HE) | `categories.slug` | Offer kind | Request kind | Track | Public in feed / search / map |
|---|---|---|---|---|---|
| Stays & hosting (לינה ואירוח) — travellers, tourists, trail walkers, family visits, medical-treatment companions | `stays` | `host_offer` (existing slug kept) | `stay_request` (existing) | Community | ✅ |
| Emergency shelter (קורת גג בחירום) — homeless people, people fleeing violence, at-risk youth, evacuees without a host | `emergency-shelter` | `shelter_pool_offer` | `shelter_request` | Assisted (org-mediated) | ❌ never |
| Event & gathering space (מקום לאירוע ולמפגש) — a party, a birthday, a meeting, a study session, a workshop, a rehearsal, a community gathering | `event-space` | `event_space_offer` | `event_space_request` | Community | ✅ |
| Storage space (שטח לאחסון) — personal belongings (moving, abroad, between homes) or equipment of a nonprofit organization; never for-profit goods | `storage` | `storage_offer` | `storage_request` | Community | ✅ |

- AC1. The six legacy housing `categories` rows (`family-room`, `whole-unit`, `sofa`, `outdoor`, `secondary-unit`, `emergency`) are deactivated (`is_active=false`); their meaning moves to `details.place_type` (FR-HOUSING-005/007/009). Existing listings keep their `category_id` and are re-pointed to `stays` by the same migration.
- AC2. The four new `categories` rows above are children of the `housing` root, in the order shown.
- AC3. `listing_kinds` gains the six new kinds; every housing kind's `detail_schema` is the binding schema of its FR below, with `additionalProperties:false` (0321 pattern).

---

## FR-HOUSING-001 — World entry and launch gate
- AC1. The Donations tab tile **דיור** routes to the housing world screen. While `app_flags.world_housing_enabled=false` the world is a **portal** (D60, D107): knowledge blocks, the curated housing organizations list and the hotline block only — no feed, no form. Tester (development) builds open the in-app feed regardless of the flag (#1630); a production build follows the flag.
- AC2. The flag is turned on only when H1 (§ Phasing) is complete, an ID-verification path exists (FR-HOUSING-003 AC5) **and** counsel has reviewed the legal drafts (D118, launch plan 96 L6). Counsel review gates the launch only; no phase waits for it.
- AC3. The create form lists housing in its category picker only while the flag is on; the sub-category picker then shows the three community sub-categories plus a fourth entry **"I need an emergency roof"** that opens FR-HOUSING-031 (never the regular form).

## FR-HOUSING-002 — World screen (hub, D36)
- AC1. Blocks, top to bottom: emergency block (only in an active emergency for the viewer's region, D42); search bar; sub-category chips (`All · Stays · Event space · Storage`); the world feed (offers and requests together); "my hosting" and "my stays" entry points (FR-HOUSING-036/037); "become a shelter-pool host" card (FR-HOUSING-030, assisted track live only); hotline & help block; housing organizations directory (D9 approved links); host and guest guides (KC-authored knowledge).
- AC2. The hotline block is pinned above the feed when the viewer picked **"I need an emergency roof"** or searched for shelter keywords; its content (phone numbers, hours) is maintained by the KC team, never hard-coded in the client.
- AC3. Emergency-shelter listings never appear in the hub (FR-HOUSING-030 AC4).

## FR-HOUSING-003 — Eligibility gate (D30, R-Housing-1, R-Housing-2)
- AC1. **Verified identity on both sides, in every sub-category** (`D116`). Publishing any housing offer or request, booking an offer, and approving a booking all require verification level 2 — an ID document + live selfie match (`D117`, [`22_identity_verification.md`](./22_identity_verification.md) FR-VERIFY-001). Server: `has_world_permission(uid, 'housing', 'publish'|'book'|'decide')` → `world_permission_denied` otherwise. Organization accounts use the organization's verification (level ≥ 2). The only exception is asking for an emergency roof (FR-HOUSING-031 AC1).
- AC2. **Pre-check (closes `TD-245`).** When housing is picked in the create form, or "book" is tapped, the client reads the viewer's verification state first; an unverified member sees a "verify your identity" card with the verification entry point **instead of** the fields. No form is ever filled in vain.
- AC3. **Code of conduct.** Before a member's first housing publish or booking, a full-screen code of conduct (text: legal drafts §1) (respect, no payment, no alcohol to minors, no discrimination beyond the host's declared house policy, safety, privacy of the other side, reporting) must be accepted. Acceptance is stored per user and version in `housing_conduct_acceptances (user_id, version, accepted_at)`; a new version re-prompts. Server error: `housing_conduct_required`.
- AC4. **Age.** Every member is 18+ (D109, server-enforced at sign-up); the verified document's date of birth confirms it (FR-VERIFY-006 AC2, FR-VERIFY-007 AC3). Minors travelling with a parent follow FR-HOUSING-026.
- AC5. **Verification path.** Verification runs through a certified provider (FR-VERIFY-005); a provider `review` result or a stuck member goes to the KC manual review of FR-VERIFY-008. There is no document upload into KC storage. The housing world launches only once FR-VERIFY ships (FR-HOUSING-001 AC2).
- AC6. A suspended or banned member, or a member under a housing freeze (FR-HOUSING-025), cannot publish, book or approve; existing confirmed bookings follow FR-HOUSING-025 AC3.

## FR-HOUSING-004 — Create form: fields common to every housing kind
- AC1. Order: sub-category → offer / request (worded per sub-category: "I offer a place to stay" / "I'm looking for a place to stay", etc.) → kind fields (FR-HOUSING-005…010) → availability (FR-HOUSING-011) → location (FR-HOUSING-012) → title + description → photos → visibility.
- AC2. Title 1–80 chars, auto-suggested from the kind fields (e.g. "Private room for 2 · Haifa · Carmel"), editable. Description ≤ 500 chars, optional.
- AC3. Photos: optional for every housing kind (§7.2: housing photo "no"); ≤ 5, EXIF stripped. An offer without photos shows a nudge "listings with photos get more requests". Photos must never show the house number or the building entrance sign (copy hint under the picker).
- AC4. Visibility `Public` (default) / `FollowersOnly`; `OnlyMe` is drafts only. Anonymity: the host is always shown by name on an offer (a guest must know who hosts them); a request may hide the poster's name until a booking is confirmed (anonymity level 2, D16).
- AC5. **Free-only declaration**: every offer form ends with a non-editable line "Hosting in KC is free. Asking for money, a deposit or work in return is forbidden." and the publish button reads "Publish for free".
- AC6. Open-listing cap: housing listings count towards the 20-open-posts cap of a private member (S34); an organization account has no cap.
- AC8. **Organizations give and take** (`D115`): an organization account (D88, acting through a member with an org role) may publish offers and requests in every community sub-category, book offers and search, exactly like a member; the organization's verification replaces the personal one (FR-HOUSING-003 AC1). In the assisted track an organization offers through the shelter pool and requests through placements (FR-HOUSING-030, 032), never through a shelter request.
- AC7. Domain validation lives in `@kc/domain` (`validateHousingDraft` per kind) and mirrors the server checks exactly; the server is the source of truth (`listings_enforce_world_rules` extended for housing).

## FR-HOUSING-005 — Stay offer (`host_offer`) fields
| Field | Key | Type / bounds | Required |
|---|---|---|---|
| Place type | `place_type` | `private_room` · `shared_room` · `couch` · `whole_unit` · `secondary_unit` (cabin, caravan, granny flat) · `tent_pitch` (yard / plot) | ✅ |
| Beds / guests capacity per night | `capacity` | integer 1–20 | ✅ |
| Exclusive use | `exclusive` | boolean — true for `whole_unit` / `secondary_unit` by default: one booking per night | ✅ |
| Min / max nights per booking | `min_nights`, `max_nights` | 1 ≤ min ≤ max ≤ 30 (`D120`) | ✅ (defaults 1 / 3) |
| Check-in window | `check_in_from`, `check_in_until` | `HH:MM` local, from < until (until may be after midnight ≤ 02:00) | ✅ (defaults 16:00 / 22:00) |
| Check-out by | `check_out_by` | `HH:MM` local | ✅ (default 10:00) |
| Who the host accepts | `guest_policy` | `any` · `women_only` · `men_only` · `families_only` · `couples_and_families` | ✅ (default `any`) |
| Children welcome | `children_ok` | boolean | ✅ |
| Pets welcome | `pets_ok` | boolean | ✅ |
| Smoking | `smoking` | `no` · `outside_only` · `yes` | ✅ (default `no`) |
| Household | `household` | multi: `kosher_kitchen`, `shabbat_observant`, `vegetarian_kitchen`, `pets_in_home`, `kids_in_home` | — |
| Amenities | `amenities` | multi: `shower`, `hot_water`, `kitchen`, `laundry`, `wifi`, `heating`, `ac`, `parking`, `bedding`, `towels`, `electricity` (tent pitch), `drinking_water` (tent pitch), `toilet` (tent pitch), `safe_room` (ממ"ד) | — |
| Accessibility | `accessibility` | multi: `step_free_entry`, `elevator`, `accessible_bathroom`, `ground_floor` | — |
| Host languages | `languages` | multi from ISO 639-1 list (default: viewer's app language) | — |
| Trail angel | `near_trail` | `israel_national_trail` · `jerusalem_trail` · `kinneret_trail` · `golan_trail` · `other_trail` · null | — |
| Distance from the trail | `trail_distance_km` | 0–20, required when `near_trail` set | cond. |
| Pick-up from the trail | `trail_pickup` | boolean (cross-world link to rides, FR-HOUSING-038) | — |
| Breakfast / meal offered | `meal_offered` | boolean (informational; no food listing is created) | — |
| House rules | `house_rules` | text ≤ 300 | — |

- AC1. `tent_pitch` requires at least one of `toilet` / `drinking_water` to be explicitly true **or** an explicit "no facilities" acknowledgement (`no_facilities_ack=true`) — PRD edge case "outdoor space without water / toilet must be stated in advance".
- AC2. `shared_room` and `couch` force `exclusive=false`; `whole_unit` / `secondary_unit` default `exclusive=true` (editable).

## FR-HOUSING-006 — Stay request (`stay_request`) fields
| Field | Key | Type / bounds | Required |
|---|---|---|---|
| Purpose | `stay_purpose` | `trail_walk` · `travel_tourism` · `family_visit` · `medical_companion` · `study_exam` · `work_trip` · `evacuation` (selectable only while FR-HOUSING-033 applies) · `other` | ✅ |
| Dates | `check_in_date`, `check_out_date` | local dates; check-in ≥ today; nights 1–30; check-in ≤ today + 180 d | ✅ |
| Flexible dates | `flexible_days` | 0–3 (± days) | — (default 0) |
| Adults / minors | `adults`, `minors` | adults 1–8, minors 0–7, adults + minors ≤ 8 | ✅ |
| Arrival estimate | `arrival_time` | `HH:MM` | — |
| Needs | `needs` | multi: `step_free_entry`, `accessible_bathroom`, `kosher_kitchen`, `pets` (bringing a pet), `parking`, `quiet` | — |
| Place types acceptable | `place_types` | multi from FR-HOUSING-005 `place_type` (default all) | — |
| Trail | `near_trail`, `trail_point` | same enum; `trail_point` = an official city or junction (D71 catalog) | cond. (`trail_walk`) |
| Gear | `gear` | multi: `tent`, `sleeping_bag`, `mat` | — |

- AC1. Location of a request = city (or the trail point), never an address (§7.2).
- AC2. A request expires at the end of its check-out date (D21 "stay dates"); with `flexible_days` the latest possible check-out.

## FR-HOUSING-007 — Event space offer (`event_space_offer`) fields (`S55`)
| Field | Key | Type / bounds | Required |
|---|---|---|---|
| Space type | `place_type` | `living_room` · `yard_garden` · `rooftop` · `hall_club` · `meeting_room` · `studio` · `outdoor_plot` | ✅ |
| Max attendees | `capacity` | integer 2–200 | ✅ |
| Event types allowed | `event_types` | multi: `party_birthday`, `meeting_study` (ישיבה / חוג), `workshop_class`, `rehearsal`, `community_gathering`, `prayer_ceremony`, `kids_activity` | ✅ ≥ 1 |
| Max hours per booking | `max_hours` | 1–12 | ✅ (default 4) |
| Quiet hour | `quiet_from` | `HH:MM`, default 23:00; no booking may end after it | ✅ |
| Music / sound | `sound_level` | `none` · `background` · `amplified` | ✅ |
| Alcohol | `alcohol_ok` | boolean | ✅ |
| Kitchen use | `kitchen` | `none` · `water_only` · `full` | ✅ |
| Kosher kitchen | `kosher_kitchen` | boolean | — |
| Shabbat & holidays use | `shabbat_ok` | boolean | ✅ |
| Equipment | `equipment` | multi: `tables`, `chairs`, `projector`, `whiteboard`, `speakers`, `wifi`, `ac`, `heating`, `toilets`, `parking` | — |
| Accessibility | `accessibility` | as FR-HOUSING-005 | — |
| Cleanup | `cleanup` | fixed: "the guest leaves the space as found" + optional `cleanup_note` ≤ 200 | ✅ |
| House rules | `house_rules` | text ≤ 300 | — |

- AC1. **Free events only.** The event held in the space must be free for its attendees: no tickets, entry fees, sales or fundraising. The booking sheet repeats this; a breach is reportable with reason `housing_paid_event`.
- AC2. The host may be present or not (`host_present` boolean, required); when `false`, access instructions are mandatory private details (FR-HOUSING-012).

## FR-HOUSING-008 — Event space request (`event_space_request`) fields
| Field | Key | Type / bounds | Required |
|---|---|---|---|
| Event type | `event_type` | one of FR-HOUSING-007 `event_types` | ✅ |
| Date and hours | `event_starts_at`, `event_ends_at` | start ≥ now + 2 h, ≤ now + 180 d; duration 1–12 h | ✅ |
| Attendees | `attendees` | 2–200 | ✅ |
| Needs | `needs` | multi from FR-HOUSING-007 `equipment` + `kitchen`, `alcohol`, `amplified_sound`, `step_free_entry` | — |
| Who it is for | `audience` | `private` (friends / family) · `community` (open community gathering) · `organization` | ✅ |

- AC1. A request expires at `event_ends_at` (D21 "event at its date").

## FR-HOUSING-009 — Storage offer (`storage_offer`) fields (`S56`)
| Field | Key | Type / bounds | Required |
|---|---|---|---|
| Space type | `place_type` | `room` · `closet_corner` · `storeroom` (מחסן) · `basement` · `garage_parking` · `yard_covered` · `yard_open` · `warehouse` | ✅ |
| Capacity | `capacity_m3` | 0.5–100 m³ | ✅ |
| Shared between guests | `shared` | boolean — false ⇒ one active booking at a time | ✅ |
| Min / max duration | `min_days`, `max_days` | 7 ≤ min ≤ max ≤ 180 | ✅ (defaults 7 / 90) |
| Access for the guest | `access` | `by_appointment` · `weekly_window` · `none_until_pickup` | ✅ |
| Conditions | `conditions` | multi: `dry`, `climate_controlled`, `lockable`, `ground_floor`, `vehicle_access`, `elevator`, `camera` | — |
| Goods accepted | `accepts` | multi: `personal` (household belongings), `nonprofit` (equipment of a nonprofit organization) | ✅ ≥ 1 |
| Max single-item weight | `max_item_kg` | 1–500 | — |

- AC1. Banned goods (fixed list, shown on offer and booking): hazardous or flammable materials, gas cylinders, weapons and ammunition, illegal goods, perishable food, live animals or plants needing care, cash and valuables above a declared value, anything requiring a licence to store. The guest acknowledges the list on every booking (`banned_goods_ack=true`); server error `housing_storage_banned_goods_ack_required`.
- AC2. **Personal and nonprofit only** (`D114`): `nonprofit` goods are accepted only if the host ticked `nonprofit`, and only from an organization account whose type is nonprofit association, public-benefit company, public body or informal initiative (D88, `20_organizations.md`); a private venture or any for-profit business cannot book storage for its goods (`housing_storage_for_profit_forbidden`). The storage stays free (no rent, no "handling fee").

## FR-HOUSING-010 — Storage request (`storage_request`) fields
| Field | Key | Type / bounds | Required |
|---|---|---|---|
| Purpose | `storage_purpose` | `moving` · `abroad` · `between_homes` · `renovation` · `organization_equipment` · `other` | ✅ |
| Goods type | `goods_type` | `personal` · `nonprofit` (organization account only, FR-HOUSING-009 AC2) | ✅ |
| Volume | `volume_preset` / `volume_m3` | `few_boxes` (≤ 1 m³) · `room` (≤ 5 m³) · `apartment` (≤ 15 m³) · `custom` (0.1–50 m³) | ✅ |
| From / until | `start_date`, `end_date` | start ≥ today, ≤ today + 90 d; 7–180 days | ✅ |
| Needs | `needs` | multi from FR-HOUSING-009 `conditions` | — |
| Heaviest item | `max_item_kg` | 1–500 | — |

- AC1. A request expires at `start_date + 7 d` if never booked (a late start is a new request).

## FR-HOUSING-011 — Availability of an offer
- AC1. Three availability modes (PRD 2.1): **window** (from date → to date, one-off), **weekly** (weekdays + optional end date, e.g. "every Tuesday night"), **ongoing** ("contact me, I'll answer"). Stored in `details.availability = {mode, from?, until?, weekdays?, end_date?}`.
- AC2. Blackout dates: the host may block up to 60 single dates (`details.blackout_dates`); a booking cannot touch a blackout date.
- AC3. Bookable unit per sub-category: stays = nights (check-in date inclusive, check-out date exclusive); event space = a time slot on one date; storage = a date range.
- AC4. The server computes availability from `availability` − `blackout_dates` − confirmed bookings (FR-HOUSING-016 AC3). The detail screen renders the next 60 days as a calendar (stays, storage) or a day list with free hours (event space).
- AC5. `ongoing` offers never expire; they receive relevance reminders 14 days after publish and every 30 days (D59). `window` offers expire at `until`; `weekly` offers at `end_date` or never.

## FR-HOUSING-012 — Location privacy and private details (D30, R-Housing-3, `S53`)
- AC1. An offer stores the exact location (city + official street + house number, D71 catalogs) but publishes only the city and the neighborhood name. The map shows a **fuzzed point**: a stable point 300–700 m from the true location, computed once at publish and stored in `listings.geo`; the true point lives only in the private table. A circle of 700 m is drawn around the fuzzed point.
- AC2. Private details live in `housing_private_details (listing_id PK, street_id, house_number, apartment, floor, entrance_notes ≤ 300, access_instructions ≤ 500, true_geo)`. RLS: SELECT by the owner; by a guest whose booking on that listing is `confirmed` or `handed_over`, from confirmation until **end + 24 h** (storage: until the return is confirmed + 24 h); by super-admins and support when handling an emergency or incident. No other path (no RPC, no view) returns them.
- AC3. Access codes (key box, door code) may be written in `access_instructions` only; the form warns "change the code after the stay".
- AC4. Requests carry the city only; a guest's own address is never asked.
- AC5. The chat between the sides never auto-posts the address; the confirmed guest opens it from the booking card ("show address").

## FR-HOUSING-013 — Card and detail screen (§7.4)
- AC1. Card: world icon + sub-category chip, direction, title, city · neighborhood, the key line per sub-category ("2 guests · 1–3 nights · from tonight" / "up to 40 people · up to 4 h" / "3 m³ · 7–90 days"), up to 4 condition chips (♿ step-free, 🐾 pets, ✡ kosher, 🥾 trail angel, 🔒 lockable, 🍷 alcohol), host name + verification level + "N completed stays" + member since (S16). **No rating is ever shown** (D24).
- AC2. Detail: photos, all public fields grouped (place, rules, amenities, accessibility), availability calendar (FR-HOUSING-011 AC4), fuzzed map circle, host trust block (verification level, completed housing bookings, seniority, languages), the free-only line, report, and the primary action: **Request to book** (offer) / **Offer my place** (request — opens a booking proposal from one of my offers, FR-HOUSING-015 AC6).
- AC3. The owner sees instead: bookings panel (FR-HOUSING-036), edit, pause, delete (D104 guards).

## FR-HOUSING-014 — Search, filters and map
- AC1. World search: free text (≥ 2 chars, 300 ms debounce) over title, description, city and neighborhood.
- AC2. Filters by sub-category — **stays**: dates, guests, place type, city + radius, amenities, accessibility, pets, children, smoking, household (kosher, Shabbat), languages, trail; **event space**: date + hours, attendees, event type, equipment, alcohol, sound, Shabbat use; **storage**: start date + duration, volume, goods type, conditions, access. Common: host type (member / organization), direction.
- AC3. Date filters return only offers with the whole requested range available (FR-HOUSING-011 AC4); fully booked offers are hidden, not greyed.
- AC4. Sort: Recommended (default, §7.3), nearest, newest, soonest available.
- AC5. Map mode shows fuzzed circles only (FR-HOUSING-012 AC1); clusters at low zoom.
- AC6. Emergency-shelter kinds are excluded from every search, map and feed query at the data layer, not by a client filter.

## FR-HOUSING-015 — Booking request
- AC1. A verified guest who accepted the code of conduct taps **Request to book** on an offer and fills a booking sheet: dates / slot / storage period (pre-filled from the search), party (adults + minors / attendees / volume), a short message to the host (1–500 chars, required: "say who you are and why"), the acknowledgements of the sub-category (banned goods, free event, minors accompanied).
- AC2. RPC `request_housing_booking(p_listing_id, p_range, p_party, p_message, p_acks)` inserts a `giving_handoffs` row (`world_slug='housing'`, `status='reserved'`, `slot_starts_at`/`slot_ends_at` = check-in / check-out instant, event start / end, or storage start / end) plus a `housing_booking_details` row (FR § Data contract). Errors: `own_listing`, `listing_not_available`, `housing_dates_unavailable`, `housing_nights_out_of_range`, `housing_capacity_exceeded`, `housing_policy_mismatch` (guest policy, children, pets), `housing_minor_unaccompanied`, `housing_pending_cap`, `housing_booking_overlap`.
- AC3. **Pending cap** (`S54`): a guest holds at most 3 `reserved` housing bookings at a time. When one is confirmed, the guest's other `reserved` bookings whose range overlaps it are withdrawn automatically (`cancel_reason='superseded'`) and their hosts are told politely ("the guest found another place").
- AC4. **No double booking**: a guest cannot hold two confirmed bookings with overlapping ranges in the same sub-category (`housing_booking_overlap`).
- AC5. The booking opens (or reuses) the pair's chat anchored on the listing (D13) and posts the guest's message there as the first message.
- AC6. **Host-to-request proposal**: a host who sees a matching request may tap **Offer my place**, pick one of their open offers and the request's range; this creates a booking with the request poster as guest in `status='reserved'` and `proposed_by='host'`; the **guest** then accepts or declines (same RPC pair, roles swapped). On acceptance the request listing closes as fulfilled.

## FR-HOUSING-016 — Host decision and capacity
- AC1. The host sees every booking on the offer (FR-HOUSING-036) and approves or declines each. Approve → `confirmed` (`confirmed_at=now()`); decline → `cancelled` with `cancel_reason='declined'` and an optional note to the guest.
- AC2. Approve is atomic: the RPC locks the listing row, re-checks the guest's eligibility (FR-HOUSING-003), the range against blackout dates, and capacity, then confirms (pattern of rides `0533`).
- AC3. **Capacity rules.** Stays: for every night of the range, sum(guests of confirmed bookings) + this booking ≤ `capacity`, and if `exclusive` no other confirmed booking touches that night. Event space: no two confirmed bookings overlap in time (one event at a time); attendees ≤ `capacity`. Storage: sum(volume of confirmed + active bookings) + this booking ≤ `capacity_m3`; if `shared=false`, no overlapping booking. Violation → `housing_capacity_exceeded`.
- AC4. Approving reveals the private details to the guest (FR-HOUSING-012 AC2) and posts a system message in the chat ("booking confirmed — address available on the booking card").
- AC5. A host may approve at most one booking per guest per offer per range; re-requests after a decline are allowed after 7 days (anti-pressure).

## FR-HOUSING-017 — Booking expiry and reminders (`S52`)
- AC1. An unanswered `reserved` booking expires **24 h after it was made or at its start, whichever is earlier** (rides D96 pattern), `cancel_reason='expired'`; the guest is notified with up to 3 similar open offers (R-Housing-8 rewritten: KC suggests, never forwards a request on its own).
- AC2. Sweep `housing_bookings_expire_sweep` every 10 minutes.
- AC3. Reminders (`important` group, D26): host — new request (immediately), 4 h before expiry if still unanswered; guest — 24 h before start ("your stay with N tomorrow"), at start ("check-in from 16:00"); both — at end ("mark the stay completed").

## FR-HOUSING-018 — Cancellation policy
- AC1. Guest cancels a `reserved` booking at any time, silently for the host's karma, with a notification to the host.
- AC2. Guest cancels a `confirmed` booking: free until 24 h before start; later = **late guest cancellation** (`late_cancel=true`), a trust-engine signal (D24), never shown to users.
- AC3. Host cancels a `confirmed` booking: allowed until start, with a required reason (`changed_plans` · `emergency` · `safety` · `other` + note); within 48 h of start = **late host cancellation**, a trust-engine signal, and the guest immediately gets up to 3 alternative offers for the same range.
- AC4. After start (`status` still `confirmed`, `now() ≥ slot_starts_at`) neither side "cancels"; they end early via FR-HOUSING-019 AC4.
- AC5. Storage after drop-off: the guest may end any time (pickup); the host must give **7 days' notice** (`end_notice_at`), except for a safety reason, which notifies support at once.

## FR-HOUSING-019 — Check-in, active period and completion (§7.5)
- AC1. Closing actions by sub-category: stays — **"stay completed"**; event space — **"event completed"**; storage — **"goods dropped off"** (start) then **"goods returned"** (end).
- AC2. Who closes: the host taps completion; the guest may tap "I've left" / "event ended" / "picked up my goods", which asks the host to confirm. Completion is allowed from start (stays: check-in time; storage drop-off: start date) until **end + 7 d**; an early departure counts as completed.
- AC3. Completion sets `status='handed_over'`, `handed_over_at=now()`, grants karma (FR-HOUSING-022) once, opens the rating step (FR-HOUSING-021), and closes the chat anchor with a system message.
- AC4. Ending early: either side may end an active stay / storage (reason required); the booking completes with the actual nights / days counted for karma.
- AC5. Not completed by end + 7 d → the booking closes with `status='cancelled'`, `cancel_reason='not_completed'`, no karma (no automatic karma, anti-fraud).
- AC6. Storage drop-off: the guest records an **inventory** (≤ 30 lines: item + quantity) and ≥ 1 photo of the stored goods; the host confirms "received as listed". The inventory is visible to both sides and to support only. At return, the host confirms "returned as listed" or flags a discrepancy (→ FR-HOUSING-020 AC3).
- AC7. A listing is never closed by one booking (an offer serves many bookings); the owner closes it manually or it expires (FR-HOUSING-011 AC5). A request closes when its booking confirms.

## FR-HOUSING-020 — No-show and "not as described"
- AC1. Host marks the guest **no-show** from start + 3 h until start + 24 h → `status='no_show'`; trust-engine signal on the guest.
- AC2. Guest reports **"host not there / no access"** from start until start + 12 h → the booking is flagged, support is alerted (`housing_access_failed` admin task), the guest gets alternatives (FR-HOUSING-018 AC3) and, if the emergency button is pressed, FR-HOUSING-024 applies.
- AC3. **"Not as described"** (guest) or **"damage / discrepancy"** (host) is a report on the booking with photos (≤ 5) and a note ≤ 500; it opens an admin task, never a public mark. KC mediates; it does not compensate (non-goal).

## FR-HOUSING-021 — Ratings and trust (D15, D24)
- AC1. After completion both sides rate 1–5 with an optional note ≤ 300 chars, through the generic handoff rating (`rate_giving_handoff`), within 7 days (R-Housing-5).
- AC2. Ratings are visible only to their rater and to KC admins (D24, G4). Profile and cards show verification level, completed housing bookings and seniority only (S16).
- AC3. The trust engine (G10) weighs housing ratings, late cancellations, no-shows and incidents; three ratings ≤ 2 from distinct guests within 90 days open an admin review of the host (R-Housing-9 rewritten: review, not an automatic suspension).

## FR-HOUSING-022 — Karma (§7.6, `S58`)
| Action | Points | Cap |
|---|---|---|
| Stay completed — host | 30 per night (existing row) | 7 nights per booking |
| Stay completed — guest | 10 (existing row) | per booking |
| Event completed — host | 15 | 2 per day |
| Event completed — guest | 5 | per booking |
| Storage returned — host | 5 per started week | 40 per booking |
| Storage returned — guest | 3 | per booking |
| Placement completed (assisted) — host | as "stay completed — host" | 7 nights per placement |

- AC1. Values live in `KARMA_POINT_VALUES`; grants use `karma_grant_once` keyed per handoff (idempotent), reversed if a completion is undone by an admin.

## FR-HOUSING-023 — Chat anchor and system messages
- AC1. One chat per pair (D13) anchored on the listing; the booking card in the chat header shows range, party, status and the actions the viewer may take.
- AC2. System messages on: request, proposal, confirm, decline, expiry, cancellation (with who), start, completion, no-show, emergency call (to the caller's support thread, FR-HOUSING-024).
- AC3. Blocking (D105) between the sides cancels every `reserved` booking between them and hides each side's listings from the other; a `confirmed` future booking is cancelled with `cancel_reason='blocked'` and support is told; an **active** stay is not silently cancelled — support is alerted to check on both sides.

## FR-HOUSING-024 — Emergency button (R-Housing-4, `S59`)
- AC1. Visible on the booking card to the host and the guest of a `confirmed` booking from start − 1 h until end + 2 h (storage: on the drop-off and pickup dates only).
- AC2. Two taps (confirm sheet) send an emergency call: optional location (if permitted) and note; the call alerts KC support and super-admins (`housing_emergency`, `emergency` group — bypasses quiet hours, D42) and, for a placement, the coordinator of the placing organization. The caller sees the emergency-services numbers at once (KC-maintained block).
- AC3. Throttle: once per user per booking per 5 minutes (`housing_emergency_throttled`). Stored in `housing_emergency_events`; RLS: caller, the other side (existence only, no location), support and super-admins.
- AC4. KC is not an emergency service: the confirm sheet says so and puts "call the police" first.

## FR-HOUSING-025 — Safety incidents (R-Housing-6)
- AC1. A report on a housing user or booking may carry the category **safety incident** (harassment, threat, violence, sexual misconduct, theft). It opens a priority admin task with a 24 h review target.
- AC2. A safety-incident report by a counterpart of a booking that started (or of a confirmed booking) places a **housing freeze** on the reported member at once: no new publish, booking or approval in housing; their open housing listings are paused. The freeze does not hide them elsewhere in KC (D33 thresholds still govern the rest).
- AC3. During a freeze, the reported member's confirmed future bookings are cancelled with `cancel_reason='safety_review'` and both sides are told neutrally ("the booking was cancelled by KC"); an active stay triggers a support call to the guest.
- AC4. The admin either lifts the freeze or escalates to suspension (D33); a malicious safety report counts against the reporter (S12).

## FR-HOUSING-026 — Minors (S16)
- AC1. Community track: a guest party with minors must include at least one adult who is the parent or legal guardian of every minor (`minors_with_guardian_ack=true`); otherwise `housing_minor_unaccompanied`.
- AC2. Minors have no KC account (D109: minimum age 18), so a minor is only ever a member of an adult guest's party; unaccompanied minors and at-risk youth are served only through the assisted track (FR-HOUSING-031/032).
- AC3. Event space: an event whose audience is minors (`kids_activity`) requires a responsible adult guest present for the whole booking; alcohol is never allowed in a `kids_activity` booking.

## FR-HOUSING-027 — Free-only enforcement (D4, §5.6 "always free")
- AC1. Report reasons added for housing: `housing_payment_requested` (rent, deposit, fee, tips), `housing_work_required` (labour as a condition), `housing_paid_event`. A confirmed report removes the listing (`removed_admin`) and bans the owner from housing for 30 days.
- AC2. A host may **invite** a guest to help (e.g. farm volunteering) through a separate time-world post; it can never be a condition of a booking.
- AC3. The publish and booking screens carry the free-only line (FR-HOUSING-004 AC5); the code of conduct makes it explicit.

## FR-HOUSING-028 — Storage end of term and unclaimed goods
- AC1. 7 days and 1 day before `end_date` both sides are reminded; the guest may extend once by up to the offer's `max_days` (host approval required).
- AC2. Goods not picked up by `end_date`: day 1 — the guest and support are notified; day 7 — an admin task opens; KC contacts the guest through every channel it has. KC never instructs the host to dispose of goods; the host is pointed to the storage-agreement summary. Notice texts: legal drafts §7; the steps after day 7 are pending counsel (drafts, question 3).
- AC3. The **storage agreement summary** (legal drafts §6; auto-generated from the booking: parties, period, inventory, access, banned goods, end-of-term steps) is shown and accepted by both sides at confirmation and stored with the booking.

## FR-HOUSING-029 — Event rules at the booking
- AC1. The booking sheet shows the host's quiet hour, sound level, alcohol and kitchen rules; the guest accepts them (`event_rules_ack=true`).
- AC2. A booking may not end after `quiet_from`, may not exceed `max_hours`, and attendees may not exceed `capacity` (server checks, `housing_event_rules_violation`).
- AC3. After the event the host confirms completion with an optional "left as found: yes / no"; "no" opens FR-HOUSING-020 AC3.

---

## Assisted track — emergency shelter (`S57`, D30, S16, R-Housing-10)

The assisted track gives a roof to people in crisis **only through professional bodies**. A member never hosts a person in crisis directly from a public post; members donate space to the shelter pool and organizations place people into it.

## FR-HOUSING-030 — Shelter-pool offer (`shelter_pool_offer`)
- AC1. A verified member or organization opts in from "become a shelter-pool host": place type and capacity (as FR-HOUSING-005), max nights per placement (1–90), notice needed (`immediate` · `24h` · `72h`), who they can host (multi: `adult_women`, `adult_men`, `families`, `youth_via_org`, `elderly`), accessibility, pets, languages, the districts they serve, and optionally specific organizations only.
- AC2. A shelter-pool host completes the shelter-host guide (KC-authored, ≈ 10 min, checkbox at the end) once.
- AC3. The offer is visible **only** to housing coordinators of organizations in scope (FR-HOUSING-032 AC1) — never in the feed, search, map, matching, profile tabs or a shared link (`is_listing_visible_to` returns false for everyone else).
- AC4. The host may pause or leave the pool at any time; leaving with an active placement requires the coordinator's acknowledgement (no one is put on the street by an app action).

## FR-HOUSING-031 — Confidential shelter request (`shelter_request`)
- AC1. Any signed-in member may ask for an emergency roof for themselves — verification is **not** required to ask (the organization vouches later, `verification_method='org_vouch'`). Fields: urgency (`tonight` · `this_week` · `planning`), district / city, adults + minors, needs (accessibility, pets, medical equipment, women-only), preferred contact (`in_app_chat` · `phone_call` — phone from the profile), optional note ≤ 500. No reason field is required.
- AC2. The request is never public: `anonymity_level=1` (operators and in-scope coordinators only); it is excluded from feed, search, map and matching at the data layer.
- AC3. On submit the member sees the hotline block at once and a status screen ("received — an organization will contact you"); the status shows acknowledged / in progress / placed / closed.
- AC4. Routing: the request goes to the coordinators of every organization in scope for its district; the first to tap **Take it** owns it (others see "taken"). SLA: `tonight` — 2 h; `this_week` — 24 h; `planning` — 72 h. Unacknowledged past the SLA → KC support is alerted and calls back if a phone exists.
- AC5. If no organization serves the district, the request goes straight to KC support, who refers to the relevant hotline; KC never places a person itself.
- AC6. Data minimisation: request details are deleted 90 days after the request closes; only counts remain for statistics (D106).

## FR-HOUSING-032 — Coordinator placement
- AC1. A **housing coordinator** is a member holding an org role (`org_admin` · `org_manager` · `org_employee`) of an organization with verification level ≥ 3 **and** `organizations.housing_coordination_enabled=true` (granted by a super-admin after onboarding), scoped to the districts in `organization_housing_scopes`.
- AC2. The coordinator searches the pool in scope by district, dates, people and needs, and proposes a **placement** to a host: dates (1–max nights), people count, first name or alias only, needs, and the coordinator's contact. This creates a `giving_handoffs` row with `placed_by_org_id` and the coordinator as the accountable contact.
- AC3. The guest is either a KC member (vouched by the org on placement) or **off-platform** (`guest_off_platform=true`; the recipient of record is the coordinator). An off-platform guest's identity is held by the organization, never by KC.
- AC4. The host approves or declines within the notice they set (`immediate` placements: 2 h). Approval reveals the private details to the coordinator (and to a member guest).
- AC5. During a placement the coordinator records a check-in at least every 72 h (reminders to the coordinator; a missed check-in alerts the org manager, then KC support). The host can reach the coordinator from the booking card and has the emergency button (FR-HOUSING-024), which also alerts the coordinator.
- AC6. Completion is confirmed by the coordinator; the host gets hosting karma; the guest record holds no rating unless the guest is a member and chooses to rate.

## FR-HOUSING-033 — Emergency mode: hosting evacuees (D42)
- AC1. While an emergency is active for a region with the housing world in scope, the housing hub shows the emergency block on top with the template **"host evacuees"**: a stay offer pre-filled with `evacuee_hosting=true`, `max_nights` up to 30, and the region.
- AC2. Evacuee stay requests (`stay_purpose='evacuation'`, offered in the form only while the mode is on for the poster's region) rank first in the hub and in matching for that region; notifications use the `emergency` group within the declared region (S28).
- AC3. Hosts always verify their identity (D30). An evacuee **guest** who left home without documents may instead be confirmed by a recognised organization (a municipality evacuation centre or an NGO with housing coordination) for evacuee stays in the declared region while the emergency lasts (`D122`); the confirmation is recorded as `verification_method='org_vouch'` with the confirming organization, and it lapses with the emergency.
- AC4. Karma +50% on hosting in the declared region (S28).

---

## FR-HOUSING-034 — Matching (MATCHING_V2)
- AC1. `housing` joins `matching_settings.worlds`. Candidates: same sub-category (community kinds only), opposite direction, both owners verified, offer availability covers the request range (stays / storage) or slot (event), capacity ≥ party / attendees / volume, policy compatible (guest policy, children, pets, accessibility needs, kosher if needed), within the world radius (80 km; trail requests: the trail point).
- AC2. Score: distance, date fit (exact > flexible), condition fit, freshness; housing is exempt from the text-head gate (`notify_min_text`), like rides.
- AC3. Delivery follows the platform caps (3 a day, quiet hours) — except evacuee pairs in an active emergency (FR-HOUSING-033 AC2).
- AC4. Assisted kinds never enter matching.

## FR-HOUSING-035 — Listing expiry and relevance
- AC1. Offers: per FR-HOUSING-011 AC5. Requests: per FR-HOUSING-006 AC2, FR-HOUSING-008 AC1, FR-HOUSING-010 AC1.
- AC2. An offer whose every future date is blackout or booked shows "fully booked" to the owner and is hidden from search (FR-HOUSING-014 AC3) without changing its status.
- AC3. Owner management by status follows D104; an active booking (`reserved` or `confirmed`, or storage between drop-off and return) blocks pause, delete and changes to capacity, place type, location and availability that would break it (`housing_active_booking_conflict`).

## FR-HOUSING-036 — My hosting (host dashboard)
- AC1. Route `/donations/housing/hosting`: my offers grouped by sub-category, each with pending requests (badge), upcoming confirmed bookings, active now, and past (90 days).
- AC2. One-tap approve / decline on each request with the guest's trust block (verification, completed housing bookings, seniority) and message.
- AC3. A combined calendar of all my offers for the next 60 days, with blackout editing.
- AC4. Shelter-pool membership status and active placements (assisted track).

## FR-HOUSING-037 — My stays (guest view)
- AC1. Route `/donations/housing/stays`: my bookings grouped pending → upcoming → active → history, each with status, range, host, and the actions allowed now (cancel, show address, I've left, emergency, rate).
- AC2. My housing requests with their proposals from hosts (FR-HOUSING-015 AC6).
- AC3. My shelter requests with their status (FR-HOUSING-031 AC3) — shown only to me.

## FR-HOUSING-038 — Cross-world links (`world_links`)
- AC1. **Ride to the host** (`ride_to_host`, existing link): from a confirmed stay, "find a ride" opens the rides search with destination = the stay's city and date = check-in; a host with `trail_pickup` is shown as "picks up from the trail".
- AC2. **Storage transport**: from a storage booking, "ask for transport" opens a rides request for item shipping with the drop-off city (FR-RIDE-044 pattern).
- AC3. **Volunteers for a placement**: a coordinator may open a time-world request linked to a placement (escort, moving help) without exposing the guest.
- AC4. **Event supplies**: an event booking may link to an items request (chairs, tables) — informational link only.

## FR-HOUSING-039 — Admin and moderation
- AC1. Admin portal "Housing": verification queue (FR-HOUSING-003 AC5), safety incidents and freezes, emergency calls with resolve action, shelter requests past SLA, organizations with housing coordination and their scopes, unclaimed-storage tasks.
- AC2. Funnel per sub-category in the world flow funnel (`admin_world_flow_funnel`, D106): published → requested → confirmed → completed, plus late cancellations and no-shows.
- AC3. Every admin action on housing data (viewing private details, lifting a freeze) is written to the admin audit log.

---

## Notifications catalog

| Key | Trigger | Recipient | Group |
|---|---|---|---|
| `housing_booking_requested` | booking `reserved` (guest request) | Host | important |
| `housing_booking_proposed` | booking `reserved` with `proposed_by='host'` | Guest | important |
| `housing_booking_confirmed` | `reserved → confirmed` | Guest (or host for a proposal) | important |
| `housing_booking_declined` | `reserved → cancelled(declined)` | Guest | important |
| `housing_booking_expired` | expiry sweep | Guest (+ alternatives) | important |
| `housing_booking_superseded` | guest confirmed elsewhere | Host | social |
| `housing_booking_cancelled` | cancellation by either side | The other side | important |
| `housing_stay_tomorrow` / `housing_stay_today` | start − 24 h / start | Guest and host | important |
| `housing_complete_prompt` | end | Host (and guest) | important |
| `housing_rate_prompt` | completion | Both | social |
| `housing_storage_end_soon` | end − 7 d / − 1 d | Both | important |
| `housing_emergency` | emergency call | Support, super-admins, coordinator | emergency |
| `housing_shelter_request_new` | shelter request submitted | In-scope coordinators | important |
| `housing_shelter_request_sla` | SLA missed | KC support | important |
| `housing_placement_proposed` | placement created | Pool host | important |
| `housing_checkin_due` | 72 h without coordinator check-in | Coordinator → org manager → support | important |
| `housing_match_found` | matching v2 pair | Both owners | social (cap 3/day) |

i18n keys live in the mobile `notifications` locale module and the `dispatch-notification` server mirror, as for rides.

## Permissions matrix

| Action | Guest (signed out) | Member | Verified member | Housing coordinator | Support / moderator | Super-admin |
|---|---|---|---|---|---|---|
| Browse community housing listings | Per guest mode (no private details) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Publish an offer or request (community) | ❌ | ❌ | ✅ + conduct | ✅ + conduct | ✅ | ✅ |
| Book / propose / approve | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |
| Join the shelter pool | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |
| Submit a shelter request (for oneself) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| See shelter requests / pool | ❌ | ❌ | ❌ | In scope only | ✅ | ✅ |
| Create a placement | ❌ | ❌ | ❌ | In scope only | ❌ | ✅ |
| See private details | ❌ | Confirmed guest in window | Confirmed guest in window | Own placements | Incident / emergency only | ✅ |
| Freeze / lift a housing freeze | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Grant housing coordination to an org | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

An **organization account** (acting through a member with an org role) has the rights of a verified member in every row above — publish, book, propose, approve, join the shelter pool — through the organization's own verification (FR-HOUSING-004 AC8, `D115`); it never submits a shelter request, and it coordinates placements only with housing coordination granted (FR-HOUSING-032 AC1).

## Server error codes (mirrored in `MARKETPLACE_SERVER_ERROR_CODES`)

`world_permission_denied`, `housing_conduct_required`, `housing_min_age`, `housing_dates_invalid`, `housing_dates_unavailable`, `housing_nights_out_of_range`, `housing_capacity_exceeded`, `housing_policy_mismatch`, `housing_minor_unaccompanied`, `housing_pending_cap`, `housing_booking_overlap`, `housing_event_rules_violation`, `housing_storage_banned_goods_ack_required`, `housing_storage_for_profit_forbidden`, `housing_inventory_required`, `housing_active_booking_conflict`, `housing_not_in_window`, `housing_emergency_throttled`, `housing_coordinator_required`, `housing_pool_out_of_scope`, `housing_frozen`, plus the shared `own_listing`, `listing_not_available`, `invalid_status`, `details_schema_mismatch`.

## Data contract (summary for the implementing PRs)

| Object | Change |
|---|---|
| `listing_kinds` | 6 new housing kinds; binding `detail_schema` per FR-HOUSING-005…010, 030, 031 |
| `categories` | 4 housing sub-categories; 6 legacy rows deactivated (§1 AC1) |
| `giving_handoffs` | `world_slug` check gains `housing`; many active rows per listing allowed (like rides / knowledge); new nullable columns `proposed_by` (`guest`·`host`), `placed_by_org_id`, `late_cancel`, `end_notice_at` |
| `housing_booking_details` (new) | `handoff_id PK`, `adults`, `minors`, `attendees`, `volume_m3`, `acks jsonb`, `inventory jsonb`, `agreement_snapshot jsonb`, `guest_off_platform`, `guest_alias` — RLS: the two sides, the placing coordinator, support |
| `housing_private_details` (new) | FR-HOUSING-012 AC2 |
| `housing_conduct_acceptances` (new) | FR-HOUSING-003 AC3 |
| `housing_emergency_events` (new) | FR-HOUSING-024 AC3 |
| `housing_freezes` (new) | `user_id`, `reason_report_id`, `frozen_at`, `lifted_at`, `lifted_by` |
| `organizations` | `housing_coordination_enabled boolean default false`; new `organization_housing_scopes (org_id, district)` |
| `app_flags` | existing `world_housing_enabled` (FR-HOUSING-001) |
| RPCs | `request_housing_booking`, `propose_housing_booking`, `decide_housing_booking`, `cancel_housing_booking`, `complete_housing_booking`, `mark_housing_no_show`, `record_storage_dropoff`, `trigger_housing_emergency`, `submit_shelter_request`, `take_shelter_request`, `create_housing_placement`, `record_placement_checkin`; sweeps `housing_bookings_expire_sweep`, `housing_bookings_close_uncompleted`, `housing_storage_end_sweep`, `housing_shelter_sla_sweep` |

Every new function follows the privilege rule of `SEC-1063` (private by default, explicit grants) and every table ships with RLS and a `supabase/tests/` probe.

## Edge cases

| Case | Handling |
|---|---|
| Guest asks three hosts for the same night and two approve within seconds | First confirmation wins: it withdraws the guest's other overlapping bookings in the same transaction (FR-HOUSING-015 AC3), so the second host's approve finds the booking no longer `reserved` and fails with `invalid_status`; that host is told the guest found another place. |
| Host edits capacity down below confirmed guests | Refused (`housing_active_booking_conflict`). |
| Host deletes the account with future bookings | Confirmed bookings cancel with `cancel_reason='host_deleted'`; guests get alternatives; an active stay alerts support. |
| Guest arrives, the place is unsafe | Emergency button (FR-HOUSING-024) + safety report (FR-HOUSING-025); support proposes alternatives. |
| Trail walker needs a bed tonight at 20:00 | Same-day booking allowed while the host's `check_in_until` has not passed; the request expires at check-in (FR-HOUSING-017 AC1). |
| Storage goods turn out to be banned (e.g. gas cylinder) | Host refuses at drop-off ("received as listed" not confirmed) → booking cancelled with `cancel_reason='banned_goods'`; report reason available. |
| Event exceeds attendees or hours | Host reports via FR-HOUSING-020 AC3; trust signal. |
| Placement host becomes unreachable | Coordinator check-in reminders → org manager → KC support (FR-HOUSING-032 AC5). |
| Blocked pair | FR-HOUSING-023 AC3. |
| Request to stay longer than 30 nights | Not possible in the community track (`D120`); the form explains why and points to the assisted track and the housing organizations directory. |

## Success metrics

| Metric | Target (steady state) |
|---|---|
| Completed housing bookings per month (all sub-categories) | ≥ 10 per 1,000 MAU |
| Request → confirmed | ≥ 35% |
| Median time from request to decision | ≤ 6 h |
| Late cancellations (either side) | ≤ 5% of confirmed |
| Safety incidents | < 0.5% of completed bookings, 100% reviewed within 24 h |
| Shelter requests acknowledged within SLA | ≥ 95% |
| Trail-walker stays (Israel National Trail season) | tracked, no target in v1 |

## Phasing

| Phase | Content | Depends on |
|---|---|---|
| **H0** | Identity verification (FR-VERIFY-001…011), pre-check (`TD-245`), code of conduct | Provider contract (FR-VERIFY-011), G13 |
| **H1** | Stays community track end to end: kinds + schema, availability, private details, booking lifecycle, capacity, cancellations, completion, ratings, karma, emergency button, safety freeze, my hosting / my stays, search + map, matching → turn `world_housing_enabled` on | H0 |
| **H2** | Event space and storage sub-categories (FR-HOUSING-007…010, 028, 029) | H1 |
| **H3** | Assisted track (FR-HOUSING-030…032) | H1, ORG-P1 (organization entity + roles) |
| **H4** | Emergency-mode evacuee hosting (FR-HOUSING-033) | H1, G25 (emergency mode) |

Open questions for the PM: none — Q-H1…Q-H7 were all decided by the PM on 2026-11-03 (decision rows above).

---

## Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-11-03 | New domain file. Housing becomes free space sharing with four sub-categories (stays, emergency shelter via organizations, event & gathering space, storage) — `D112`; FR-HOUSING-001…039; nine housing fills pending PM approval (`docs/spec/91`). |
| 0.2 | 2026-11-03 | PM answers: shelter only via organizations; storage for personal and nonprofit goods, never for-profit; organizations offer, request and search in every world; verification in every sub-category; verification = ID document + live selfie (`22_identity_verification.md`) replacing the interim manual path; legal texts drafted for counsel (`docs/legal/drafts/`). Minors rule aligned with D109. |
| 0.3 | 2026-11-03 | PM: community stays capped at 30 nights, longer needs through organizations (`D120`, closes Q-H4); counsel reviews the legal drafts once before launch and no phase waits for it (D118 refined). |
| 0.4 | 2026-11-03 | PM: an organization may confirm an evacuee guest without documents in a declared emergency (`D122`, closes Q-H6). H1.1 implemented (status header). |
| 0.5 | 2026-11-04 | H1.2–H1.3 (part) implemented: domain, use cases, adapter and the stay section of an offer (status header). |
