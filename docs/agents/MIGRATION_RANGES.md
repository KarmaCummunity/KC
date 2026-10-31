# Migration range registry

**Rule:** before writing a migration, claim a range here, in your PR or a small docs PR to `dev`. Use only numbers inside your range. Files are `supabase/migrations/NNNN_snake_case.sql`. Gaps are fine; collisions are not.

Last applied on kc-dev when this was written: `0239`.

| Range | Owner / issue | Status |
|---|---|---|
| 0238–0239 | #852 (GloWe removal, translation) | merged |
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
| 0466+ | — | free |

## Next free ranges

`0248–0249`, `0271–0279`, `0286–0299`, `0309`, `0310–0319`, `0404–0409`, `0414`, `0443–0444`, `0466+`.
| 0470–0489 | Org finance & transparency — `SSOT/spec/19_org_finance.md` FR-FIN-001..021 (P1 `0470–0479`, P2 `0480–0485`, P3 `0486–0489`) | claimed (spec only, no files yet) |
| 0463 | G42 / D68 / D69 ops health registry + first platform and rides checks (#1321) | in review |
| 0464 | #1297 chat from a listing opens and anchors the listing; one context per chat | in review |
| 0465 | FR-ADMIN-030 team management: org-scoped `admin_list_admins` + atomic `admin_change_role` (D-197) | in progress |
| 0490–0509 | Organization profile & accounts — `SSOT/spec/20_organizations.md` FR-ORG-001..020 (P1 `0490–0499`, P2 `0500–0505`, P3 `0506–0509`) | claimed (spec only, no files yet) |
| 0468 | #1298 listing reports recorded (reporter hide, audit), reported listings hidden for review, admin restore, moderation-only review states | in review |
| 0466–0467, 0469, 0510+ | — | free |

## Next free ranges

`0248–0249`, `0271–0279`, `0286–0299`, `0309`, `0310–0319`, `0404–0409`, `0414`, `0443–0444`, `0466–0467`, `0469`, `0510+`.

## How to claim

1. Take the lowest free block that fits, usually 5–10 numbers.
2. Add a row with your issue number and `in progress`, then commit it in your PR.
3. When the PR merges, set the status to `merged`. Return unused numbers by adding a `free` row.
