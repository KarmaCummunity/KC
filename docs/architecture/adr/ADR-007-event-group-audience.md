# ADR-007 — Audience of an event ride group: fail-closed membership

- **Status:** Proposed (2026-11-11) · for gap `{{G:event-ride-groups}}` (decision `{{D:event-ride-groups}}`)
- **Related:** [`FR-EVRIDE-011`](../../spec/requirements/24_ride_event_groups.md), [ADR-006](./ADR-006-one-post-model.md), [ADR-002](./ADR-002-data-layer.md), [ADR-003](./ADR-003-realtime.md)

## Context

An event ride group (a wedding, a party) is a private room: its rides, date and place must be readable by its members and by nobody else. A group ride is an ordinary ride post (`posts` + `ride_post_details`, bookings on `post_handoffs`), so it inherits every reader written for rides: the main feed, `list_rides_feed`, `find_ride_listing_matches`, the map, search, matching v2, saved-route alerts, embeddings, the WhatsApp bot, statistics, the share page and the realtime new-post broadcast. Many of these are `SECURITY DEFINER` functions whose body, not RLS, decides what is returned (see `FR-RIDE-018` AC2). A rule that every reader must remember to add will be forgotten by the next reader.

Post visibility today is `Public | FollowersOnly | OnlyMe`, decided in `is_post_visible_to`.

## Decision

1. **Store group rides as `OnlyMe` with `posts.feed_hidden = true`.** Every existing reader already treats that as "not for anyone else", so a forgotten reader returns nothing — it fails closed.
2. **Add one clause to `is_post_visible_to`**: when the post's ride extension carries an `event_group_id`, the viewer sees it only if they are its owner, an `active` member of that group while the group is `active`/`ended`/`archived`, or a KC operator. No other branch applies to a group ride (a group ride is never `Public` or `FollowersOnly`, enforced by a CHECK that ties `event_group_id` to `OnlyMe`).
3. **New group-aware readers are the only way in**: `list_ride_event_group_board`, the group match function and the member list authorize through membership. They never reuse the global matching or feed functions.
4. **A reader inventory test** lists every SQL function that selects ride posts and asserts, per function, that a non-member, a banned member, a removed member and `anon` get zero group rows. A new reader missing from the list fails CI.
5. **Realtime**: a per-group topic authorized by membership at subscribe time (ADR-003); group rides are never published on the public feed topic.
6. **Derived legacy rows**: while `listings` is still derived from posts (ADR-006), the derived listing carries the same flags so `listings_feed_mirror_sync` never mirrors a group ride into the feed.

## Alternatives considered

- **A new visibility value `EventGroup`.** Clearer name, but every `check`, enumeration and TypeScript union that lists visibilities must learn it, and a reader that filters `visibility = 'Public'` is safe while one that filters `<> 'OnlyMe'` leaks. Rejected: fails open.
- **A separate `group_rides` table.** Safest isolation, but duplicates places, seats, bookings, caps, the emergency call, karma and completion — the opposite of one rides flow (D70). Rejected.
- **Per-reader `where event_group_id is null`.** Fails open when forgotten. Kept only as defence in depth inside readers that are known to bypass RLS.

## Consequences

- Group rides are invisible to a function that forgets them; the cost is that **the member-side readers must be written deliberately** (steps 1, 3).
- `OnlyMe` on a group ride means "the group", not "only me": the owner UI never shows a visibility control for it, and the label is derived from the group.
- Closed group rides stay as participants' own history after the group is purged; they remain invisible to everyone else.
- The inventory test needs upkeep, and that is the point: it is the control that turns an architectural intent into a build failure.
