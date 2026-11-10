# Target architecture (implied by `docs/spec/`)

Principle: **one infrastructure, configured per world** (D36); one entity per concept; values in config, not code (D29). Each item cites the spec and the gap (`G#`) to close.

## 1. One Post model (D2, D19, D45) — G1, G24
```
posts                     id, author_id | org_id, world_slug (8), domain_slug (11), direction (offer|request),
                          post_type, status, visibility, anonymity, location_display, expires_at, source (native|imported) …
ride_post_details         1:1 extension (origin, destination, departure_at, estimated_end_at, seats)
event_post_details        1:1 (capacity, waitlist, registration_policy)          — G18
housing_post_details      1:1 (nights, house_rules, exact address after approval) — G21
nonprofit_job_post_details 1:1 (scope, field, apply_link)                         — G28
post_handoffs             closing stage for every type (recipient, closed_at)
post_ratings              one generic two-sided rating, admin-only RLS (D24)      — G4
```
### Migration plan (listings → posts) — [ADR-006](./adr/ADR-006-one-post-model.md), BACKLOG `G1-S1`…`G1-S6`
1. Additive schema: `posts` gains `world_slug`, `direction`, `post_type`, `expires_at`, `source`, `details`, `category_id`, `geo`, `time_window`, `urgency_level` (+ `paused`); `ride_post_details` and `post_handoffs` are created and backfilled from `listings` / `giving_handoffs`, kept in sync by triggers, verified by a report function + SQL tests.
2. `posts` becomes the source of truth for every create category (create form, edit, owner management on posts); `listings` turns into a derived copy for every world.
3. Type-specific flows move onto posts: reserve / claim / book, handoffs, ratings, matching, ride series, notifications, karma (one closing system, G34), admin funnel, deep links.
4. One detail screen `/post/[id]` for every type with likes and comments; `/listing/*` redirects.
5. Volunteering events as `event_post_details` in the same form (G18).
6. Single S1 state machine in DB + domain; drop sync triggers; drop `listings` last, after the report shows identical data.
Each step = its own migration(s) + contract tests + regression tests; no data loss; dry-run on kc-dev first.

## 2. World & domain registry — G2, G23, G24
- `DONATION_WORLD_SLUGS` (8) and `POST_DOMAIN_SLUGS` (11) defined **once** in `packages/domain`, mirrored by DB enums/check constraints.
- `WorldHubConfig` / `DomainHubConfig`: color, icon, tagline, ordered `WorldHubBlock`s, `PostTypeFormSchema` per post type, closing flow, expiry rule. Generic `WorldHubScreen` renders any config; plug-in blocks register by key.

## 3. Cross-cutting services
| Service | Shape | Gap |
|---|---|---|
| Karma | `KARMA_POINT_VALUES` config + ledger; caps; reversal on undo | G16 |
| Feed | `FeedRecommendationEngine` (S33 weights) behind a port; sort/filter by user; audience toggle | G15 |
| Expiry | scheduled job closes per-type expiry, sends reminders (S3, S4) | G11 |
| Notifications | `NotificationType` × `NotificationPreference` × groups important/social/emergency; quiet hours | G17 |
| Trust | `VerificationLevel` (phone/ID/blue check), `TrustEngine` (internal), ID provider adapter | G10, G13 |
| Moderation | thresholds 3/5 (D33), `UserSuspension` | G20 |
| Volunteering | `OrgVolunteerMembership`, `VolunteerHoursEntry` with manager approval | G19 |
| Emergency | `EmergencyDeclaration` (level, region, world, declarer role, expires 24h, audit log) | G25 |
| Challenges | one engine: `Challenge`, `ChallengeScope`, `ChallengeParticipation`, reports per cadence | G26 |
| Orgs | single org entity with roles, `OrgVerificationLevel`, registrar import | G5, G30, G31 |
| Money | `DonationPaymentProvider` adapter; Grow hosted page now, JGive-like later | G8 |
| WhatsApp import | `ExternalGroupImport` → `ImportedPostCandidate` (classifier + review queue) → claim; `GroupBridge` | G27 |
| Governance | `CommunityPoll`, `GovernanceProposal` (phase 3) | G29 |

## 4. Quality gates (D58)
- Every task: spec section + code + automated test; bug → regression test.
- Ports/adapters keep Supabase replaceable; domain stays pure.
- Contract tests for every port change; migration drift check; perf budgets.
- Feature flags per world/phase (D3) instead of branches.

## 5. Testing and observability (D68, D69) — G38–G43
Principle: one shared, world-agnostic infrastructure; a giving world plugs in by adding a fixture file, a lifecycle flow, health checks and funnel rows — never a new framework.

### 5.1 Test layers
| Layer | Where | Runs | Gap |
|---|---|---|---|
| Domain / use-case unit | `packages/*/src/**/__tests__` (vitest) | every PR | — |
| DB harness | `supabase/tests/_harness/` → local-only `kc_test` schema: actors (`act_as`), assertions (`assert_eq`, `assert_raises`, `assert_row_count`), fixtures (`create_user`, `create_listing`), one `20_world_<slug>.sql` per world | installed by `scripts/run-db-tests.sh`; never migrated | G38 |
| Per-migration regression | `supabase/tests/NNNN_*.sql` | every backend PR | — |
| Per-world lifecycle flow | `supabase/tests/flows/<world>_lifecycle.sql`: publish → book → confirm → complete → karma → rating + every guard | every backend PR | G38 |
| Port contract | 🟡 one shared suite per port, run against an in-memory fake **and** the Supabase adapter (local stack) — the safety net for the listings → posts move (G1). Kit: `app/packages/application/src/contracts/` (framework-agnostic `ContractCase[]` + assertions, `D-204`); fake leg in `@kc/application` `__tests__` (every `pnpm test`), adapter leg `*.contract.integration.test.ts` in `@kc/infrastructure-supabase` (`ci-backend`; collected only when the stack credentials are in the environment). Shipped: `IPostRepository`, `ISavedPostsRepository`, `IChatRepository`, `IReportRepository`, and the follow-graph and profile-editing slices of `IUserRepository`; left: the legacy ride ports (BACKLOG `OPS-G39`) | every PR touching a port/adapter | G39 |
| Two-user E2E journey | 🟡 `tests/e2e/journeys/<world>.spec.ts` against dev (Playwright, session injection). One journey shape in `tests/e2e/lib/worldJourney.ts` — publish through the create RPC, claim / confirm / hand over / rate through the listing page as two users, every step re-read over REST as the acting user (RLS as in the app); a world is a fixture (kind slug, claim action, what the claim results in, kind details). Shipped: `items`, `food`; next `time`, `rides` as their flags turn on (`D-205`) | nightly + mobile P0 gate + release lane (PR-time runs would test the previous deployment, not the PR) | G40 |

### 5.2 Observability
| Concern | Shape | Gap |
|---|---|---|
| Client errors | Sentry (`lib/observability/sentry.ts`), env-tagged | — |
| Server errors | ✅ every Edge Function is wrapped by `withObservability` from `supabase/functions/_shared/observability/` (dependency-free Sentry envelope client, unit-tested with a fake transport): a throw that escapes the handler → Sentry exception + generic JSON 500; a 5xx response → Sentry message with function, status and the body's `error` code (codes only, never free text); handled fatal paths and background jobs call `reportError` (deduplicated per request). Secrets referenced by name only — `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` — synced by the Edge Functions deploy stage (`deploy-functions.yml`) from the `EDGE_SENTRY_DSN` environment secret; without a DSN every failure still leaves one structured `edge_error` log line (D-202) | G41 |
| Health registry | ✅ `0463`: `ops` schema; `ops.health_checks` rows (key, area, severity, threshold, enabled), each pointing at a `stable` check function returning `ops.health_result` (count + data-free detail). `ops.run_health_checks()` runs every check in a read-only subtransaction that is always rolled back (no side effects, one failure never stops the rest). Checks: failed scheduled jobs, notification backlog, push failures, matching errors, rides bookings past confirm-by, rides open after departure, rides seats never completed. Open: WhatsApp outbound checks. Thresholds are rows, not code | G42 |
| Monitor + alert router | ✅ `ops-health.yml` (hourly, dev + prod via the existing `supabase-*` environments, Supabase Management API) → `scripts/ops/health-monitor.mjs`. The alert policy (`health-alerts.mjs`) plans open / update / resolve per (env, check); channels only execute it (`listOpen` + `apply`). Shipped channel: **GitHub issue** (one per check, deduplicated by a hidden marker, assigned to the PM → email, auto-closed on recovery; an unreadable report is itself a critical alert). Open: **WhatsApp** channel to the PM once the WhatsApp channel is live (D68); a short synthetic web check | G42 |
| Flow funnel | ✅ `0542`: `admin_world_flow_funnel(p_days)` (super admin / moderator), a cohort over the listings published in the window, per world and direction, read from existing handoff timestamps (published → booked → confirmed → completed / cancelled, plus closed and median hours to booking / handover); no client events needed. Feeds the KPI dashboards (16). Open: an admin screen to read it | G43 |
