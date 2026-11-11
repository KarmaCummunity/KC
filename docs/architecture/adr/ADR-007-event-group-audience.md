# ADR-007 — Audience of an event ride group: fail-closed membership

- **Status:** Proposed (2026-11-11) · for gap `{{G:event-ride-groups}}` (decision `{{D:event-ride-groups}}`)
- **Related:** [`FR-EVRIDE-011`](../../spec/requirements/24_ride_event_groups.md), [ADR-006](./ADR-006-one-post-model.md), [ADR-002](./ADR-002-data-layer.md), [ADR-003](./ADR-003-realtime.md)

## Context

An event ride group (a wedding, a party) is a private room: its rides, date and place are readable by its members and, beyond them, only by the audience each ride's publisher chose within the organizer's ceiling. A group ride is an ordinary ride post (`posts` + `ride_post_details`, bookings on `post_handoffs`), so it inherits every reader written for rides: the main feed, `list_rides_feed`, `find_ride_listing_matches`, the map, search, matching v2, saved-route alerts, embeddings, the WhatsApp bot, statistics, the share page and the realtime new-post broadcast. Many of these are `SECURITY DEFINER` functions whose body, not RLS, decides what is returned (see `FR-RIDE-018` AC2). A rule that every reader must remember to add will be forgotten by the next reader.

Post visibility today is `Public | FollowersOnly | OnlyMe`, decided in `is_post_visible_to`.

## Decision

A ride's publisher chooses its audience (PM, 2026-11-11): **group only** (default), **group + my followers**, or **everyone**; the organizer sets a **ceiling** on the widest choice. Mapping onto the existing visibility:

| Audience | Stored `visibility` | Who sees it |
|---|---|---|
| group only | `OnlyMe` | owner + active group members (+ KC operators) |
| group + my followers | `FollowersOnly` | the above + followers of the owner |
| everyone | `Public` | everyone, like any ride |

1. **Group only is stored as `OnlyMe` with `posts.feed_hidden = true`.** Every existing reader already treats that as "not for anyone else", so a forgotten reader returns nothing — it fails closed. The wider audiences use the visibility those readers already understand, so they need no new rule.
2. **One clause in `is_post_visible_to`**: when the post's ride extension carries an `event_group_id`, an `active` member of that group sees it (group `active`/`ended`/`archived`) whatever its audience; every other viewer is decided by the stored visibility, unchanged. A CHECK ties `OnlyMe` to rides that carry a group, so `OnlyMe` on a group ride means "the group".
3. **The ceiling is enforced on write** (`audience_above_ceiling`) and re-applied when it is lowered, narrowing existing rides.
4. **A non-member never receives the group**: a followers/everyone ride is served as an ordinary ride (route, time, event place as an official place, an "event ride" chip); the group's name, notes and member data are returned only to members.
5. **Group-aware readers** (`list_ride_event_group_board`, the group match function) authorize through membership and never reuse the global matching or feed functions.
6. **A reader inventory test** lists every SQL function that selects ride posts and asserts, per function and per audience, who gets rows: for *group only*, a non-member, a banned or removed member and `anon` get none; for the wider audiences the ordinary rules hold; the ceiling is checked. A new reader missing from the list fails CI.
7. **Realtime**: a per-group topic authorized by membership at subscribe time (ADR-003); *group only* rides are never published on the public feed topic.
8. **Derived legacy rows**: while `listings` is still derived from posts (ADR-006), the derived listing carries the same flags so `listings_feed_mirror_sync` mirrors a group ride into the feed only for the wider audiences.

## Alternatives considered

- **A new visibility value `EventGroup`.** Clearer name, but every `check`, enumeration and TypeScript union that lists visibilities must learn it, and a reader that filters `visibility = 'Public'` is safe while one that filters `<> 'OnlyMe'` leaks. Rejected: fails open.
- **A separate `group_rides` table.** Safest isolation, but duplicates places, seats, bookings, caps, the emergency call, karma and completion — the opposite of one rides flow (D70). Rejected.
- **Per-reader `where event_group_id is null`.** Fails open when forgotten. Kept only as defence in depth inside readers that are known to bypass RLS.

## Consequences

- *Group only* rides are invisible to a function that forgets them; the cost is that **the member-side readers must be written deliberately** (steps 1, 5).
- `OnlyMe` on a group ride means "the group", not "only me": the owner UI shows the three audience names, never the raw visibility.
- Closed group rides stay as participants' own history after the group is purged; they keep the audience they had.
- The inventory test needs upkeep, and that is the point: it is the control that turns an architectural intent into a build failure.
