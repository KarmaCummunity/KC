# Karma Community MVP — Backlog

> **Purpose:** Priority-ordered **open** task queue (`⏳` / `🟡` only).
> Agents pick the highest-priority `⏳` item. Update status when starting (⏳→🟡) or completing (🟡→✅).
> Completed work: [`archive/BACKLOG-history.md`](./archive/BACKLOG-history.md).

---

## TRANSLATE — Shared infra

| ID | Task | Owner | Status | Spec |
|----|------|-------|--------|------|
| TRANSLATE-P3 | **Phase 3 — Chat translation (opt-in, last).** Sender-consent gate; per-conversation translation; LRU cache eviction for chat. | agent-fullstack | ⏳ Planned | `spec/18_translation.md` FR-TRANSLATE-004 (to be detailed) |

## Shared — Research / Infra / Perf

| ID | Task | Owner | Status | Spec |
|----|------|-------|--------|------|
| P1.7 | FR-RESEARCH-001..003 — Public market research form | agent-be + agent-fe | 🟡 In progress (post-merge QA) | `spec/16_public_research.md` |
| P1.8 | FR-RESEARCH-004 — Share affordance for public research survey | agent-fe | 🟡 Code complete, post-merge QA pending | `spec/16_public_research.md` |
| INFRA-QA-W1 | Playwright P0 E2E gate on dev + release (release lane `ci-release.yml`, `tests/e2e/`) | infra | 🟡 In progress | Wave 1 |
| INFRA-QA-W2 | E2E domain expansion (posts, chat send, donations, research) | infra | ⏳ Planned | Wave 2 |
| INFRA-QA-W3 | RLS persona integration suite | infra | ⏳ Planned | Wave 3 |
| INFRA-QA-W4 | Performance budgets (Lighthouse + k6) | infra | ⏳ Planned | Wave 4 |
| INFRA-QA-W5 | Accessibility axe gate | infra | ⏳ Planned | Wave 5 |
| INFRA-QA-W7 | Expanded prod synthetic monitoring | infra | 🟡 In progress | Wave 7 — KC deploy smoke (`deploy-smoke.yml`) |
| INFRA-OSS-4 | **Snyk PR scan** | infra | 🟡 In progress | `SECURITY.md` |
| INFRA-OSS-6 | **GitGuardian** | infra | 🟡 In progress | `SECURITY.md` |
| PERF-4 | **Image delivery — upload-time thumbs + backfill** | agent-fullstack | 🟡 In progress | TD-11 |
| PERF-5 | **DB consolidation — per-chat unread count RPC** | agent-fullstack | 🟡 In progress | Migration `0133` |
| SEC-1063 | **DB function privileges (#1063).** `EXECUTE` is an explicit decision of each migration: new functions private by default, SECURITY DEFINER triggers and internal helpers service-role only, anon limited to the reviewed public-read list (`0520`); guarded by `supabase/tests/0520_*` and `scripts/check-rpc-grants.mjs` (CI backend lane). Remaining: verify on kc-dev after the Deploy run. | agent-be | 🟡 Code complete — kc-dev verification pending | [ADR-002 §2](../architecture/adr/ADR-002-data-layer.md) |
| SEC-1065 | **Account deletion removes all of the user's media (#1065, FR-SETTINGS-012 AC2).** `delete-account` purges the user's folder in every user-owned bucket (`avatars`, `post-images`, `chat-media`, `listing-images`); a failing bucket is reported and the others still run. Remaining: verify on kc-dev after the Deploy run. | agent-be | 🟡 Code complete — kc-dev verification pending | [`spec/11_settings.md`](./spec/11_settings.md) FR-SETTINGS-012 |
| SEC-1067 | **Worker endpoints accept only the service-role key (#1067).** `receipts-issuer`, `subscriptions-charger`, `whatsapp-intake-worker` and `whatsapp-sender` check their caller with `_shared/serviceRoleGuard.ts` right after their method guard; a regression test enforces it, and the deploy smoke now probes every function (TD-219 closed). Remaining: verify on kc-dev after the Deploy run. | agent-be | 🟡 Code complete — kc-dev verification pending | [ADR-002 §2](../architecture/adr/ADR-002-data-layer.md) |
| SEC-1064 | **Chat images are private (#1064).** The `chat-media` bucket is no longer public; an image is readable by whoever can see its chat (`is_chat_visible_to`, the messages' predicate, `0521`), and the app shows it through a short-lived signed URL from `media_payload.path` (`chatMediaUrl.ts`, `ChatMediaImage`). Remaining: verify on kc-dev after the Deploy run; installed store builds older than this change show no chat images until they update. | agent-fullstack | 🟡 Code complete — kc-dev verification pending | [ADR-002 §3](../architecture/adr/ADR-002-data-layer.md) |

## INFRA — CI/CD hardening (`D-195`)

Stages 1, 2, 3 and 6 (`INFRA-CI-1` unified PR gate, `INFRA-CI-2` gate integrity, `INFRA-CI-3` gated prod release, `INFRA-CI-6` agent bot identity) are done in code — see [`archive/BACKLOG-history.md`](./archive/BACKLOG-history.md); stages 4 and 5 (`INFRA-CI-4` nightly mobile, `INFRA-CI-5` docs drift) are done too (rows below); their repository settings are `INFRA-CI-OWNER`. Rows that change CI files need owner approval (`D-195`).

| ID | Task | Owner | Status | Spec |
|----|------|-------|--------|------|
| INFRA-CI-OWNER | **Owner settings for the D-195 pipeline (owner action).** **Done (live 2026-11-01):** `main` requires only `CI gate` (classic protection, admins included); `dev` ruleset `dev protection (merge queue)` (`CI gate`, merge queue, no force-push or deletion; bypass: repository admin + `kc-version-bump`); environments, variables and the tag ruleset; GitHub Apps `kc-agent-bot`, `kc-ci-verdict`, `kc-version-bump`. **Remaining, in order:** (1) **First release `dev` → `main`:** `main` (last release 2026-10-27) has none of the D-195 files, so the release PR's `CI gate` cannot load its judges from the base. Merge it once as admin: turn off "Do not allow bypassing" on `main`, merge, turn it back on (`OPERATOR_RUNBOOK.md` step 5). The deploy pipeline, `CI verdict`, the App-token auto-merge and the nightly run only from `main`, so none of them is live before this; (2) `BACKUP_AGE_RECIPIENT` before that release deploys (#1339); (3) Write-role **machine user** for agents (step 2.4–2.5). Agents still act through the owner's account, so the owner cannot approve their PRs and they can use the admin bypass; (4) then turn on **code-owner review** (live `dev` ruleset and `main`; until then CI-file changes need no approval, `TD-221`); (5) require `CI verdict` from `kc-ci-verdict` (#1338); delete `AGENT_MERGE_TOKEN` after #1349 and one App-driven auto-merge (#1337); (6) `mobile-store` + EAS `preview` + iOS signing for the nightly, the Sonar summary comment, and cleanup (#1339); move the remaining repository secrets into environments (`TD-223`). | owner | 🟡 In progress | [`OPERATOR_RUNBOOK.md` § Owner setup for D-195 CI/CD](./OPERATOR_RUNBOOK.md#owner-setup-ci) |
| INFRA-CI-4 | **Nightly mobile pipeline.** Scheduled TestFlight + Play internal builds from the last `dev` SHA whose `CI gate` passed (`mobile-nightly.yml`; kc-dev backend via the eas.json `nightly` profile, verified in the built bundle). Owner setup: `ENVIRONMENTS.md` § Production release. | infra | ✅ Done | `D-195`, `D-192` |
| INFRA-CI-5 | **CI docs drift cleanup.** Bring `docs/dev/**`, `TESTING.md`, `SECURITY.md`, `OPERATOR_RUNBOOK.md` and agent docs in line with the single-gate layout; drop references to removed workflows. Done 2026-10-31: Railway → Cloudflare Pages, removed workflows, required-check lists → `CI gate`, live ruleset state, bundle id `org.karmacommunity.app`; Sonar coverage exclusions aligned with vitest (tests added for the upload services, error maps, `authStore`, `openExternalUrl`); `edited`-event re-runs logged as `TD-233`. | infra | ✅ Done | `D-195` |

## DONATE — Money hub

| ID | Task | Owner | Status | Spec |
|----|------|-------|--------|------|
| DONATE-G8b | **Donation-to-KC confirmation + karma.** Grow webhook Edge Function (verify with Grow API, idempotent via `provider_webhook_events`), record the donation, award karma (1 per ₪10, 10/month standing order, cap 100 — §7.6). [blocked: Grow merchant account + API credentials — launch plan A11] | agent-be | ⏳ Planned | `spec/13_donations.md` FR-DONATE-011 AC8 · `docs/spec/93` G8 |

## OPS — Testing & observability infrastructure (D68, D69)

| ID | Task | Owner | Status | Spec |
|----|------|-------|--------|------|
| OPS-G38 | **Shared DB test harness + per-world lifecycle flows.** Harness + runner + rides flow shipped; port items, food, knowledge flows onto it. | agent-be | 🟡 In progress | `docs/architecture/target.md` §5.1 · G38 |
| OPS-G42 | **Health registry + monitor + alert router.** Shipped: `ops.health_checks` + 7 checks (`0463`), hourly dev + prod run, GitHub-issue alerts (→ email) with auto-close. Open: WhatsApp channel once live, synthetic web check. | agent-fullstack | 🟡 In progress | §5.2 · G42 |
| OPS-G39 | **Port contract tests** (fake + Supabase adapter, same suite). Shipped: framework-agnostic contract kit (`@kc/application` `contracts/`), `IPostRepository` contract (9 owner-lifecycle cases) run against a behavioural `InMemoryPostRepository` in `pnpm test` and against `SupabasePostRepository` on the local stack in `ci-backend`; `ISavedPostsRepository` contract (8 bookmark cases: idempotent save, per-user rows, readability gate on save, bookmark kept while the post is unreadable, cascade on post delete) run against `InMemorySavedPostsRepository` and `SupabaseSavedPostsRepository` the same way. Next ports, in order: `IChatRepository`, `IRideListingRepository` + `IRideParticipantRepository` (G1 safety net), `IUserRepository`, `IReportRepository`. | agent-fullstack | 🟡 In progress | §5.1 · G39 · `D-204` |
| OPS-G40 | **Two-user E2E journey per active world.** Shipped: one journey shape (`tests/e2e/lib/worldJourney.ts`: A publishes through the create RPC → B claims on the listing page → A confirms (when the world needs it) → A hands over, listing closes, karma written → B rates) with one fixture per live world: `journeys/items.spec.ts`, `journeys/food.spec.ts` (quick claim is confirmed at once). Top-level journeys run in the nightly, the mobile-nightly P0 gate and the release lane. Next: `time` once its launch flag is on, `rides` with the post-based flow (G44), knowledge in phase 2. | agent-fe | 🟡 In progress | §5.1 · G40 · `D-205` |
| OPS-G43 | **Per-world flow funnel** from handoff timestamps. | agent-be | ⏳ Planned | §5.2 · G43 |
## POSTS & FEED — One create form, every category everywhere (PM, 2026-11-01)

| ID | Task | Owner | Status | Spec |
|----|------|-------|--------|------|
| CREATE-5CAT | **Create form cleanup + TestFlight crash.** Category picker (items, rides, food, housing, time) with the last used category + direction remembered, request / offer under it, curated fields per category and direction; no inline native date picker or slider; "donations marketplace" card and browse screen removed (`/donations/marketplace` → hub, "my listings" in the profile menu). Tests: field-spec units, a jsdom render matrix of every category × direction with full ride / time publishes, Maestro flow `13-create-form-categories`. | agent-fe | ✅ Done | `spec/04_posts.md` FR-POST-001 AC6 · `spec/13_donations.md` FR-DONATE-001 AC6 · `D-207` |
| FEED-WORLDS | **Main feed of every category + a feed per world.** (1) Turn on `worlds.feed_mirror` for rides, housing and time so their listings reach the main feed like items and food (`0466`); check feed cards for ride / stay / shift details. (2) Give each active world screen search, "request" / "offer" buttons (create form preset by `createRouteFor` + direction) and the world's feed of open offers and requests, with `BrowseRefineChips` where the world has subcategories; housing and time get a world screen (today: links-only category screen / org opportunities). (3) Rides, time and housing launch flags are seeded off (`0441`) — the create form offers them regardless; flip the flags when their world screens ship. Old KC repo for reference screens. **(1) done** — `0522` (FR-FEED-020 AC1): rides, housing and time mirror into the main feed, cards show the world chip + icon. **(2) done** for every create category — items, food, rides (#1381), housing and time (world header with request / offer + sub-screens, world feed with search, direction and refine chips). **(3)** time flag on (`0523`); housing flag flips with TD-245 (verification pre-check). | agent-fullstack | 🟡 In progress | `spec/06_feed_and_search.md` FR-FEED-020 · `docs/spec/07` §7.3 · `TD-246`, `TD-245` |

## RIDES — Replace a WhatsApp ride group (D70–D75)

| ID | Task | Owner | Status | Spec |
|----|------|-------|--------|------|
| RIDES-1413 | **Recurring ride (#1413).** Weekdays + departure time + optional end date on the create form; the server publishes one ride per upcoming day (30 days), one card per series in the main feed, folded series rows in the rides feed with "other dates" on each occurrence, one route alert per follower; "my recurring rides" with pause / reschedule / cancel. Shipped: `0529`, `RideRecurrenceFields`, `MyRideSeriesList`. | agent-fullstack | ✅ Done | §5.3 · FR-RIDE-046 · {{D:recurring-rides}} |
| RIDES-G47 | **Driver bookings + push.** Driver sees and approves/declines every booking on a ride; push on booked / approved / declined / cancelled / expired; unapproved bookings expire (D96). Shipped: `0511` + `RideBookingActions`; rides world flag on. | agent-fullstack | ✅ Done | `docs/spec/05_giving_worlds.md` §5.3 · G47 |
| RIDES-G45 | **Official places catalog + picker.** Import MoT junctions & interchanges (D98); one picker over cities, streets and junctions for origin, destination and ≤ 3 meeting points. Shipped: `0512`/`0513`, `RidePlaceField`, server-side place guard. | agent-fullstack | ✅ Done | §5.3 · G45 |
| RIDES-G46 | **Map + navigate.** Ride route on the map; "navigate" to Waze / Google Maps / Apple Maps for every ride place. | agent-fe | ✅ Done | §5.3 · G46 |
| RIDES-G49 | **Quick publish + rides feed.** Cross-platform date-time field, time shortcuts, remembered route, "publish again" (D97); feed of offers + requests by departure, departed hidden. | agent-fullstack | ✅ Done | §5.3 · G49 |
| RIDES-G48 | **Saved routes.** Follow a route; alerts with the rides urgency rule and cap (D95). | agent-fullstack | ✅ Done | §5.3, §7.11 · G48 |
| RIDES-G44 | **One rides flow.** Retire legacy `ride_listings` screens; move emergency button + cost caps onto the one flow. | agent-fullstack | ✅ Done | §5.3 · G44 |

## FINANCE — Org finance & transparency (`spec/19_org_finance.md`)

| ID | Task | Owner | Status | Spec |
|----|------|-------|--------|------|
| FIN-P1 | **Phase 1 — Books + Section 46(a) + exports.** Org-scoped ledger (extend `0170`, backfill to platform org), roles `org_treasurer` / `org_accountant` + `finance.*` permissions + `finance_assert`, financial accounts, category tree + counterparty rules, entry lifecycle (void, locks), attachments bucket, 46(a) status card + certificate, receipt tracking + queue, automatic payment mirroring trigger + backfill, CSV/XLSX/PDF export Edge Function, `(admin)/finance/*` sub-tree replacing `/admin/money`. Migrations `0470–0479`. | agent-fullstack | ⏳ Planned | `spec/19_org_finance.md` FR-FIN-001..011 |
| FIN-P2 | **Phase 2 — Imports, reconciliation, reports, alerts.** CSV import wizard (bank / Bit / Paybox / generic, fingerprint dedupe), reconciliation screen + locks, five reports + export, budget vs actual, computed alerts + 30-day mute + daily digest notification, full overview dashboard. Remove `money.manage` alias and `/admin/money` redirect (`TD-208`). Migrations `0480–0485`. | agent-fullstack | ⏳ Planned | `spec/19_org_finance.md` FR-FIN-012..017 |
| FIN-P3 | **Phase 3 — Documents vault, transparency, donor receipts.** `org_documents` + private bucket + signed public URLs, transparency snapshots (build / review / publish / supersede) + toggles, `rpc_org_transparency` + `OrgTransparencySection` on the public nonprofit page, donor-side receipt state + download + `donation_receipt_ready` notification. Requires PM legal sign-off on public 46(a) wording (spec O3). Migrations `0486–0489`. | agent-fullstack | ⏳ Planned | `spec/19_org_finance.md` FR-FIN-018..021 |

## ORGANIZATIONS — Profile & accounts (`spec/20_organizations.md`)

| ID | Task | Owner | Status | Spec |
|----|------|-------|--------|------|
| ORG-P1 | **Phase 1 — One entity, registration, public profile, act-as.** Extend `organizations` + `users.account_type/org_id`; fold `org_applications` → `org_registrations` and `external_bodies` → unclaimed organizations (compat view, TD-229); registration wizard + admin approval creating the organization account; `/org/[slug]` profile + edit + slug redirects; follows for/by organizations; profile switcher + `can_act_as_org`; `listings.author_org_id`; money nonprofit page folded into the Donate tab. Migrations `0490–0499`. | agent-fullstack | ⏳ Planned | `spec/20_organizations.md` FR-ORG-001..010 |
| ORG-P2 | **Phase 2 — Team, activity, discovery, inbox.** Team tab (opt-in), activity tabs, impact metrics RPC, Search "ארגונים" parent filter + sub-filters replacing hub directories and `list_verified_nonprofits`, organization inbox (`chats.org_id`), org notifications. Remove `get_nonprofit_public_page` (TD-230). Migrations `0500–0505`. | agent-fullstack | ⏳ Planned | `spec/20_organizations.md` FR-ORG-011..016 |
| ORG-P3 | **Phase 3 — Claiming, enrichment, badges, transparency.** `org_claims` + admin tab, Registrar open-data mirror + lookup (S35), verification-level badges + admin RPC, transparency tab mounting FR-FIN-020. Needs the organization terms addendum text from the PM (spec O3). Migrations `0506–0509`. | agent-fullstack | ⏳ Planned | `spec/20_organizations.md` FR-ORG-017..020 |

## UI — Shared kit (`docs/spec/17_brand_and_design_system.md` §4.1, epic #1061)

| ID | Task | Owner | Status | Spec |
|----|------|-------|--------|------|
| UI-KIT-1 | **Phase 1 — `Modal`, `BottomSheet`, `Chip`, sized buttons.** Kit components on tokens with tests; brand guard `rawModal` made import-aware and `adHocChip` added; migration inventory in spec 17 §4.1.1. Adds `DangerButton` for destructive actions (D94). PM approved the look 2026-11-01. | agent-fe | ✅ Done | §4.1 · #1284 #1285 #1286 |
| UI-KIT-2 | **Phase 2 — migrate screens onto the kit**, one area per PR (sheets, dialogs, chips, CTAs), lowering the brand-guard baseline each time. Sheets: 8 of 9 sheet components on `BottomSheet` (`SearchablePicker` deferred). Dialogs: 13 of 14 centred dialogs on `Modal` (`LegalConsentScreen` exit confirm waits for `LegalConsentGate`). Chips: 7 of 8 exported and all 3 local chip components on `Chip` (`ChatReactionChips` kept: a reaction counter, not a kit chip). CTAs: onboarding, auth and closure (CTAs 1), tabs, marketplace and About (CTAs 2) the root components (CTAs 3) and the token-clean admin files (CTAs 4) on kit buttons; the baseline-dirty admin files follow UI-ADMIN-1. See `TD-243`. | agent-fe | 🟡 In progress | §4.1.1 · `TD-243` |
| UI-ADMIN-1 | **Admin surfaces on brand tokens (#1287, D67).** One admin area per PR to zero brand-guard findings, values snapped to the nearest token (the smaller on a tie: admin is the denser layout). ✅ `components/admin/admins` (13 files); ✅ shared admin components, `reports`, `tasks` rows (16 files); ✅ admin home, `money`, `whatsapp`, `time`, `crm`, survey cards (8 files). Left: 23 admin files in the baseline (spec 17 §4.3 progress line). | agent-fe | 🟡 In progress | [`spec/17`](../spec/17_brand_and_design_system.md) §4.3 |

## Deferred (post-MVP, still tracked)

| ID | Task | Status | Spec |
|----|------|--------|------|
| P3.1 | Block / unblock + visibility restoration | ⏳ Deferred (EXEC-9) | `spec/08_moderation.md` FR-MOD-003/004/009 |
| P3.MATCH-XW | **Cross-world matching** (improvement, P3). Goal: pair listings across worlds when one enables the other (item give ↔ ride offer for pickup/delivery; food give ↔ volunteer time for distribution). AC: opt-in per world pair in `matching_settings`; reuses `match_candidates` with a `link_kind`; geo/time windows of both legs respected; never notifies above the per-user cap; SQL test + seed sample; off by default. | ⏳ Deferred (PM 2026-10-18) | `docs/SSOT/MATCHING_V2.md` |

---

## Sprint Protocol

1. Pick the highest `⏳` item in **this file** (not `archive/`)
2. Read its linked `spec/` file
3. Move status to 🟡
4. Implement
5. Move status to ✅ **and** append/move the row to `archive/BACKLOG-history.md`
6. Update spec file status if all ACs complete
