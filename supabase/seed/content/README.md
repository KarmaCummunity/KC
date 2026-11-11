# Content seed (curated product content)

Rows a new environment ships with that are **content, not schema and not demo data**: the
lists of organization links, the legal texts, the in-app surveys and the platform
organization. They were exported once, read-only, from kc-dev (2026-11-11) and are the
version-controlled source from now on. Reference data (cities, streets, junctions, worlds,
post kinds, subcategories, world flags) stays in `../reference/`; demo data stays in `../kc-dev/`
and never reaches kc-prod.

```bash
# after the baseline and the reference data, before any member signs up
CONTENT_DB_URL=<connection URI of the target database> supabase/seed/content/load.sh
```

Idempotent (`insert … on conflict`, a row is written only when it differs; a second run
reports `0` changed), never deletes, no secrets, no personal data. `scripts/run-baseline-tests.sh`
loads reference and content on the baseline twice and runs `check.sql`; CI runs it.

| File | Rows | Lands in |
| --- | --- | --- |
| `data/donation_link_categories.csv` | 11 | `donation_link_categories` (icon, order; labels live in the app's locale files) |
| `data/donation_links.csv` | 86 | `donation_links`, curated (no submitter), approved after loading |
| `data/legal_document_versions.csv` | 2 | `legal_documents` pointer + `legal_document_versions` (terms, privacy, version 1, Hebrew) |
| `data/surveys.csv`, `survey_versions.csv`, `survey_questions.csv` | 3 / 3 / 8 | `surveys`, `survey_versions`, `survey_questions` |
| the platform organization (in `load.sql`) | 1 + 3 | `organizations` (Karma Community) + `billing.org_finance_accounts` (cash, Bit, Paybox, empty balances) |

`deferred/` holds content the baseline has **no table for yet** (its modules are not built,
or sit behind a flag that is off). Nothing loads it; it is kept so no curated row is lost
when the old migrations are archived: `world_links`, `external_bodies`, `knowledge_topics`,
`knowledge_topic_aliases`, `whatsapp_message_templates`, `kc_support_channels`,
`marketplace_rules`, `marketplace_rule_params`, plus the old catalog (`categories`,
`listing_kinds`) that the reference seed supersedes. Each module that gets a table loads its file.

## Classification of kc-dev (212 tables, read-only inventory)

| Class | What | Handling |
| --- | --- | --- |
| Real content / reference | NGO and volunteering links (86 in 11 lists), terms and privacy text, 3 surveys, platform org and its accounts, cities, streets, junctions, worlds, post kinds, subcategories | loaded (this seed and `../reference/`) |
| Real content, no baseline target yet | `world_links` 12, `external_bodies` 10, `knowledge_topics` 56 + aliases 78, `whatsapp_message_templates` 10 (draft/deprecated), `kc_support_channels` 2, `marketplace_rules` 17 + params 9 | `deferred/` |
| Superseded by the baseline | old catalog `listing_kinds` 40 and `categories` 90 (the baseline has its own kinds and subcategories in `../reference/`), `match_weights`, `matching_settings`, `feed_ranking_config`, `fsm_*`, `app_flags` for money/payments (baseline defaults and flags own them) | not copied (kept in `deferred/` where useful) |
| Configuration of the dev environment | `kc_dev_demo_*`, `app_flags` `dev_mock_identity_verification` and `sandbox_payments`, `payment_providers` sandbox, `research_secrets`, `ingestion_sources` (WhatsApp, flag off) | excluded |
| Demo / test | organization `[DEMO] בית לכל חיה`, the demo seed, E2E users (`@seed.kc.test`), seeded posts/comments/reactions/chats/messages | excluded; the demo seed stays in `../kc-dev/` |
| User-generated | users 210, auth identities, posts 870 and their media/stats/embeddings, handoffs, chats, messages, follows, saves, notifications, karma, reports, challenges 9 (created by test accounts), knowledge slots 9, survey answers | excluded, backed up in the dev backup |
| Runtime state | outbox, rate limits, impressions, caches, `embedding_jobs`, health checks, audit events | excluded |

### Needs Nave (excluded by default, or flagged)

1. **Legal texts are included but are drafts.** Both carry "טיוטה — ממתינה לבדיקה משפטית", name
   נוה סרוסי as the data controller and give `karmacommunity2.0@gmail.com`. They are loaded so sign-up
   works; confirm the names and the address, and the legal review, before real users.
2. **Extra worlds** the old catalog had that the baseline reference seed does not ship
   (environment, creative, romantic matchmaking, app design) and the 75 extra categories / 31 extra
   kinds: kept in `deferred/`, not loaded.
3. **`kc_support_channels`** (public Bit / PayBox links to support Karma Community): kept in `deferred/`;
   say if they should be live at launch (needs the money flag).
4. **Netanya content.** The inventory has no table or row named for Netanya. The only place-specific
   content is the city list. If "Netanya worlds" means something else (a group of posts, events, an
   organization), tell me where it lives; nothing user-generated was copied.
5. **Challenges (9)** were created by test accounts (a "בידקה" challenge among them): not content.
