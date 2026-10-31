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

## INFRA — CI/CD hardening (`D-195`)

Stages 1, 2, 3 and 6 (`INFRA-CI-1` unified PR gate, `INFRA-CI-2` gate integrity, `INFRA-CI-3` gated prod release, `INFRA-CI-6` agent bot identity) are done in code — see [`archive/BACKLOG-history.md`](./archive/BACKLOG-history.md); stages 4 and 5 (`INFRA-CI-4` nightly mobile, `INFRA-CI-5` docs drift) are done too (rows below); their repository settings are `INFRA-CI-OWNER`. Rows that change CI files need owner approval (`D-195`).

| ID | Task | Owner | Status | Spec |
|----|------|-------|--------|------|
| INFRA-CI-OWNER | **Owner settings for the D-195 pipeline (owner action).** Live state (2026-10-31): `dev` already has the ruleset `dev protection (merge queue)` requiring only `CI gate`, with the repository-admin bypass; `main` still has classic protection with eight legacy required checks — **switch `main` to `CI gate` only** before the next release. #1292, #1308 and #1319 are merged. Remaining checklist: agent GitHub App in the `main`-only `agent-merge` environment (`{{TD:pull-request-target-main-only}}`) + Write-role machine user, Claude Code reconnected to it; CI-verdict GitHub App in the `main`-only `ci-verdict` environment; move sensitive repository secrets into environments (`TD-223`); prod environments, variables, Cloudflare token; `mobile-store` + EAS `preview` + iOS signing + `mobile/*` tags for the nightly (#1304, merged); import `.github/rulesets/dev-main.json` (reconciled with the live `dev` ruleset) and verify, then require `CI verdict` from the CI-verdict App once `ci-verdict.yml` is on `main`; delete `tmp-probe-*` workflows and branch `chore/ci-nightly-mobile`. | owner | ⏳ Planned | [`OPERATOR_RUNBOOK.md` § Owner setup for D-195 CI/CD](./OPERATOR_RUNBOOK.md#owner-setup-ci) |
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
## RIDES — Replace a WhatsApp ride group (D70–D75)

| ID | Task | Owner | Status | Spec |
|----|------|-------|--------|------|
| RIDES-G47 | **Driver bookings + push.** Driver sees and approves/declines every booking on a ride; push on booked / approved / declined / cancelled; unapproved bookings expire (S45). | agent-fullstack | ⏳ Planned | `docs/spec/05_giving_worlds.md` §5.3 · G47 |
| RIDES-G45 | **Official places catalog + picker.** Import MoT junctions & interchanges (S47); one picker over cities, streets and junctions for origin, destination and ≤ 3 meeting points. | agent-fullstack | ⏳ Planned | §5.3 · G45 |
| RIDES-G46 | **Map + navigate.** Ride route on the map; "navigate" to Waze / Google Maps / Apple Maps for every ride place. | agent-fe | ⏳ Planned | §5.3 · G46 |
| RIDES-G49 | **Quick publish + rides feed.** Cross-platform date-time field, time shortcuts, remembered route, "publish again" (S46); feed of offers + requests by departure, departed hidden. | agent-fullstack | ⏳ Planned | §5.3 · G49 |
| RIDES-G48 | **Saved routes.** Follow a route; alerts with the rides urgency rule and cap (S44). | agent-fullstack | ⏳ Planned | §5.3, §7.11 · G48 |
| RIDES-G44 | **One rides flow.** Retire legacy `ride_listings` screens; move emergency button + cost caps onto the one flow. | agent-fullstack | ⏳ Planned | §5.3 · G44 |

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
