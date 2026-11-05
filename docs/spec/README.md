# KC Product Spec (Project Book) — English, agent-oriented

> **Human source of truth:** the Hebrew page "KC – ספר הפרויקט (מקור אמת)" maintained by the PM (Nave) with the KC assistant. This folder is its English, AI-agent-friendly derivation. If the two disagree, the Hebrew page wins and this folder must be updated in the same week (decision **D35**, **D58**).
>
> Snapshot date: **2026-10-30**. Decisions **D1–D92** included.

## How to read

- `D#` — an approved PM decision. Full log: [`90_decisions_log.md`](./90_decisions_log.md).
- `S#` — a gap the assistant filled by context, **pending PM approval**. Treat as the working assumption, but do not hard-code irreversible behavior on an `S#` alone. List: [`91_kc_fills_pending.md`](./91_kc_fills_pending.md).
- `G#` — an implementation gap: the spec is clear, the code does not match yet. List: [`93_implementation_gaps.md`](./93_implementation_gaps.md).
- Detailed requirements (`FR-POST-*`, …, each with acceptance criteria) live in [`requirements/`](./requirements/), one file per domain (`FR-*` IDs are referenced from code and tests: never renumber). Where a book chapter and a requirement conflict, **the book wins** (D35); requirement files are being reconciled to it domain by domain (#1776).
- `PRD_V2_NOT_FOR_MVP/` at the repo root is a long-horizon vision source. It is a treasure: **never archive or delete it**; mine it when specifying later phases.

## Files

| # | File | Contents |
|---|---|---|
| 00 | [00_standing_goals_and_principles.md](./00_standing_goals_and_principles.md) | Standing goals (D58), working principles |
| 01 | [01_vision_mission_values.md](./01_vision_mission_values.md) | Vision, mission, values, north star |
| 02 | [02_problem_and_market.md](./02_problem_and_market.md) | Problem, market, opportunity |
| 03 | [03_users_personas_roles.md](./03_users_personas_roles.md) | Personas, roles and permissions |
| 04 | [04_product_structure.md](./04_product_structure.md) | One list of giving worlds with sub-categories, multi-world posts (D100), hub template (D36) |
| 05 | [05_giving_worlds.md](./05_giving_worlds.md) | The 12 giving worlds and their user journeys |
| 06 | [06_domain_hubs.md](./06_domain_hubs.md) | Former domains and where each one went (superseded) |
| 07 | [07_cross_cutting_systems.md](./07_cross_cutting_systems.md) | Post, form, feed, card, closing, karma, ratings, chat, engagement, notifications, profile, privacy, trust, moderation |
| 08 | [08_organizations.md](./08_organizations.md) | Orgs, org verification levels, events, volunteering, jobs, money, org finance & transparency (D76–D82), organization profile & accounts (D88–D92) |
| 09 | [09_emergency_mode.md](./09_emergency_mode.md) | Emergency mode (D42, D51, D56) |
| 10 | [10_challenges.md](./10_challenges.md) | Challenges layer (D43, D46, D52) |
| 11 | [11_governance.md](./11_governance.md) | Community governance (D40, D49, D50) |
| 12 | [12_partnerships.md](./12_partnerships.md) | Partnerships (D37) |
| 13 | [13_growth_gtm.md](./13_growth_gtm.md) | Growth and go-to-market, WhatsApp import (D38, D47, D54) |
| 14 | [14_roadmap.md](./14_roadmap.md) | Phase map |
| 15 | [15_risks.md](./15_risks.md) | Risks |
| 16 | [16_kpis.md](./16_kpis.md) | KPIs |
| 17 | [17_brand_and_design_system.md](./17_brand_and_design_system.md) | Brand identity, logo, design tokens, sync to Figma / Claude Design, voice and tone, guardrail tests (D65, D66, D67, D87, D93) |
| 18 | [18_knowledge_world.md](./18_knowledge_world.md) | Knowledge world: give & take posts, free library (courses with progress & quizzes, links, books, articles, videos), hub tabs, agent-readable storage and retrieval (D119); engineering contract `spec/requirements/23_knowledge.md` |
| 90 | [90_decisions_log.md](./90_decisions_log.md) | Product decisions (`D#`) |
| 91 | [91_kc_fills_pending.md](./91_kc_fills_pending.md) | KC fills pending approval (`S#`) |
| 92 | [92_open_questions.md](./92_open_questions.md) | Open questions for the PM |
| 93 | [93_implementation_gaps.md](./93_implementation_gaps.md) | Implementation gaps (`G#`) |
| 95 | [95_reconciliation.md](./95_reconciliation.md) | Book × legacy spec × code verification (2026-10-30), superseded FRs, PM questions Q-1…Q-8, SSOT hygiene notes |
| 96 | [96_launch_and_first_group_plan.md](./96_launch_and_first_group_plan.md) | Path to store launch and the first WhatsApp group migration: what the PM provides, decisions, run sheet |
| 94 | [94_glossary_and_naming.md](./94_glossary_and_naming.md) | Glossary + naming conventions |

## Requirements (`requirements/`)

One file per domain, each with FR-IDs, acceptance criteria and a status header. These are the contract that code and tests cite.

| File | Domain | FR prefix |
|---|---|---|
| [01_auth_and_onboarding.md](./requirements/01_auth_and_onboarding.md) | Authentication & Onboarding | FR-AUTH-* |
| [02_profile_and_privacy.md](./requirements/02_profile_and_privacy.md) | Profile & Privacy Mode | FR-PROFILE-* |
| [03_following.md](./requirements/03_following.md) | Following & Follow Requests | FR-FOLLOW-* |
| [04_posts.md](./requirements/04_posts.md) | Posts: Create, Edit, Discover | FR-POST-* |
| [05_closure_and_reopen.md](./requirements/05_closure_and_reopen.md) | Posts: Closure & Reopen | FR-CLOSURE-* |
| [06_feed_and_search.md](./requirements/06_feed_and_search.md) | Feed, Search & Filters | FR-FEED-* |
| [07_chat.md](./requirements/07_chat.md) | Direct Messaging | FR-CHAT-* |
| [08_moderation.md](./requirements/08_moderation.md) | Reports & Moderation | FR-MOD-* |
| [09_notifications.md](./requirements/09_notifications.md) | Notifications | FR-NOTIF-* |
| [10_statistics.md](./requirements/10_statistics.md) | Personal & Community Statistics | FR-STATS-* |
| [11_settings.md](./requirements/11_settings.md) | Settings | FR-SETTINGS-* |
| [12_super_admin.md](./requirements/12_super_admin.md) | Super Admin (in-chat moderation) | FR-ADMIN-* |
| [13_donations.md](./requirements/13_donations.md) | Donations Hub | FR-DONATE-* |
| [14_karma.md](./requirements/14_karma.md) | Karma Points | FR-KARMA-* |
| [15_rides.md](./requirements/15_rides.md) | Rides (Hitchhiking V2.0 → V3.0 — Carpooling for Good) | FR-RIDE-* |
| [16_public_research.md](./requirements/16_public_research.md) | Public Market Research | FR-RESEARCH-* |
| [17_responsive_desktop.md](./requirements/17_responsive_desktop.md) | Responsive Desktop | FR-RESP-* |
| [18_translation.md](./requirements/18_translation.md) | Cross-language UGC Translation | FR-TRANSLATE-* |
| [19_org_finance.md](./requirements/19_org_finance.md) | Organization Finance & Transparency | FR-FIN-* |
| [20_organizations.md](./requirements/20_organizations.md) | Organization Profile & Organization Accounts | FR-ORG-* |
| [21_housing.md](./requirements/21_housing.md) | Housing & Spaces (`housing`) — free space sharing | FR-HOUSING-* |
| [22_identity_verification.md](./requirements/22_identity_verification.md) | Identity verification (ID document + face) | FR-VERIFY-* |
| [23_knowledge.md](./requirements/23_knowledge.md) | Knowledge world — give & take, free library, courses, agent retrieval | FR-KNOW-* |

## Update procedure

1. A new PM decision is written into **every** section it touches, tagged `(D#)`; contradicting text is deleted.
2. Update cross-cutting files if relevant: glossary/naming (94), structure (04), roadmap (14).
3. Add a row to `90_decisions_log.md`.
4. An `S#` approved by the PM becomes a `D#`; a closed question is removed from 92; a code mismatch becomes a `G#`.
5. Every dev task / bug cites: spec section + code + automated test.
