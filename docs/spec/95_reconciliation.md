# 95 — Reconciliation: project book × legacy spec × code (2026-10-30)

Purpose: record what was **verified in the code** for the project book's claims, which legacy `docs/spec/requirements/*` FRs are **superseded** by book decisions, the **new implementation gaps** found (`G32+`), and the **questions that need a PM decision** (also listed in [92](./92_open_questions.md)).

Method: static reading of `dev` @ `fdc861d3` plus the book branch. No live database was queried. Evidence is cited as `file:line`.

Security findings are deliberately **not** listed here (README rule: never describe vulnerabilities publicly). They were reported privately to the PM.

---

## 1. Book claims verified against code

| Book claim | Section | Verified in code | Result |
|---|---|---|---|
| Title ≤ 80, description ≤ 500, ≤ 5 images, ≤ 20 open posts per private user | 7.2 / S34 | `packages/domain/src/invariants.ts:29,42,82,87` (`MAX_ACTIVE_POSTS = 20`, `MAX_MEDIA_ASSETS = 5`, `TITLE_MAX_CHARS = 80`, `DESCRIPTION_MAX_CHARS = 500`) | ✅ matches |
| Statuses include `hidden_pending_review` | 7.1 / S1 / D33 | `packages/domain/src/value-objects.ts:34-40` has `open`, `closed_delivered`, `deleted_no_recipient`, `expired`, `removed_admin` only | ❌ missing → refines **G20** |
| 3 reports on a post → hidden until human review | 7.15 / D33 | `supabase/migrations/0125_reports_freshness_window.sql:84-88`: 3 distinct reporters in **14 days** set the post to **`removed_admin`** | ❌ removes instead of hiding → refines **G20** |
| 5 reports on a user (distinct, 30 days) → suspended from actions | 7.15 / D33 / S11 | `0125:89-92`: **3** distinct reporters in **14 days** → `suspended_admin` | ❌ threshold and window differ → refines **G20** |
| (not in book) chats | — | `0125:93-95`: 3 reports remove a chat (`chats.removed_at`) | ❓ question Q-4 |
| Items and all requests have no expiry | 7.1 / D21 | `0153_post_expiry_cron.sql:35-39`: every `open` post expires after **300 days** (legacy FR-POST-012/013) | ❌ new gap **G32** |
| Karma values (§7.6 table) | 7.6 / D12 / S20 | `0189_karma_triggers.sql`: registration 1, post 5, removed −5, closure giver 20 + bonus, receiver 15, follower 1, first contact 1 — ✅. But `0384` / `0394` (items/food/rides handoffs on `listings`): giver **5**, receiver **3**; book: food 20/10, ride 25/10 | ❌ two closing systems with different values → refines **G16** + **G1** |
| Karma visible to owner only | 7.6 / D29 | `app/user/[handle]/index.tsx` rendered another user's karma (always empty: `karma_points` is not a public column, `userPublicColumns.ts:5`) | ✅ **fixed in this PR** (regression test `otherProfileKarmaHidden.test.ts`) |
| Ratings visible to admins only | 7.7 / D24 | `0193:69` `ride_ratings_select`, `0354:150` `giving_handoff_ratings_participant_read`: participants can read | ✅ **fixed** by migration `0446` (rater + super admin only; the summary view follows via `security_invoker`) — **G4** |
| 8 giving worlds incl. `experiences`; no "app design" world (D18) | 04 / D45 / D18 | `packages/domain/src/marketplace/MarketplaceTypes.ts:3-16`: 12 slugs — `money, items, food, medical, housing, rides, knowledge, time, animals, environment, creative, app_design`; no `experiences` | ❌ refines **G24**: `app_design` contradicts D18; `medical`, `animals`, `environment` are domains (D45); `creative` maps to the `culture` domain? (Q-3) |
| All worlds always shown; inactive = "not active yet" | 04 / D3 | `0441_world_launch_app_flags.sql`: per-world flags **hide** worlds from navigation; defaults: items, food on; **money, time, rides, knowledge, housing … off** | ❌ contradicts D3, and the phase table says `time` is "MVP, live" → question **Q-1** |
| Profile has no "marketplace" tab | 7.12 / D14 | `src/components/profile/ProfileMarketplaceListings.tsx` exists | ❌ confirms **G6** |
| Auth: Google, Apple, phone, email, guest | architecture/current.md | `SupabaseAuthService.ts` has no phone sign-in (legacy `TD-151`); phone exists only as a **verification** status (`0068`) | ❌ current.md corrected |
| `dev` is never behind `main` (`sync-main-to-dev.yml`) | architecture/current.md | The sync job force-pushes and is always rejected by `dev` protection (`TD-182`) | ❌ current.md corrected |
| TestFlight DB (D8 / G7) | architecture | `testflight-ios.yml:132-133` reads **repository-level** secrets `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` with no GitHub Environment, so the target project cannot be determined from the repo | ✅ **Made explicit (2026-10-30, `D-195` Mobile nightly):** tester builds (TestFlight, Play internal) now always use kc-dev, pinned by `scripts/mobile-store-config.mjs` and checked in the built bundle; the historical value is still not readable from the repo |

## 2. Legacy FRs superseded by the book (book wins, D35)

Each superseded legacy FR now carries a banner in its legacy file pointing here. The legacy text is kept unchanged as history.

| Legacy FR / rule | Superseded by | Book section |
|---|---|---|
| FR-POST-012 (`open → expired` at 300 days), FR-POST-013 (300-day expiry) | D21 — expiry per post type; items and requests never expire | 7.1 |
| FR-FEED-001 "no algorithm" | D27 — default sort is the recommendation engine | 7.3 |
| FR-RIDE-038 (rating visibility) | D24 — users never see ratings | 7.7 |
| `06_feed` "likes & comments not in MVP" | D25 — likes and comments on every post type | 7.9 |
| FR-DONATE-008 (link reachability rules) | D9 — org link goes live only after admin approval (implemented `0546`, 2026-11-03) | 08 |
| FR-MOD-005 thresholds (3 reports → auto-removal) | D33 — 3 on a post → hidden for review; 5 on a user → suspended from actions | 7.15 |
| FR-KARMA visibility | D29 — owner + main admin (legacy said owner only; compatible) | 7.6 |
| FR-RIDE-002–004, 023–025, 033–034 (legacy `ride_listings` hub, publish sheet, detail, driver dashboard, my requests, active-ride screens) | D70 — one rides flow on posts + handoffs; D71–D75 define places, map, bookings, saved routes, quick publish and feed | 5.3 |

## 3. New implementation gaps (G32+)

Also added to [93](./93_implementation_gaps.md).

| # | Gap | Section | Evidence |
|---|---|---|---|
| G32 | Expiry is a single 300-day rule for every post; D21 needs per-type expiry (food at expiry date, ride offer +30 min, event/ticket at date, items/requests none) | 7.1 | `0153_post_expiry_cron.sql:39` |
| G33 | Moderation status `hidden_pending_review` missing from the domain and DB; auto-moderation removes instead of hiding | 7.15 | `value-objects.ts:34-40`, `0125:84-95` |
| G34 | Two closing systems award different karma for the same act (posts closure 20/15 vs listings handoff 5/3) | 7.5 / 7.6 | `0189:63-64`, `0384:61-62`, `0394:56-57` |
| G35 | World list in code contains `app_design` (contradicts D18) and domain-type slugs (`medical`, `animals`, `environment`, `creative`) | 04 | `MarketplaceTypes.ts:3-16` |
| G36 | ✅ **Fixed in this PR.** "Forgot password" had no action (legacy FR-AUTH-008). Now `(auth)/forgot-password` → email link → `auth/reset-password`. **Ops step:** the hosted Supabase "Reset password" email template must link to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` (like the signup template), and the recovery OTP expiry set to 30 minutes (AC2) | auth | `app/(auth)/sign-in.tsx:128` |
| G37 | World launch flags hide worlds instead of showing "not active yet" (D3) | 04 | `0441_world_launch_app_flags.sql` |

## 4. Questions for the PM (copied to [92](./92_open_questions.md))

| # | Question | Why it blocks |
|---|---|---|
| Q-1 | **D3 vs launch flags:** should inactive worlds be *shown* as "not active yet" (D3), or *hidden* as `0441` does today? And are `time` and `money` live at launch (the phase table says "MVP, live", the flags default them off)? | **Answered 2026-10-30 → D60.** Navigation and the launch scope differ between book and code |
| Q-2 | **Moderation (D33):** confirm a post with 3 reports is **hidden for review** (not removed) and a user needs **5 distinct reporters in 30 days** (code: 3 in 14 days, and the user is suspended). | **Answered 2026-10-30 → D61.** Changing it relaxes today's protection; needs explicit approval |
| Q-3 | **Worlds in code that the book does not have:** `creative` → `experiences` world or `culture` domain? Remove `app_design` (D18)? Map `medical` / `animals` / `environment` listings to domains? | **Answered 2026-10-30 → D62.** Data migration of existing listings |
| Q-4 | **Chats:** today 3 reports remove a chat. The book does not cover chats in D33 — keep, or align with posts (hide for review)? | Undefined in the book |
| Q-5 | **Karma for listing handoffs:** apply the §7.6 values (food 20/10, ride 25/10) to the listing handoffs too (currently 5/3)? Retroactively? | **Answered 2026-10-30 → D63** (not retroactive). Changes users' karma totals |
| Q-6 | **TestFlight database (D8 / G7):** which Supabase project do the repository-level secrets used by `testflight-ios.yml` point to? Recommendation: move them into a dedicated GitHub Environment (`supabase-prod-clean`) so the target is explicit. | ✅ Answered by owner decision (`D-195` Mobile nightly): tester builds use kc-dev; prod store builds from `main` come later |
| Q-7 | **Supabase project refs:** `ENVIRONMENTS.md` and `CLAUDE.md` / `.mcp.json` name **different** projects as dev. Which is canonical? | Agents hold write authority on "dev" |
|  | ✅ **Q-7 answered by evidence (2026-10-30):** the deployed dev web bundle calls `enbqriuxvvuontiwslun`, matching `ENVIRONMENTS.md` (prod `kdqtbdbzwvlugkhonexg`). `roeefqpdbftlndzsvhfj` (MVP-2) and `slxijdfvinbjmrsfgbzx` (MVP-PROD) are **paused** projects in the older "KC" Supabase org. `DEPLOY_WEB.md` is corrected; `CLAUDE.md` §13 and `.mcp.json` / `app/.mcp.json` now point at kc-dev (PM-approved 2026-10-30). | |
| Q-8 | **Account deletion and shared chats:** deleting an account now removes the user's chat images. The counterpart keeps the (anonymized) chat, so those images disappear for them too. Confirm that right-to-be-forgotten wins over the counterpart's copy (current behavior), or keep them until the counterpart deletes the chat. | Privacy vs. counterpart experience |

## 5. SSOT hygiene notes

- **Tech-debt ID reuse.** Legacy spec headers cite `TD-69`, `TD-75` and `TD-79` for 2026-05-16 audit items, but the `tech-debt` issues now use those IDs for unrelated rows (migration-drift guard, translation provider, translate tests). When reading a legacy header, treat its TD reference as **historical** and use the `tech-debt` issues as the live register. New IDs must never reuse a number.
- **Migration registry.** `docs/agents/MIGRATION_RANGES.md` recorded `0440` for the world launch flags; the flags shipped as `0441`, and `0440` is the chat-media path change. Noted in the registry.
- **CI script tests.** Before this PR only 2 of the 8 `scripts/*.test.mjs` suites ran in CI, and two Edge Function test files (`delete-account`, `revenuecat-webhook`) were never executed. Both are now wired.
