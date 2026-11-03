# 07 — Cross-cutting systems

Each section ends with a **Tech** line: decisions · legacy spec superseded/kept · code today · gap.

## 7.1 Post, statuses, expiry
Everything published in KC is one `Post` (D2, D16, D19): one primary giving world plus optional additional worlds (D100, D101), direction (offer/request), status, visibility, anonymity, location, likes & comments. Special types add an extension — ride, event (D31), housing stay (D30), job (D41). **Handoff is the closing stage, not a type** (D19). An imported WhatsApp post is a normal Post with source `imported` until claimed (S21).

Statuses: `open`, `closed_delivered`, `deleted_no_recipient`, `expired`, `removed_admin`, `hidden_pending_review` (D33).
- **State machine (S1):** `open → (hidden_pending_review ↔ open) → closed_delivered | expired | deleted_no_recipient | removed_admin`; reopen from `closed_delivered` and `expired`, by owner only.
- **Permissions (S2):** edit/delete — owner and super-admin; hide — KC admin; a suspended user cannot create, edit or comment.
- **Expiry by type (D21):** food offer — at expiry date (alert 24h before and at expiry; close at midnight of expiry date, S4); ride offer — 30 min after estimated end; event & ticket — at their date; items and all requests — no expiry; the owner gets relevance reminders instead (D59).
- **Relevance reminder (S3):** 14 days after publish, then every 30 days: "Still relevant?" → bump / close. Bump updates sort time, not `created_at`.
- **Owner management (D104, PM 2026-11-03):** what the owner may do with their own post, by status, enforced on the server:
  - **open** — edit, pause, mark delivered, delete, add photos.
  - **paused** — hidden from everyone but the owner: feeds, world screens, search, map, profile and a shared link. The owner may edit, resume (not after the post's own expiry), delete and add photos.
  - **closed (delivered)** — the hard fields are locked (title, description, details, city, radius, urgency, direction, world). The owner may only **add** photos, up to 10 in all (for example a handoff or thank-you photo); existing photos are never replaced or removed. Video ("reels") joins when post media supports video (G53).
  - **An active reservation or booking** (reserved or confirmed handoff) blocks pause, mark delivered and delete: the handoff is finished or cancelled first, so a taker is never left stranded and karma is never granted twice.
  - **A delivered post with a completed handoff cannot be deleted**: it is the other side's record too (their rating and karma), as FR-POST-010 already rules for posts with a recipient.
  - A refusal tells the owner why (wrong status, active handoff, handoff history, expired, photo limit).

Tech: D2,D16,D19,D21,D30,D31,D33,D41 · FR-POST-012/013, R-Items-5 superseded by D21 · `posts` + `listings` with triggers; `ride_listings`; `giving_handoffs`; owner management on listings: `pause / resume / fulfill / delete / add_my_listing_media` RPCs (`0543`, test `supabase/tests/0543_listing_owner_lifecycle.sql`) · G1, G11 · unification plan: `docs/architecture/adr/ADR-006-one-post-model.md` (BACKLOG `G1-S1`…`G1-S6`) · step 1 ✅: `posts.world_slug / direction / post_type / expires_at / source / details / category_id / geo` + `paused` (`0550`), `ride_post_details` (`0551`), `post_handoffs` + `post_unification_report()` (`0552`)

## 7.2 Form and procedure per post type
One form creates a Post: giving world first, then the world's sub-category where it has one, then optional additional worlds (D101); no "general", there is "other"; offer/request toggle worded per world, then a type-specific form defined in world config (D6*, D28, D36). Anonymity chosen in the form (D16); affiliated volunteer posts on the org's behalf (D22); emergency templates appear during emergencies (D42). No form in money (D4). Common rules: title ≤ 80 chars, description ≤ 500, ≤ 5 images with EXIF stripped, local draft. Location: offer = address at chosen display level, request = city; max 20 open posts per private user, none for orgs (S34).

| Post type | Photo | Location | Expiry | Unique fields |
|---|---|---|---|---|
| Food offer | required (D28) | address | expiry date | type, allergens, quantity |
| Food request | no | city | none | quantity, urgency |
| Item offer | recommended (S19) | address | none | item subcategory, condition |
| Item request | no | city | none | item subcategory, urgency |
| Ride | no (D28) | origin, destination, ≤ 3 meeting points — official places only (D71) | offer: +30 min | departure, est. end, seats |
| Time / elderly / consulting | no | city or "remote" | none | estimated duration (D32) |
| Event (org) | no | address | date | capacity, registration policy (D31) |
| Housing stay | no | city + neighborhood; exact after approval | stay dates | place type, capacity, nights, house rules (D30) |
| Event & gathering space | no | city + neighborhood; exact after approval | event date | capacity, hours, quiet hour, event types (`S55`) |
| Storage space | no | city + neighborhood; exact after approval | end of availability / request start + 7 d | m³, period, access, goods accepted (`S56`) |
| Shelter request (assisted) | no | district / city | closed by the organization | urgency, people, needs — never public (`S57`) |
| Job (org) | no | city or remote | closing date | scope, field, link (D41) |
| Experience | no | venue | date | type, date, seats (D45) |

Tech: · FR-POST-002–007, 011, 020 · unified form #1227; since 2026-11-01 (FR-POST-001 AC6) five categories — items (post engine), rides, food, housing, time — with the last choice remembered, request / offer under the picker and curated per-type fields; no "general" chip; money / knowledge / medical / animals / environment have no form yet · G14

## 7.3 Feed, sorting, recommendations
Main feed of all worlds plus a feed per world (D5, D36). Default sort = **Recommended** — KC's recommendation engine, aiming to be as smart as Facebook/Instagram (D27). Phase 1 weights (S33): distance, freshness, worlds the user is active in, urgency and near expiry, reliability (never shown), posts with no response yet; region weight during emergency. The user always controls: sort (recommended/new/old/near) and filters (world, world sub-category, direction, people/orgs, city+radius, status). Inside a chosen sort the engine may boost ≤ 1 of every 5 items, labeled "Recommended" (S5). Sort choice persists per session; a new session returns to Recommended (S7). A **Friends / Everyone** toggle hides on scroll down and returns on scroll up, TikTok-style (D34); "Friends" = people I follow, default Everyone (S6). Emergency items go on top with a banner (D42). Hidden-for-review posts don't appear (D33). Notify only on good match or saved filter (D10).

Tech: · FR-FEED-001 "no algorithm" superseded; MATCHING_V2 score ≥ 0.60 kept · `PostFilterSheet`; matching on `listings` · G15 · world hubs (items/food): item subcategory + distance-from-home filters on `browse_listings` (`0469`, KC#1102/#1111) · native listings of every create category (items, rides, food, housing, time) reach the feed as mirror posts (`posts.listing_id`, `0466`; rides / housing / time and the card's world chip via `posts.listing_world_slug`, `0522`, FR-FEED-020 AC1; D-206 — a step toward G1)

## 7.4 Card and detail screen
Uniform card and detail for all types (D2, D6*): image or world icon, world/direction/status chips, title, description, location & time, publisher per anonymity (D16) with verification level (D23) and **no rating** (D24), likes & comments (D25), fixed action button and report (D33). Closing button per type (D11, D17); event → register (D31); job → apply (D41); imported post → "Is this yours? Claim it" (S21). Color/icon from world config (D36). **Domain not shown on the card** — at most a tiny corner icon (D45). Needs further design depth (D6*).

Tech: · FR-FEED-002, FR-POST-014–018 · `KcRowCard` · design pending

## 7.5 Closing and handoff
Each post type has its own closing flow on a generic handoff stage (D17, D19): "mark delivered", "ride completed", "stay completed", "event completed", "goods returned" (storage), "volunteering done", "I attended". Closing earns karma (D12, D29), opens a two-sided internal rating (D15), and for volunteering follows 7.10 (D32). Auto-close on expiry (D21). Reopening reverses the karma (S20). Intermediate stages later.

Tech: · FR-CLOSURE-001–010, FR-RIDE-031–034 · three separate state machines today · G1

## 7.6 Karma
All engagement earns; closed giving earns most (D12). Visible only to the owner; the main admin sees all (D29). All values in **one global config `KARMA_POINT_VALUES`**, tuned later by research/KPIs. All values are estimates except "existing" (S20); undo/removal reverses points; daily caps. Emergency: +50% on giving in the declared world & region (S28).

| Action | Points | Cap |
|---|---|---|
| Sign up (existing) | 1 | once |
| Publish post (existing) / claim imported post | 5 | 5/day |
| New follower (existing) | 1 | – |
| First contact on a post (existing) | 1 | 10/day |
| Like given / received | 1 | 20 / 50 per day |
| Comment / reply | 2 / 1 | 10/day |
| Active time in app | 1 per 10 min | 6/day |
| Item closed (existing) | giver 20 + up to 20 bonus; receiver 15 | – |
| Food closed | giver 20; receiver 10 | – |
| Ride completed | driver 25; passenger 10 | – |
| Volunteering incl. elderly & consulting (D32) | 10 / hour | 80/day |
| Hosting | host 30 / night; guest 10 | 7 nights |
| Event space lent (`S58`) | host 15; guest 5 | host 2/day |
| Storage lent (`S58`) | host 5 per started week; guest 3 | host 40 per booking |
| Event attendance | 10 | – |
| Open a challenge (D52): private / community | 2 / 3 | 2/day |
| Challenge report (per cadence): private / community / large community (50+) | 1 / 2 / 3 | one per cycle |
| Challenge completion: private / community / large | 10 / 15 / 20 | – |
| Giving challenge | as above + the closings' own points | – |
| Vote in community poll (D40) | 1 | – |
| Donation to KC / standing order | 1 per ₪10 / 10 per month | 100 per donation |
| Rating given | 2 | – |
| Post removed by admin (existing) | −5 | – |

Tech: D12,D29,D32,D43,D52 · `14_karma`, migration 0099, FR-KARMA-007/008 · `karma_ledger`, hard-coded values · G16 · "Rating given" 2 for handoff and ride ratings, once per rating (`0510`, KC#1306)

## 7.7 Ratings
After each handoff both sides rate 1–5 with a note — one generic rating for all types (D15, D19). **Users never see ratings, not even their own**; only KC admins (D24). Ratings feed the trust engine.
Tech: · FR-RIDE-037 kept; FR-RIDE-038 superseded · `ride_ratings`, `giving_handoff_ratings` currently readable via RLS · G4 · items/food/rides/knowledge handoffs: rating step = pick 1–5 stars, optional note (≤300 chars), submit (`HandoffRatingForm`, KC#1106/#1114); "Rating given" karma (7.6) tracked in KC#1306

## 7.8 Chat
One conversation per pair; contacting from a post pins it (D13). Closing from chat (D17). Group chat only around a project/challenge/event, locked at the end. Suspended users can still talk to support (D33).
Tech: · FR-CHAT-004–016 · implemented · –

## 7.9 Likes and comments
On every post type: like & comment, and like & reply on comments (D25), one thread level (S8). Comment on an anonymous post shows the commenter's name; anonymous poster replies as "the poster" (S8). Delete: author, post owner, admin; 3 reports hide a comment (S9). Earn karma, create notifications, reportable.
Tech: · `06_feed` "not in MVP" superseded · `PostEngagementSection`, migration 0250 · G12

## 7.10 Volunteering and hours
Every registered user may offer volunteering (D22); karma is automatic (D32). Org-affiliated volunteers log hours approved by their manager; unaffiliated volunteers don't log hours — the duration declared by the poster counts at closing, up to 8 hours per post (S14). Applies to time, elderly, consulting, sport coaching, tech volunteers.
Tech: · R-Time-1 superseded · none · G19

## 7.11 Notifications
Rich model like Instagram/Facebook/WhatsApp (D26): notification center grouped by time and unread (D7), smart grouping ("X and 3 others liked"), badge, per-type and per-channel preferences, mute chat/post, groups `important` and `social` (S10: push for important, in-app only for social; group per post per hour), quiet hours (default 22:00–08:00), max 3/day for matches & recommendations. A third group `emergency` bypasses quiet hours only in the declared region and only if not disabled (D42, S28). Rides are time-critical: booking changes are `important` (D73), and saved-route alerts follow their own urgency rule and daily cap (D74, D95).
Types: match & saved filter (D10), ride booking & saved route (D73, D74), expiry & relevance (D21), like & comment (D25), event (D31), hours (D32), report & suspension (D33), emergency (D42), challenge (D43), community poll (D40), imported post awaiting claim (S21).
Tech: · `09_notifications`, MATCHING_V2, PRD_V2 merged · `inbox.tsx` · per-type opt-out `kinds` (FR-NOTIF-017, `0460`; first type: match suggestions) · G17

## 7.12 Profile
Avatar, name, city, bio, counters; posts in "Open" / "Closed" tabs (D2, D14) — no "marketplace listings" tab. Verification level and reliability data shown (D23); rating not (D24). Karma, active challenges and volunteering log — owner only (D29). Exportable volunteer CV later. **Organization profile**: same shape adapted to organizations (logo, cover, type, fields, links, badges, team opt-in, activity, impact, transparency), always public, reached at `/org/{slug}` (D88–D92).
- **Date of birth (D109, PM 2026-11-03):** required at sign-up (a first-run skip is allowed, but the soft gate blocks the first meaningful action until it is filled), minimum age **18**, confirms the sign-up age checkbox on the server. Private: never shown to anyone else, only the owner reads it.
- **Optional profile fields (D109):** interests (multi-select), organization affiliation (self-declared, one of the verified organizations; a label only, distinct from the roles of D88), and "what I can help with" (giving-world tags).
- **Per-field visibility (D110):** the owner chooses for each optional field who sees it: everyone, approved followers, or only me. Defaults: everyone on a public profile, approved followers on a private profile. A public profile can hide any field; a private profile reveals fields only to approved followers (and never beyond what the owner chose). Enforced on the server, not only in the client.
- **Account deletion and restore (D108, PM 2026-11-03):** deleting an account **deactivates** it for 30 days: the profile, posts, listings and chats are hidden from everyone, push stops, follows and blocks are kept. Signing in again within the 30 days offers a full restore. After 30 days a purge job deletes the account and all its data, media included. There is no re-registration cooldown (it replaces the old FR-AUTH-016 rule).
Tech: · FR-PROFILE-001–006, FR-PROFILE-007 · FR-SETTINGS-012, FR-AUTH-016 · FR-ORG-003 (`20_organizations`) · `ProfileMarketplaceListings` adds a "marketplace" tab · G6

## 7.13 Anonymity, privacy, location
Visibility `Public / FollowersOnly / OnlyMe` and counterpart masking, chosen in the form and changeable **both ways** (D16). The counterpart in a handoff sees the real name. Location: `CityOnly / CityAndStreet` (default) `/ FullAddress`; profile shows city only; housing exact only after approval (D30) — public = city + neighborhood and a fuzzed map circle, the exact address and access instructions open to the confirmed guest from approval until 24 h after the end (`S53`). EXIF stripped. WhatsApp import keeps no identity of non-members (S21). No commercial use of community data.
Tech: · PRD_V2 rule 7 superseded · both ways on `posts` (0094) and `listings` (0451) · G3 ✅

## 7.14 Verification and trust engine
Levels phone → ID → blue check, plus reliability data (completed handoffs, seniority), shown on post, card and profile (D23). **Not blocking**, including drivers. Exceptions: housing — both sides verified; medical — only medical bodies (D30); elderly home visit — ID-verified volunteer (D48); an event may require verified users (D31). The trust engine weighs ratings and reports in ranking/matching and reports anomalies to admins (D24). ID provider chosen at implementation.
- **ID level (`D117`, PM 2026-11-03):** a government ID document (Israeli identity card or a passport) **and** a live selfie with liveness, matched to the document photo by a certified provider. KC keeps the result, document type, country, expiry and date of birth, never the images or the document number (a keyed hash stops one person from verifying two accounts). Detailed FRs: [`SSOT/spec/22_identity_verification.md`](../SSOT/spec/22_identity_verification.md) (`FR-VERIFY-*`).

Tech: · PRD_V2 rule 13 superseded · phone only; ID level specified (FR-VERIFY), provider not chosen · G10, G13

## 7.15 Reports and moderation
Anyone can report a post, comment or user. **3 reports on a post → hidden until human review, and admins are notified; 5 on a user → suspended from actions, still sees everything and can chat with support** (D33, D61). "5" = 5 distinct reporters within 30 days; suspended user's open posts are hidden (S11). Review within 48h; malicious reports count against the reporter (S12). False emergency reports are handled with priority (D42).
- **Blocking (D105, PM 2026-11-03):** a member can block another from a profile, a post or a chat, and unblock from a Blocked Users list. Once either has blocked the other, the two never see or reach each other, in both directions: posts, listings, profiles, search, follower lists, chats and messages, comments and likes, claims and bookings, the closure recipient, notifications. The blocked member is never told. Part of the first store release (Apple App Review requires it).

Tech: · `spec/08`, R-Food superseded · `reports`, suspects queue · G20 · posts `0452`, items/food listings `0468` (KC#1298) · blocking: bilateral `is_blocked` at the data layer (`0544`), legacy FR-MOD-003/004/009
