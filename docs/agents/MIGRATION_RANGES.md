# Migration range registry

> **Reset by the production baseline cut-over (D-228).** The incremental chain `0001`–`0742` was
> replaced by one migration, `supabase/migrations/0001_baseline.sql`, assembled from
> `supabase/schemas/` and frozen (`node scripts/assemble-baseline.mjs --check` fails when it
> changes). The old files are history in `supabase/migrations/archive/`. **The next free number is
> `0002`.** Later changes are forward-only `supabase/migrations/NNNN_snake.sql` files with their
> pgTAP test in `supabase/tests/`; claim a range in the first table below. The second table is
> the record of the retired chain and is kept for reference only.

## Ranges after the cut-over

| Range | Owner / issue | Status |
|---|---|---|
| 0002 | #2150 organization entitlement (`0002_org_entitlements.sql`) | merged |
| 0003–0019 | `claude/baseline-post-cutover`: the post-cut-over world, chat, research, housing, knowledge and money changes ported from the pre-cut-over baseline branches. `0003` post seat counts, `0004` ride series schedule, `0005` match quality, `0006` profile mine tab, `0007` chat inbox previews, `0008` post media sizes, `0009` research feedback and survey reports, `0010` housing, knowledge and finance reads | merged (#2155) |
| 0011–0014 | `claude/parity-*` feature-parity restore: admin roles, hierarchy, census, last seen, role vocabulary, org slug, finance ledger | in progress |
| 0015–0019 | `claude/parity-moderation-support` feature-parity restore of moderation, support and statistics: `0015` blocked users list and the staff support inbox (FR-MOD-004, FR-MOD-002, FR-ADMIN-013), `0016` report case tools (chat restore, restore dismisses the case, server inbox, case timeline, audit lookup by actor or target, comment restore; FR-ADMIN-002/007/012/013), `0017` report SLA alert sweep and `report_sla_warning` (FR-ADMIN-012 AC6), `0018` world flow funnel and my givings by world (FR-STATS-007/008, D106), `0019` KC support channels table (FR-DONATE-011, M20) | in progress |
| 0020 | #2154 Section 46(a) status on the kernel (`0020_org_sec46_machine.sql`) | in progress |
| 0021–0049 | feature-parity restore (back-office, WhatsApp, member features), handed out by the parity coordinator; `0020` was already taken by #2154, so the block starts at `0021` | claimed |

Next free number: `0050`.

## Retired chain (before D-228)

**Rule:** before writing a migration, claim a range here, in your PR or a small docs PR to `dev`. Use only numbers inside your range. Files are `supabase/migrations/NNNN_snake_case.sql`. Gaps are fine; collisions are not.

Last applied on kc-dev when this was written: `0239`.

| Range | Owner / issue | Status |
|---|---|---|
| 0238–0239 | #852 (retired product removal, translation) | merged |
| 0240–0247 | #860 (unified schema) | merged |
| 0248–0249 | — | free |
| 0250–0259 | social (#885, #887) | merged |
| 0260–0262 | #886 (matching) | merged |
| 0263–0270 | #889 (PRD roles / payments) | merged |
| 0271–0279 | — | free |
| 0280–0285 | social3 (#892) | merged |
| 0286–0299 | — | free |
| 0300–0304 | WhatsApp bot (#902) | merged |
| 0305–0306 | WhatsApp consent/STOP/HELP keywords + audit (#937); send limits, 24h window, LLM budget, pgmq outbound backoff queue (#938) | merged |
| 0307 | WhatsApp message templates as code (#936/#963): registry columns, he/en seed, language-aware queue | merged |
| 0308 | WhatsApp admin dashboard RPCs (#939/#968): overview, consent, outbound, rate hits, matches, kill switch, resend, block | merged |
| 0309 | — | free |
| 0310–0319 | — | free |
| 0320–0339 | marketplace (#912) | merged |
| 0340–0349 | perf (#910, #911) | merged |
| 0350 | world-rules trigger: enforce on insert / rule-field change only (#952) | merged |
| 0351 | items image rule: photo or details image, deferred check (#953) | merged |
| 0352 | drop old 9-param create_marketplace_listing overload (#954) | merged |
| 0353 | external-organisation picker: external_bodies RLS, search + admin RPCs, create RPC p_external_body_id | merged |
| 0354–0356 | Supabase advisors cleanup (#945/#962): RLS initplan, FK indexes, search_path | merged |
| 0357 | items image optional: drop 0351 deferred image check + last-photo delete block (product decision) | merged |
| 0358 | users: grant SELECT (preferred_language), QA pass (#978) | in review |
| 0359 | get_marketplace_listing_detail: users.city fix, QA pass (#977) | in review |
| 0360–0369 | money world (#913) | merged |
| 0370–0379 | time world (volunteering, #915) | merged |
| 0380–0389 | items & food worlds (handoffs, #916) | merged |
| 0390–0399 | rides + knowledge marketplace worlds (geo match, seats/slots, handoffs) | merged (#972) |
| 0400 | #982: kc-dev demo verified nonprofits (guarded no-op unless kc-dev seed present) | merged |
| 0401 | #991 store readiness: account-deletion FK fixes (money records de-identified on delete) | merged |
| 0402 | Store readiness: DRAFT terms + privacy on kc-dev aligned with behaviour (guarded no-op off kc-dev) | merged (#998) |
| 0403 | Store readiness: `app_flags` remote config (`ios_in_app_donations`) | merged (#999) |
| 0404–0409 | — | free |
| 0410–0413 | perf: keyset pagination + hot-query indexes (feed / marketplace / search) | merged (#989) |
| 0414 | — | free |
| 0415–0416 | realtime: typing/presence send auth, online presence topic, feed:public new-post broadcast | merged (#994) |
| 0417–0419 | feed hides/mutes view (`feed_visible_posts`), paged post/user search RPCs (no exact count), "show my active status" presence privacy | merged (#1001) |
| 0420–0423 | matching engine v2: `match_candidates` + scorer across worlds (PostGIS/time/trust/mutes/blocks), pg_cron sweep + on-write trigger, in-app/WhatsApp delivery (consent, quiet hours, daily cap), accept/decline feedback, LLM re-rank hooks (flag off) — see `docs/SSOT/MATCHING_V2.md` | merged (#1004) |
| 0424–0427 | matching v2 quality: Hebrew-aware head-noun/keyword text score + notify text floor, rides route corridor/direction/window/seats + re-score, kc-dev demo ride requests (guarded), kc-dev daily e2e listing cleanup (guarded) | merged (#1006) |
| 0428–0429 | matching engine v2 follow-ups (reserved) | claimed (matching v2) |
| 0430–0439 | Pro entitlement + WhatsApp Pro bot (#1083, #1089, #1090, #1086, #1091) | in progress |
| 0440 | #1041 world launch wedge `app_flags` | in progress |
| 0440 (file) | Note 2026-10-30: the file actually numbered `0440` is `chat_media_storage_rls_user_first` (#1216); the world launch flags shipped as `0441_world_launch_app_flags.sql` | merged |
| 0442 | #1228 admin hierarchy position permissions | in review |
| 0443–0444 | — | free |
| 0445–0449 | `claude/launch-readiness` (storage media access scope + launch fixes) | in progress |
| 0450 | G32 / D59 items and requests never expire + owner reminders (#1259) | in progress |
| 0451 | G3 / D16 listing anonymity both ways (#1254) | in progress |
| 0452 | G33 / G20 / D61: hide reported posts for review, user suspension 5/30 d, support while suspended | in progress |
| 0453 | G34 / D63 listing-handoff karma per the §7.6 table (#1262) | in progress |
| 0460 | #1120 per-type notification opt-outs (`kinds`), match-suggestion opt-out in delivery | in review |
| 0454 | #1122 admin match-quality metrics (`admin_match_quality`; moved from 0461, which #1268 uses) | in review |
| 0455–0458 | #1058 Sean Ellis PMF survey (single-choice questions, `user_active_days`, admin PMF report) | in review |
| 0459 | #1294 listing expiry from `details.expires_at`, food urgency on the 1–3 scale | in review |
| 0461 | FR-ADMIN-028 layered hierarchy census RPC (`admin_hierarchy_census`, #1268) | in progress |
| 0462 | #1296 listing world subcategory must match the listing's world | in review |
| 0463 | #1298 listing reports recorded, reported listings hidden for review | in review |
| 0464 | #1297 chat from a listing opens and anchors the listing | in review |
| 0469 | #1102 / #1111 `browse_listings` world subcategory filter | in review |

## Next free ranges

`0248–0249`, `0271–0279`, `0286–0299`, `0309`, `0310–0319`, `0404–0409`, `0414`, `0443–0444`, `0466+`.
| 0470–0489 | Org finance & transparency — `spec/requirements/19_org_finance.md` FR-FIN-001..021 (P1 `0470–0479`, P2 `0480–0485`, P3 `0486–0489`). `0470` = FIN-P0 lean slice (accounts, public display, donors) | `0470` in review; rest claimed (spec only) |
| 0463 | G42 / D68 / D69 ops health registry + first platform and rides checks (#1321) | in review |
| 0464 | #1297 chat from a listing opens and anchors the listing; one context per chat | in review |
| 0465 | FR-ADMIN-030 team management: org-scoped `admin_list_admins` + atomic `admin_change_role` (D-197) | in progress |
| 0490–0509 | Organization profile & accounts — `spec/requirements/20_organizations.md` FR-ORG-001..020 (P1 `0490–0499`, P2 `0500–0505`, P3 `0506–0509`) | claimed (spec only, no files yet) |
| 0468 | #1298 listing reports recorded (reporter hide, audit), reported listings hidden for review, admin restore, moderation-only review states | in review |
| 0466 | KC#1101 / KC#1109 AC4 — native items and food listings mirror into the main feed (`posts.listing_id`, `worlds.feed_mirror`, D-206) | in review |
| 0510 | KC#1306 "Rating given" karma (2 per handoff or ride rating) | in review |
| 0511–0519 | Rides end to end — `docs/spec/05_giving_worlds.md` §5.3, gaps G44–G49 (`0511` G47 driver bookings) | in progress |
| 0520 | KC#1063 function `EXECUTE` explicit grants: new functions private by default, SECURITY DEFINER triggers and internal helpers service-role only | in review |
| 0521 | KC#1064 `chat-media` bucket private: read policy by chat visibility, signed URLs in the app | in review |
| 0522–0526 | FEED-WORLDS / FR-FEED-020 — main feed of every create category + a feed per world (`0522` every create category mirrors into the feed, merged #1376; `0523` time world active) | in progress |
| 0527 | KC#1411 `list_ride_places` total order (label, kind, id) so the app can page past `max_rows` | in review |
| 0528 | KC#1391 FR-NOTIF-018 item and food handoff pushes (`giving_handoffs_giving_notify`) | in review |
| 0529 | Feed filter giving worlds + subcategories (#1457) | in progress |
| 0530 | KC#1128 ride completion RPC: owner closes ride and completes confirmed bookings | in review |
| 0531 | KC#1413 FR-RIDE-046 recurring rides: `ride_series`, materializer + sweep, series RPCs, rides-feed folding, `list_ride_series_occurrences` | in review |
| 0532 | Item reservations return `item_already_reserved` (#1500) | in review |
| 0533 | Ride booking approval rechecks seat capacity under the listing lock (#1499) | in review |
| 0534 | #880 server-side write rate limits: listings, giving handoffs, follows | in progress |
| 0535 | #1468 knowledge world subcategories | in progress |
| 0536 | FK and hot-path indexes | in progress |
| 0537 | RPC input bounds | in progress |
| 0539 | food expiry: offers only, no food TTL (G38, D21 / D28) | merged (#1554) |
| 0540 | listing detail schemas enforced for native listings | in progress |
| 0541 | follow edges to Private profiles only through an approved request (FR-FOLLOW-003/005/012) | in progress |
| 0542 | admin per-world flow funnel (G43) | in progress |
| 0543 | listing owner management by status (spec 07 §7.1) | in progress |
| 0544 | block filtering in both directions (FR-MOD-009) | in progress |
| 0545 | Blocked Users list (FR-MOD-004) | in progress |
| 0546 | donation link approval (D9) | in progress |
| 0547 | my givings by world (FR-STATS-008) | in progress |
| 0548 | D-211 donation link world categories | merged |
| 0549 | account deletion grace period + purge (FR-SETTINGS-012) | merged |
| 0550 | kc_support payee phone for bit / paybox (#1587; taken while the G1 range was claimed, G1 step 1 moved to `0551–0553`) | merged |
| 0551–0569 | G1 one Post model (ADR-006): `0551–0553` step 1 additive schema (merged), `0554` step 2 posts own the listing worlds (merged), `0555` step 3a post_handoffs is the handoff record (merged), `0556` step 3b ride / knowledge booking RPCs and readers accept a post id (merged), `0557` step 3b-pre a post for every listing + `posts.feed_hidden` (merged), `0558` step 3b″ ride / knowledge writers on `post_handoffs` (merged), `0559` step 3c one closing system for items, G34 (merged), `0560` step 4a listing detail `feed_hidden` (merged), `0561` step 4b listing detail by post id (merged), `0562` step 4c listing notifications open the post (merged), `0563` step 5 event posts (merged), `0564` step 5c event waitlist and attendance (merged), `0565` step 6a-1 leaf readers on posts (merged #1892), `0566–0569` step 6 (later step 6 files take `0620–0639`) | in progress |
| 0570 | knowledge topic graph: `knowledge_topics`, aliases, follows, resolve / propose / review RPCs, six shelves (FR-KNOW-001) | in progress |
| 0571–0589 | — (returned by #2034: knowledge SQL redefines functions of `0667` / `0684` / `0694` and must sort after them) | free |
| 0590 | users.date_of_birth + rpc_set_date_of_birth (FR-AUTH-010 AC2.d) | in progress |
| 0591 | admin demo-data status + wipe (FR-ADMIN-031) | in progress |
| 0592 | admin restore demo data: seed moved into the DB (FR-ADMIN-031) | in progress |
| 0593 | RLS auth initplan (#1546) | in progress |
| 0594 | challenges world: cycles, reports, streaks, karma (FR-CHALLENGE-001, #1608; first file named 0550 before it collided with #1587) | in progress |
| 0595–0599 | — | free |
| 0600–0609 | Housing H1 stays (`spec/21_housing.md`): `0600` catalog, schemas, conduct; `0601` private details; `0602` bookings; `0603` booking lifecycle | in progress |
| 0610–0614 | G1 one Post model (ADR-006) steps that redefine functions of the housing range (`0602` / `0603`): `0610` step 3b‴ housing writers on `post_handoffs` (merged). `0611–0614` were used by other work: `0611_report_sla_alert.sql`, `0612_animals_world_direct.sql`, `0613_knowledge_world_in_feed.sql`, `0614_demo_data_platform_admin.sql` (FR-ADMIN-031 AC6, #1871). A later change to `request / decide / cancel / complete_housing_booking`, `mark_housing_no_show`, `housing_bookings_sweep`, `cancel_giving_handoff` or `karma_award_handoff` must use a number above the last file that defines it. | `0610` merged, `0614` in progress |
| 0615–0619 | — | free |
| 0620–0639 | G1 one Post model step 6 (ADR-006): `0620` step 6a-2 handoff readers on `post_handoffs` (merged #1897), `0621` step 6a-3a handoff triggers, rating foreign keys, `rate_giving_handoff` and the food sweep on `post_handoffs` (merged #1898), `0622` step 6a-3b writer RPCs return rows built from `post_handoffs` (merged #1901), `0623` step 6a-4a ride readers on `posts` / `ride_post_details` / `post_handoffs` (merged #1903), `0624` step 6a-4b ride writers on `posts` / `ride_post_details` (merged #1904), `0625` step 6a-5a the listing write cap on `posts` (merged #1905), `0626` step 6a-5b the listing columns on `posts` (merged #1906), `0627` step 6a-5c the owner RPCs lock the post first (merged #1908), `0628` step 6a-5d listing visibility on `posts` and the #1907 moderation-hold fix (merged #1909), `0629` step 6a-5e the listing detail and owner / profile lists on `posts` (merged #1912), `0630` step 6a-5f browse and recommendations on `posts` (merged #1913), `0631` step 6a-5f map pins, clusters (#1911) and rides feed on `posts` (merged #1913), `0632` step 6a-5g search and similar listings on `posts` (merged #1914), `0633` step 6a-6a `post_embeddings` and the search vector signal on it (merged #1916), `0634` step 6a-6b the embed worker's queue RPCs (merged #1917), `0635` step 6a-6c matching v2 on the record (merged #1918), `0636` step 6a-6d the match readers on the record (in review); `0633–0638` reserved for 6a-6 (a–f: embeddings, embed worker, matching, WhatsApp bot); `0639` free — numbered above the housing range so they may redefine its functions | in progress |
| 0640–0659 | — (superseded by 0665–0675 after 0660 merged) | free |
| 0660–0664 | multi-world posts: `listing_worlds`, multi-world feeds, search, matching (#1475) | merged |
| 0665–0675 | G1 one Post model steps 6b–6d (ADR-006, D-214, #1671): `0665` step 6b one S1 state machine (merged #1932), `0666` step 6c drop sync triggers, `0667` step 6d drop `listings` / `giving_handoffs` | in progress |
| 0676 | #1964 demo rides on posts + wipe/restore ride coverage test | in review |
| 0677 | #1964 demo post media paths + org_memberships on demo orgs | in review |
| 0678 | #1964 verification 0..2 mix, OnlyMe posts, storage JPEG fixtures | in review |
| 0679 | FR-ADMIN-031 admin_demo_data_status ride/org/media KPIs | in review |
| 0705 | #2032 the listing detail resolves a former listing id (`posts.listing_id`) to its post | in progress |
| 0680–0689, 0694–0699, 0701–0702, 0716–0725 | FSM kernel program (`docs/architecture/state-machines.md`): `0680` kernel catalog (`fsm_state` / `fsm_edge` / `fsm_assert_transition`) and the admin-task pilot; `0681` post S1 (wave 1a); `0682` admin restore (wave 1b-i); `0683` handoff writers (1b-ii); `0684` items without expiry and `0685` events expire (1b-iii); `0686` event owner actions (1b-iv); `0694` handoff machines (wave 2); `0695` legacy ride jobs retired (wave 1d); `0696` account status (wave 3a); `0697` account status writers (3a-2); `0698` onboarding (3b); `0699` retryable account purge (3c); `0701` reports and follow requests (4a); `0702` comments and knowledge topics (4b); `0716` item / animal reservation expiry (2c); `0717` review queues (4c); `0718` timesheets (5); `0719` ride series and standing orders (6a); `0720`–`0725` held for the next waves; `0692`, `0693` and `0700` are other work | in progress |
| 0690 | money sandbox completion behind the `sandbox_payments` server flag; org memberships written by definer functions only | merged (#1983) |
| 0691 | #1961 reset the public schema comment (retired product cleanup) | in progress |
| 0692 | G1 compatibility views (`listings`, `giving_handoffs`, `ride_listings`) follow the base tables' access rules | merged (#2017) |
| 0693 | composer items posts get their listing kind on insert (regression from 0666) | in progress |
| 0700 | #1398 `give_food` no longer requires `food_type` (the food type is the world sub-category) | in progress |
| 0703–0714 | knowledge exchange posts, epic #1687 (KNOW-K1-B): `0703` six kinds, slots as rows, slot rules and sync (#2034), `0704` slot bookings, sweeps, pushes (#2034), `0705–0714` children #2035–#2039 | in progress |
| 0715 | RLS auth initplan on the hot-table policies, all but posts (supersedes closed #1546, PR #2054) | in progress |
| 0730–0739 | Events and organizations (G18) and the handoff fixes found on the way: `0730` organization registration and members (FR-ORG-002 first slice), `0731` event notifications, `0732` demo events on kc-dev, `0733` animal handoff pushes (`fix/animals-handoff-push`), `0734` ride expiry settles bookings (`fix/rides-expiry-settles-bookings`), `0735` an event's close earns no fulfilled karma, `0736` the end of an event lapses its requests and waitlist; `0737`–`0739` unused (below the applied `0740`, not reissued) | merged (#2106, #2109, #2112) |
| 0740 | delivered listing visibility: union of the two surfaces, recipient via handoff, `recipients` row for food / animals / items hand-overs + backfill (D-229) | in progress |
| 0741 | #2020 offer photo rule on the server (D132): commit-time check on new posts and deleted listing photos, `create_post_with_media` | in progress |
| 0742 | #2078 the personal activity timeline returns each post's world (volunteering wording, FR-CLOSURE-011 AC9) | in progress |
| 0726–0729, 0743+ | — | free |

## Next free ranges

`0248–0249`, `0271–0279`, `0286–0299`, `0309`, `0310–0319`, `0404–0409`, `0414`, `0443–0444`, `0595–0599`, `0614–0619`, `0639`, `0640–0659`, `0726–0729`, `0743+`.

## How to claim

1. Take the lowest free block that fits, usually 5–10 numbers.
2. Add a row with your issue number and `in progress`, then commit it in your PR.
3. When the PR merges, set the status to `merged`. Return unused numbers by adding a `free` row.
