# ADR-006 — One Post model: `listings` → `posts`, `ride_post_details`, `post_handoffs`

- **Status:** Accepted (2026-11-03) · plan for gap `G1` (product decisions `D2`, `D19`, `D104`)
- **Decision log:** `D-214` in [`../../SSOT/DECISIONS.md`](../../SSOT/DECISIONS.md)
- **Related:** [`target.md` §1](../target.md), [`docs/spec/07`](../../spec/07_cross_cutting_systems.md) §7.1–7.5, [`docs/spec/93`](../../spec/93_implementation_gaps.md) G1 / G11 / G34, `D-206`, `D-207`, [ADR-002](./ADR-002-data-layer.md)

## Context

Everything published in KC is one `Post` (D2, D19): one primary giving world, direction, status, visibility, anonymity, location, expiry, source, likes and comments. Special types add an extension table; the handoff is the closing stage of every post, not a type.

The code runs two engines behind the single "+" form (`D-207`):

| | Items | Rides, food, housing, time |
|---|---|---|
| Source of truth | `posts` | `listings` (+ `details` JSON per `listing_kinds.detail_schema`) |
| Derived copy | `listings` row with `origin = 'post'` (`0243` sync) | mirror row in `posts` with `posts.listing_id` (`0466`, `0522`, `D-206`) |
| Detail screen | `/post/[id]` | `/listing/[listingId]`; the mirror redirects (`useListingMirrorRedirect`) |
| Closing | closure flow with recipient + karma (`close_post_with_recipient`) | `giving_handoffs` (reserve / confirm / hand over / rate), seat bookings for rides |
| Only here | likes, comments, drafts, closure + karma | booking, claim, handoffs, matching, ride series, owner management RPCs (`0543`) |

`ride_listings` is the retired V3 rides table (G44); live rides are `listings` of kind `ride_offer` / `ride_request`. Three state machines coexist (`posts.status`, `listings.status`, `giving_handoffs.status`).

## Decision

Make `posts` the single entity in six independently shippable, backward-compatible steps. Every step is its own PR into `dev` with its migration(s), SQL tests, spec update and BACKLOG row (`G1-S1` … `G1-S6`). Destructive SQL waits for the last step.

### Target schema

```
posts              + world_slug (primary giving world, FK worlds)      + direction ('offer' | 'request')
                   + post_type ('standard' | 'ride' | 'event' | 'housing_stay' | 'job')
                   + expires_at, source ('native' | 'imported'), details jsonb (type fields per world schema)
                   + category_id (world sub-category), geo, time_window, urgency_level,
                     external_body_id, beneficiary_org_id
                   status gains 'paused' (D104); the S1 machine is enforced in DB + domain
ride_post_details  1:1 extension of a post of post_type 'ride' (route ends, meeting points, departure,
                   estimated end, seats / passengers, cost model, series marker)
post_handoffs      closing stage of every post (recipient, pickup / slot window, seats, status timestamps)
event_post_details 1:1 (G18, step 5) · housing_post_details, nonprofit_job_post_details later (G21, G28)
```

The legacy columns `posts.type` ('Give' | 'Request') and `posts.category` stay until the last step; `direction` and `world_slug` are derived from them (and back) by a trigger so no existing writer breaks.

### Steps

1. **Additive schema (`0551`–`0553`).** Add the columns above to `posts`; backfill from `listings` for mirror rows and from the legacy columns for native posts; derive defaults in a `before insert or update` trigger; extend the mirror upsert so every listing write keeps the new columns current. Create `ride_post_details` (filled from the ride listings' `details`) and `post_handoffs` (filled from `giving_handoffs`), both with RLS equal to or stricter than today (read through `is_post_visible_to` / participants only; no client DML), kept in sync by triggers on the listing tables. A `service_role`-only report function returns row counts and mismatches between the two sides; the SQL tests assert zero mismatches on a seeded database. No app change beyond the regenerated types and the `paused` status in `@kc/domain`.
2. **Posts become the source of truth (`0554`–`0557`).** `create_post` / the create form writes `posts` (+ `ride_post_details`) for every category; a posts → listings sync generalises `0243` to every world so matching, handoffs and the marketplace screens keep reading `listings` unchanged. The `0466` mirror direction is switched off for rows that posts already own. Edit, pause / resume / mark delivered / delete / add media (`D104`) become post RPCs for every type; the listing RPCs delegate to them.
3. **Type-specific flows on posts (`0558`–`0562`).** Reserve / claim / book, `post_handoffs` writes, ratings, matching inputs, ride series, notifications and karma (`G34`: one closing system, item bonus), the admin funnel and reports, deep links and share URLs read and write posts. `giving_handoffs` becomes a compatibility view.
4. **One detail screen.** `/post/[id]` renders every type: shared hero + content frame (`D-212`), type sections, type actions, likes and comments for all. `/listing/*` redirects to the post; `useListingMirrorRedirect` is removed.
5. **Events as an extension (`0563`).** `event_post_details` (capacity, registration policy, D31) in the same create form; the organizer create screen is retired, the organizer management screens stay until they read posts.
6. **Cleanup (`0564`+).** Single S1 state machine in DB and domain, drop the sync triggers, retire the marketplace browse leftovers and `LegacyRideRedirect`, then drop `listings`, `ride_listings`, `giving_handoffs` and friends — only after the report function shows identical data and no code path reads them (`migration-safety: allow` with the PR justification).

### Rules

- Every migration is additive and idempotent until step 6; the app of the previous step keeps working against the schema of the next.
- Each step ships code + spec section + automated test (SQL tests on the harness, contract tests for changed ports, Maestro for UI flows); a bug fix carries a regression test.
- Verification is a query, not a belief: counts and key fields of both sides must match before any write path moves and again before anything is dropped.
- New registry IDs are merge-time placeholders of the `G`, `TD` and `ENG` registries (`AGENTS.md` §4), never numbers picked in a PR.

## Rationale

Reversing the mirror (posts own, listings derive) instead of rewriting the feed to a union keeps the feed, cards, chat anchors and profile reading `posts` as they do today, and lets each type-specific flow move on its own PR while `listings` still serves the ones that have not moved. The alternative — big-bang rename of `listings` to `posts` — would stop the app for the duration and cannot be verified step by step.

## Consequences

- During steps 2–5 two tables hold the same data on purpose; the report function and its test are the guard.
- Rides keep their `details` JSON in `listings` until step 3 while `ride_post_details` already exists, so the ride flows can switch one RPC at a time.
- `posts.status` gains `paused`; readers that enumerate statuses (feed MV, visibility predicate, domain `PostStatus`) treat it as owner-only.
