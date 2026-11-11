# ADR-007 — Audience of an event ride group: fail-closed membership

- **Status:** Proposed (2026-11-11, revised after code review) · for gap `G62` (decision `D144`)
- **Related:** [`FR-EVRIDE-011`](../../spec/requirements/24_ride_event_groups.md), [ADR-006](./ADR-006-one-post-model.md), [ADR-002](./ADR-002-data-layer.md), [ADR-003](./ADR-003-realtime.md)

## Context

An event ride group (a wedding, a party) is a private room: its rides, date and place are readable by its members and, beyond them, only by the audience each ride's publisher chose within the organizer's ceiling (`group_only`, `group_and_followers`, `everyone`). A group ride is an ordinary ride post (`posts` + `ride_post_details`, bookings on `post_handoffs`), so it inherits every reader written for rides. Reading the code showed that:

- visibility is decided by **three** predicates, not one: `is_post_visible_to`, `post_listing_visible_to` and `is_listing_visible_to` (the last two feed the ride page, the rides feed, the map, browse, search and matching);
- `OnlyMe` already means "operators only" (anonymity level 1): an `OnlyMe` post opens an operator case, and the anonymity level is derived from the visibility;
- the `closed_delivered` branch of the predicates admits viewers by the participants' profile surface, ignoring the stored visibility;
- several `SECURITY DEFINER` readers and background paths decide for themselves what is returned (feeds, search, matching, alerts, embeddings, the bot), and the visibility writers (`rpc_ride_update_visibility`, the writable `ride_listings` view, "share to feed") do not know about groups;
- since step 3 of ADR-006 there is **no derived `listings` row and no feed-mirror trigger**: `listings` and `ride_listings` are views over `posts`, so the feed exclusion is `posts.feed_hidden`.

A rule that every reader must remember to add will be forgotten by the next reader.

## Decision

1. **Explicit columns, not overloaded meaning.** `ride_post_details` carries `event_group_id`, `event_leg`, `audience` and `name_display`. Anonymity inside a group is its own control (`name_display`), not derived from visibility. Only the group RPCs write these columns; the client `details` JSON is never trusted for them.
2. **The audience is also stored as the post's visibility**, as the fail-closed layer: `group_only` → `OnlyMe` (+ `feed_hidden = true`), `group_and_followers` → `FollowersOnly`, `everyone` → `Public`. Readers that already understand visibility therefore return nothing for a `group_only` ride. The triggers that treat `OnlyMe` as personal (operator-case queue, anonymity derivation, public counters) **skip group rides**.
3. **One member clause in all three predicates**, gated on rides that carry a group, placed ahead of the `closed_delivered` branch: an `active` member of the group (group `active`, `ended`, `archived` or `cancelling`) sees the ride; everyone else is decided by the stored visibility. A `closed_delivered` group ride is never widened by the participants' surface rule. There is no operator clause in the predicates: operators use audited admin tools.
4. **Structural exclusion in general readers.** Every general reader adds `event_group_id is null or audience <> 'group_only'` (served by a partial index) so that a member of the group does not meet group rides in the main feed, search, the rides feed, the map, matching, alerts or the bot just because the predicate now admits them. Members reach lists only through the group readers.
5. **Background paths are readers too:** saved-route alerts, subscription alerts, the embedding queue and matching delivery check the audience (and re-check it at delivery). Group rides are never embedded or sent to a third party.
6. **Writers cannot widen.** The audience changes only through a group RPC that enforces the ceiling in both directions; `rpc_ride_update_visibility`, the view update guard, "share to feed" and the generic edit refuse group rides. `FollowersOnly` is allowed by the group RPC although the generic path restricts it to private profiles.
7. **Group-aware readers** (`list_ride_event_group_board`, the counters, the group match function) authorize membership **once at the top** and filter by `event_group_id` with the partial board index; they load the viewer's block list once instead of calling `is_blocked` per row. They never reuse the global matching or feed functions.
8. **A reader inventory test** lists every SQL function and policy that selects posts or listings and asserts, per audience and per viewer kind (non-member, banned, removed, `anon`, follower, operator), who gets rows. A new reader missing from the list fails CI.
9. **Realtime** uses a private DB-sent Broadcast topic per group, authorized by an active-membership policy, carrying a coalesced ping (revision and counters only, ≤ 1 per 5 s). Removal sends a `kicked` event to the person's own channel because a live socket is re-authorized only on token refresh.
10. **Booking guards inside the existing RPCs:** the leg rule uses an advisory lock `(group, person, leg)` (a post row lock cannot order two drivers confirming one passenger) and applies to `reinstate_ride_booking` too; new cancel reasons extend the existing constraint.

## Alternatives considered

- **A new visibility value `EventGroup`.** Clear name, but every check, enumeration and TypeScript union learns it, and a reader that filters `<> 'OnlyMe'` leaks. Rejected: fails open.
- **A separate `group_rides` table.** Safest isolation, but duplicates places, seats, bookings, caps, the emergency call, karma and completion: the opposite of one rides flow (D70). Rejected.
- **Only per-reader `where event_group_id is null`.** Fails open when forgotten. Kept as the structural layer of decision 4, never alone.
- **Reuse `OnlyMe` with its current meaning and derive anonymity from it.** Rejected: the operator queue, the anonymity derivation and the counters assume personal content.

## Consequences

- The design costs one migration pass over three predicates, the general readers and the background paths, and a test that must be kept current — that test is the control that turns an intent into a build failure.
- The owner UI shows the three audience names and the name display, never the raw visibility.
- Closed group rides remain the participants' own history and keep matrix rows 1–3 and 7 of the spec.
- Performance: the member clause is gated and placed after the cheap branches; the board never evaluates it per row.
