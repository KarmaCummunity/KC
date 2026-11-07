# Unified owner close / assign with a specific user

**Date:** 2026-11-07  
**Status:** Implemented 2026-11-07 (FR-CLOSURE-011, migration `0658`)

**Defaults chosen while implementing** (the open questions at the bottom):
1. Housing assigns **one** guest. The listing stays open.
2. A new ride assign is **confirmed** immediately. The trip is marked ridden only after departure (`ride_not_started` leaves the seat confirmed).
3. Animals adoption and foster offers **may** close with nobody named.  
**Maps to:** FR-CLOSURE-001…003 (extension), FR-CLOSURE-010 (listing-world post detail), D17/D19, G34, D125 (animals), FR-HOUSING-015/016/036, rides D73, D104  

## Problem

Offer owners need one familiar way to **name who received the give** when closing — the same mental model as marking an item delivered to a specific person. Today:

- **Social posts** (no `listing_id`) use `ClosureSheet`: chat partners + **search any user** (`ClosureStep2`, FR-CLOSURE-003 extension).
- **Listing-world posts** (`ListingPostDetail`) show world actions (reserve, bookings, stays) but **no** closure bar; `fulfill_my_listing` closes **without** a recipient.
- **Animals** offers have no generic handoff section on the detail screen (`HANDOFF_WORLDS` = items, food, knowledge only).
- **Rides / housing** only complete through an existing booking row; the owner cannot **assign** someone who never requested.

Product ask (PM, Hebrew): every **offer** closure path must allow picking a **specific user**, like item delivery — including animal handover and housing offers.

## Goals

1. **One recipient-picker UX** everywhere the owner closes an open offer (reuse `ClosureStep2` modes: chats + search).
2. **Listing post detail** (G1 step 4a): owner CTA to close with/without recipient, same steps as `OwnerActionsBar`.
3. **My listings**: replace bare `fulfill_my_listing` with the same closure flow when no incompatible handoff exists.
4. **Animals**: generic handoff on offers (reserve → confirm → hand over) **or** owner-initiated assign when no prior request (see RPC below).
5. **Owner-initiated assign** (no prior request): driver/host/item/animal owner can select a user and create a completed handoff + post closure in one guarded RPC (blocked pairs, visibility, verification rules per world).

## Non-goals (v1 of this spec)

- Changing **request** listings’ closure semantics (recipient is the offer side).
- Employment job “hire” flow (chat-only v1).
- Bulk assign multiple users on one ride in a single action (still one handoff row per person).
- Replacing ride/housing **approval queues** — assign complements them; existing rows keep approve/decline.

## UX — entry points

| Entry | Who | Action label (HE) | Flow |
|-------|-----|-------------------|------|
| Listing post detail | Owner, open offer | «סומן כנמסר» / world-specific variant | `ClosureSheet` steps 1→2→3 (reuse) |
| My listings row | Owner | Replace «סמן כהושלם» | Same sheet; `postId` from `listing.feedPostId` |
| World owner panel | Owner, no active row for chosen user | «שבץ למשתמש» | Opens sheet on step 2 only (skip step 1 optional) |
| Chat anchored card | Owner | Existing FR-CHAT-015 | Unchanged; same sheet |

**Listing post detail wiring:** render `OwnerActionsBar` (or thin wrapper `ListingOwnerClosureBar`) when `post.listingId` is set, `post.status === 'open'`, `post.type === 'Give'` (offer). Respect `moderationInHeader` / scroll insets like `ListingPostDetail` today.

**Copy variants:** animals → «סומן כמסור»; housing → «סיום האירוח»; rides → prefer completing **one** booking; generic give → «סומן כנמסר» (`closure.markGiveCta`).

## Recipient picker (reuse)

No new picker UI. Requirements:

- AC1: Same two modes as `ClosureStep2` (chats / search).
- AC2: Search uses `SearchUsersForClosureUseCase` (block filter, active members).
- AC3: Primary requires selection; secondary «סגור בלי לסמן» remains for worlds that support `deleted_no_recipient` (items-style posts). Worlds that **must** record a counterparty for karma (TBD: animals adoption) may disable “close without marking” — product call per kind.

## Server — unified assign + close

Introduce **`owner_complete_offer_with_user(p_target uuid, p_recipient_id uuid, p_mode text)`** where `p_target` is post id or listing id (`handoff_target_post_id` pattern).

** Preconditions (all worlds):**

- `auth.uid()` = post/listing owner; post `open`; offer direction; not departed/expired per world rules.
- `p_recipient_id` ≠ owner; not blocked; recipient can see listing (`is_listing_visible_to`).
- World permission / verification (animals, housing host rules) enforced via existing `has_world_permission` / housing eligibility helpers.

**Behaviour branches:**

| World | No existing handoff | Active `reserved`/`confirmed` handoff |
|-------|---------------------|----------------------------------------|
| items, food | Insert handoff → `confirmed` → `handed_over` → `post_close_from_handoff` (items) or listing close + karma per G34/D63 | If `recipient_id` = `p_recipient_id`, complete that row; else reject or cancel others per 0559 settle rules |
| animals | Same as items once animals ∈ handoff worlds | Same |
| knowledge | Book slot flow unchanged; assign only if product allows single-slot offers | — |
| rides | `invite_ride_passenger` + auto-confirm OR `reinstate_ride_booking` when applicable | Complete selected booking |
| housing | Create booking confirmed + complete stay RPC | Complete selected booking |

**Close without recipient:**

- Call existing `close_post_deleted_no_recipient` / equivalent only when **no** active handoff and world policy allows (items/animals generic give).

**Deprecate silent fulfill:** `fulfill_my_listing` without recipient should redirect client to closure sheet; server may keep RPC for backward compatibility but mobile stops calling it for offers.

## Animals (D125)

1. Add `animals` to `HANDOFF_WORLDS` for **give** listings where kind ∈ {adoption_offer, foster_offer, boarding_offer, …} (exact kind list from `listing_kinds`).
2. Handoff RPCs: reuse `reserve_item_giving` pattern or thin `reserve_animals_giving` if species-specific fields need validation later (v1: reuse items RPCs with world_slug check widened).
3. Detail screen: show `GivingHandoffActions` for animals offers.

## Karma and post status

- **Items:** continue G34 — single pay via post closure / `post_close_from_handoff`.
- **Food, rides, housing, animals (multi-handoff worlds):** keep per-handoff karma from D63; post `closed_delivered` when the **last** required handoff completes or when owner closes with assign (document per kind).
- **Recipient row:** `recipients` + stats for any path that marks a named user on a post-engine item; listing mirror posts sync from listing/post triggers (existing 0243/0554).

## Security

- D105 bilateral block on picker results and RPC.
- Rate limits: same family as handoff writers (0534).
- Audit: log `owner_complete_offer_with_user` with post_id, recipient_id, world_slug.

## Implementation phases

### Phase A — Spec + FR updates (this doc → `05_closure_and_reopen.md` + world appendices)

### Phase B — Mobile shell (no new RPC)

- `ListingPostDetail`: owner closure bar + `ClosureSheet` bound to `post.postId`.
- My listings: fulfill button opens closure store with post id.

### Phase C — RPC `owner_complete_offer_with_user` + animals handoff world flag

- Migration + SQL tests per world (items, animals, ride invite, housing).
- Wire owner panel «שבץ למשתמש» to RPC.

### Phase D — Edge cases

- Active handoff conflicts, concurrent assign, listing pause (D104).

## Test plan (high level)

- SQL: owner assign on animals offer closes post with recipient; blocked user rejected.
- SQL: assign on ride creates confirmed booking; seat cap enforced.
- Mobile: `ListingPostDetail` owner sees closure CTA; search tab selects user.
- E2E: publish animals offer → owner search assign → post closed_delivered.

## Open product decisions

1. **Housing:** one guest per close vs whole listing close when multiple confirmed bookings?
2. **Rides:** assign always `confirmed`, or `reserved` requiring passenger accept?
3. **Animals adoption kinds:** forbid «close without marking»?

## Approval

- [ ] PM reviewed this file
- [ ] Engineering estimates phases B–D
- [ ] Then invoke `writing-plans` skill for task breakdown
