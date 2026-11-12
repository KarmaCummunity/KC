# 2.23 Knowledge world — give & take, free library, courses, agent retrieval

> **Status:** 🟡 In progress — spec v0.1 (2026-11-03, PM scope decision `D119`; details are KC fills pending approval). FR-KNOW-001 shipped 2026-11-04 (`0570`). FR-KNOW-003 / FR-KNOW-004 one-off part shipped with #2034 (`0703`, `0704`): the six exchange post types on the one create form, slots as rows, booking a seat per slot with the giver's approval, session completion with the §7.6 karma; the open parts are listed under each FR. Also in code: four seeded sub-categories (`0535`), hybrid `search_listings` (`0262`) with a placeholder vector lane and a stub `embed-worker` (`TD-269`). **K1** `FR-KNOW-001..012`, **K2** `FR-KNOW-013..020`, **K3** `FR-KNOW-021..024`. Tester (development) builds open the knowledge world as an in-app feed regardless of `world_knowledge_enabled` (#1630); a production build follows the flag. Since migration `0613`, a published knowledge post is listed in the main feed from the moment moderation approves it (`worlds.feed_mirror` is on for knowledge).

Prefix: `FR-KNOW-*` · Migration range claimed: `0570–0589` (`docs/agents/MIGRATION_RANGES.md`) · Product spec (binding): [`docs/spec/18_knowledge_world.md`](../18_knowledge_world.md) · Decisions: `D40`, `D100`, `D101`, `D107`, `D119` · Fills: `S63`, `S64`, `S65`, `S66`, `S67`, `S68`, `S69`, `S70`, `S71`, `S72` · Engineering decision: `D-215` (`docs/SSOT/DECISIONS.md`).

---

## Scope

Two layers on one world (`docs/spec/18_knowledge_world.md` §18.2): **exchange posts** (lesson offer, mentoring offer, consulting hour, learning request, mentoring request, question) on the existing listing flow, and a **library** of durable **knowledge resources** (course, article, link, book, video, document, podcast, tool, dataset) with review, provenance, quality signals, chunks and embeddings. Both are placed on three axes: shelf (D100 sub-category), subject (topic graph), format (kind). One retrieval entry point serves the app, the WhatsApp bot and MCP agents.

### Baseline (reuse, do not re-build)

| Asset | Where | Reuse |
| ----- | ----- | ----- |
| `listing_kinds` rows for knowledge (`course`, `private_lesson`, `mentorship_request`) with `detail_schema` | `0241`, `0395`, `0540` | Renamed and extended into the six exchange post types (FR-KNOW-003). The `course` *listing kind* is retired: a course is a library resource (FR-KNOW-014); a course run is a lesson offer referencing it. |
| `book_knowledge_slot`, `complete_knowledge_session` on `giving_handoffs` | `0396`, `0390` | Kept as the booking and closing stage; slots become rows (FR-KNOW-004) instead of one `slot_starts_at` per listing. |
| `public.categories` tree per world + the four seeded knowledge sub-categories | `0241`, `0535` | The **shelf** axis. Two sub-categories are added to match D100 (rights & legal aid, lessons & mentoring); the PRD subject list (`tech`, `languages`, `stem`, …) moves to the topic graph (FR-KNOW-001). |
| `search_listings` (FTS + trigram + vector + geo, RRF), `listings.embedding`, `embedding_jobs`, `embed-worker` | `0262`, `0244`, `supabase/functions/embed-worker` | The fusion shape is reused by `knowledge_search`; the embedder is replaced by a real model (FR-KNOW-009, `TD-269`). |
| `api_bot_*` service contract (viewer id as a parameter, service role) | `0304` | Pattern for `api_knowledge_*` (FR-KNOW-010). |
| Community links `donation_links` + approval (D9, `0546`) and the `validate-donation-link` Edge Function | `0014`, `0546` | Pattern for link enrichment and review; knowledge community links stay as they are under the feed (D107). |
| Gemini client (`_shared/translation/gemini.ts`, `match-rerank`) | `supabase/functions/_shared` | AI enrichment (FR-KNOW-007) uses the same client and model configuration. |
| Owner management by status (D104, `0543`), blocking (D105, `0544`), reports (`reports`, 7.15) | `0543`, `0544`, `0452` | Apply unchanged to exchange posts; resources add their own report target (FR-KNOW-008). |

### Glossary

- **Shelf** — the knowledge world sub-category of D100 (`public.categories` under `knowledge`). Six values.
- **Topic** — a node of the topic graph (`knowledge_topics`): the subject axis. Has aliases.
- **Kind** — the format of a post (`knowledge_post_kind`) or resource (`knowledge_resource_kind`).
- **Knowledge resource** — a library entry (`knowledge_resources`). Native (body stored in KC) or external (a link with metadata).
- **Chunk** — a retrievable passage of a native resource or a community answer, with heading path and embedding (`knowledge_chunks`).
- **Community answer** — a question post plus its accepted answer, indexed as a chunk.
- **Enrichment** — server-side metadata fetch (link enrichment) and AI suggestions (AI enrichment). Suggestions are hints; contributor text wins.
- **Completion record** — a KC community record of finishing a course (`knowledge_completions`); not an accredited certificate.

### Non-goals (K1–K3)
- Paid content of any kind; payment links; affiliate links. Refused at review.
- File uploads (PDF, slides) in K1 (`S71`); links and native markdown only. Revisited for K2 with a private bucket and copyright attestation.
- Accredited certificates; integration with external LMS (SCORM, xAPI).
- Live video inside KC; sessions happen on the giver's chosen channel (phone, video link, in person).
- Group chat for study groups before cohorts (K3), per 7.8.

---

## K1 — exchange, library of external resources, search, agent API

## FR-KNOW-001 — Topic graph (subject axis)

**Description.** A curated topic tree with aliases, used by posts, resources, filters, follows and the agent API (`18 §18.3`, `S64`).

**Acceptance Criteria.**
- AC1. Table `knowledge_topics(topic_id, slug unique, parent_id, label_he, label_en, description_he, status in (active, proposed, merged), merged_into_id, sort_order, created_by, approved_by, created_at)` and `knowledge_topic_aliases(topic_id, alias, lang in (he, en, other), unique (lower(alias)))`. Depth ≤ 4 (enforced by trigger). Cycles rejected.
- AC2. Seed migration: the PRD subject list (`PRD_V2_NOT_FOR_MVP/donation_worlds/07_Knowledge.md` §3) and the existing `categories` subject rows (`tech`, `languages`, `stem`, `professional`, `arts`, `cooking`, `personal_development`, `parenting`) become **topics**, not shelves; the `categories` rows are deactivated (`is_active = false`), never deleted; existing listings keep their `category_id` and gain the matching topic (data migration).
- AC3. Shelves: `categories` under `knowledge` are exactly the six D100 values (`science_technology`, `history_heritage`, `culture_art`, `spirituality_philosophy`, `rights_legal_aid`, `lessons_mentoring`); the two missing rows are seeded (idempotent, `0535` pattern).
- AC4. `resolve_knowledge_topics(p_text text) returns setof topic_id`: matches query terms against slugs, labels and aliases (case-insensitive, unaccent, final-letter normalized for Hebrew) and returns the matched topics plus their descendants. Used by search (FR-KNOW-009) and the form's auto-suggest.
- AC5. Any member may **propose** a topic from the contribute / create form (status `proposed`, used at once); admins (`is_listing_operator`) approve, rename or **merge**. A merge sets `status = merged`, `merged_into_id`, re-points every `knowledge_post_topics` / `knowledge_resource_topics` row, and inserts the old slug as an alias of the target. Links by old slug keep resolving.
- AC6. RLS: everyone reads active and proposed topics; only operators write status / merges; a proposer may edit their own proposed topic's labels until approved.
- AC7. Tests: `supabase/tests/0570_knowledge_topics.sql` — depth cap, cycle rejection, alias resolution with Hebrew final letters, merge re-pointing and alias creation.

**Tech (✅ 2026-11-04, `0570`):** `knowledge_topics` (+ `legacy_category_slug` for AC2's mapping), `knowledge_topic_aliases` (`alias_norm` generated by `knowledge_normalize_text`, unique), `knowledge_topic_follows` (own rows by RLS); triggers `knowledge_topics_enforce_tree` (depth ≤ 4 including a re-parented branch's height, cycles, no merged parent); RPCs `resolve_knowledge_topics`, `propose_knowledge_topic` (≤ 10 open proposals, slug may not shadow an alias), `update_my_proposed_knowledge_topic`, `review_knowledge_topic` (approve / reject / rename / merge via `knowledge_topic_merge`: children, followers and aliases move, old slug + labels become aliases), `add_knowledge_topic_alias`; 11 root + 45 child seed topics with aliases; the `tech` … `parenting` subject rows of `categories` are deactivated as shelves. Code: `@kc/domain` `knowledge/knowledgeTopics.ts` (shelves, types, `normalizeKnowledgeText`, `buildKnowledgeTopicTree`, proposal / selection validation), `@kc/application` `knowledge/*` (port `IKnowledgeTopicRepository`, `KnowledgeTopicError`, list / resolve / propose / review / follow use cases), `SupabaseKnowledgeTopicRepository`. The existing-listing part of AC2 (topic per `category_id`) moves to FR-KNOW-002's data migration.

## FR-KNOW-002 — Shelf, topics and kind on every knowledge object

**Acceptance Criteria.**
- AC1. Exchange posts require `category_id` (shelf) and a row in `knowledge_post_topics(post_id, topic_id, is_primary)` with exactly one primary and ≤ 4 additional topics; enforced by trigger at publish (`posts_knowledge_axes_check`, error `knowledge_topic_required`). Keyed on `posts`, since the knowledge create flow (FR-KNOW-003) lands after G1-S2 makes `posts` the source of truth for every category (ADR-006); a knowledge `listings` row today is never published through this path (the 0266 trigger keeps it in review). The data migration maps each existing knowledge listing's `category_id` to the topic whose `legacy_category_slug` matches.
- AC2. Resources: `knowledge_resource_topics(resource_id, topic_id, is_primary)` with the same cardinality.
- AC3. Free tags: `tags text[]` ≤ 10, each ≤ 30 chars, lower-cased; never required.
- AC4. The create form and contribute flow show the shelf picker (six chips with the shelf rule text of `docs/spec/06_domain_hubs.md`), then a topic picker with search over aliases and "propose a topic".
- AC5. Tests: trigger rejects a knowledge listing with no primary topic and with two primaries.

## FR-KNOW-003 — Exchange post types on the one create form

**Description.** Six post types (`18 §18.4`) replace the three legacy knowledge listing kinds. One form per type (D28) inside the one create form (D107, FR-POST-001 AC6).

**Acceptance Criteria.**
- AC1. `listing_kinds` for `knowledge` become: `lesson_offer` (give), `mentoring_offer` (give), `consulting_hour` (give), `learning_request` (request), `mentoring_request` (request), `question` (request). `private_lesson` is renamed to `lesson_offer`; `course` is deactivated (`is_active = false`) and its open listings migrate to `lesson_offer` with `details.course_resource_id` null; `mentorship_request` is renamed. `detail_schema` per kind as in the table below; `0540` enforcement applies.
- AC2. Detail schemas (additionalProperties false):
  - `lesson_offer`: `level`, `modality in (in_person, video, phone)`, `language text[]`, `capacity_per_slot 1–20`, `recurring {weekdays int[], time, until}` optional, `resource_ids uuid[]` optional (library resources used), `availability_note ≤ 280`.
  - `mentoring_offer`: `audience text[]` (career_change, students, new_immigrants, youth_18plus, seniors, other), `cadence in (weekly, biweekly, monthly, flexible)`, `seats 1–10`, `modality`, `language`.
  - `consulting_hour`: `profession in (lawyer, accountant, tax_advisor, social_worker, employment_rights, housing_rights, consumer_rights, other)`, `modality`, `capacity_per_slot 1–5`, `disclaimer_accepted const true`.
  - `learning_request`: `level`, `preferred_modality`, `availability_note`, `language`.
  - `mentoring_request`: `goal ≤ 280`, `cadence`.
  - `question`: `question ≤ 500` (the listing `summary` holds it too), `context_url` optional.
- AC3. Location: offers city or `remote`; requests city; question none. Photo: none required. Expiry (D21): `lesson_offer` and `consulting_hour` close 30 min after their last slot ends (one-off) — recurring and all others never expire and get the relevance reminder (D59). A `question` auto-closes 30 days after an accepted answer.
- AC4. A lesson offer may be marked for the `time` world (D101, G51); until G51 ships the form shows the switch disabled with "soon".
- AC5. Rename the UI copy: `knowledge` category chip in the create form, request / offer wording per type, in `apps/mobile/src/i18n/locales/he/`.
- AC6. Tests: `listingFieldSpecs` unit tests per kind; DB test `0571_knowledge_post_kinds.sql` (schema enforcement, expiry sweep on a one-off lesson, no expiry on a recurring one).

- **Implementation (#2034, `0703`).** Shipped: the six kinds with their schemas, the 30-minute-after-the-last-slot expiry of
  a lesson offer and a consulting hour (`posts_world_knowledge_rules`, swept hourly by `knowledge_offers_expired_sweep`), the forms
  (`knowledgeFieldSpecs.ts`) and the copy. Differences from the ACs above:
  - AC1: `course`, `private_lesson` and `mentorship_request` are deactivated, not renamed; the new kinds are new rows. Open legacy
    posts move to `lesson_offer` (one slot each, from `slot_starts_at` / `slot_ends_at`) or `mentoring_request`, so bookings and
    links keep their ids. A legacy post that was not moved keeps the legacy rules.
  - AC2: every kind also carries `topic` (free text, 2–80) until topics are linked to posts (#2036). A lesson offer and a consulting
    hour hold their times in `details.slots` (`[{starts_at, ends_at}]`, 1–20, 15 min to 8 h each, no overlap, a new one in the
    future); `recurring` comes with #2035. A request uses `preferred_modality`; a `question` holds its text in the post title and
    description, with `topic` and `context_url` in `details`.
  - AC4 (the `time` world switch) waits for G51. AC6: the DB test is `supabase/tests/0703_knowledge_post_kinds.sql`.

## FR-KNOW-004 — Slots, booking and session completion

**Acceptance Criteria.**
- AC1. `knowledge_slots(slot_id, listing_id, starts_at, ends_at, capacity, booked_count, status in (open, full, cancelled, done), series_key)`; one-off offers insert the slots the giver picked (≤ 20 per listing); a recurring offer materializes slots 30 days ahead by a 10-minute sweep (`knowledge_slots_materialize`, the `ride_series_materialize` pattern, D103) and the giver may pause / resume / cancel the series.
- AC2. `book_knowledge_slot(p_slot_id)` replaces the listing-level RPC: locks the slot, refuses `own_listing`, `slot_started`, `already_booked`, `slots_exhausted`, inserts a `giving_handoffs` row (`world_slug = knowledge`, `slot_starts_at/ends_at`, `confirm_by = now() + 24h`), increments `booked_count`. The giver confirms or declines (`confirm_giving_handoff` / `decline_*` as today); an unconfirmed booking expires at `confirm_by` or at `starts_at`, whichever is earlier, and frees the seat (D96 pattern).
- AC3. `complete_knowledge_session(p_handoff_id)` stays; karma moves to the table values of `docs/spec/07_cross_cutting_systems.md` §7.6 (`S72`): giver 10 per hour of the slot (rounded up to the half hour, cap 80/day, D32), learner 5; volunteering hours are written for the giver (7.10) when the post is also in `time`.
- AC4. A learning / mentoring request closes with "found a teacher" (links the booking handoff) or "found it in the library" (links a `resource_id`); both grant the request's closing karma once.
- AC5. Notifications (`important`): booking requested (giver), approved / declined (learner), 24h reminder (both), slot cancelled (booked learners). Per-slot grouping.
- AC6. Tests: `0572_knowledge_slots.sql` — concurrency on the last seat, expiry of an unconfirmed booking, series materialization and cancel with a booked slot kept; the knowledge flow on the shared harness (`supabase/tests/flows/knowledge_lifecycle.sql`, closes the open part of G38).

- **Implementation (#2034, `0703`, `0704`).** Shipped the one-off part. Differences from the ACs above:
  - AC1: `knowledge_slots(slot_id, post_id, starts_at, ends_at, capacity, status in (open, cancelled))`, keyed by the post (one Post
    model, ADR-006). `details.slots` is what the giver edits; a trigger keeps the rows in step and refuses to remove, move or
    shrink below its bookings a slot a learner holds (`knowledge_slot_has_booking`, `knowledge_slot_capacity_below_bookings`).
    There is no `booked_count`: places left are counted from the live bookings (reserved, confirmed, held), so no counter can
    drift; `full` and `done` are read, not stored. `series_key` and the materialize sweep come with #2035.
  - AC2: the slot entry point is `book_knowledge_seat(p_slot_id)` (it also refuses `account_not_active`, `slot_not_found` and
    `listing_not_available`); bookings are `post_handoffs` rows with `knowledge_slot_id`, and `confirm_by` is the earlier of 24 h
    and the slot start. The giver answers with `confirm_knowledge_booking` / `decline_knowledge_booking`; a booking unanswered at
    `confirm_by` is cancelled as `expired` by a 10-minute sweep. `book_knowledge_slot(p_listing_id)` stays only for builds
    released before #2034 and books the soonest slot with a free place (removal: #2050). The learner sees upcoming times and
    the times they booked in the last 7 days (`list_knowledge_slots`); the giver sees every booking (`list_knowledge_bookings`).
  - AC3: done, through `karma_award_handoff` (5 per started half hour, the 80-a-day cap counted on the Israel calendar day;
    learner 5). Either side may mark an approved session held from 15 minutes before it starts; a booking the giver has
    not answered yet cannot be marked held (the app does not offer it, #2207). Volunteering hours wait for G51.
  - AC4 and the 24 h reminder of AC5: #2039. AC5 otherwise: pushes for a requested, approved, declined, expired or cancelled
    booking and a held session, one per booking.
  - A `mentoring_offer` has no join flow yet; it is arranged in chat (#2051).
  - AC6: `supabase/tests/0704_knowledge_slot_bookings.sql` (including two learners on the last place) and
    `supabase/tests/flows/knowledge_lifecycle.sql`.

## FR-KNOW-005 — Question with accepted answer

**Acceptance Criteria.**
- AC1. A `question` post uses comments (7.9) as answers. `accept_knowledge_answer(p_listing_id, p_comment_id)`: asker only, one accepted answer at a time (re-accepting replaces), writes `listings.details.accepted_comment_id`, grants the answerer 5 karma once per question and the asker's "question asked" 2 at publish (cap 5/day).
- AC2. The accepted answer is pinned on the post detail with an "accepted" chip; the asker may close the question; it auto-closes 30 days after acceptance.
- AC3. On acceptance, a `knowledge_chunks` row of `source_type = community_answer` is written (question + answer + topics) and embedded (FR-KNOW-009), removed if the answer is deleted or the post is removed.
- AC4. Tests: `0573_knowledge_questions.sql` — only the asker accepts, replace accepted, karma once, chunk written and removed.

## FR-KNOW-006 — Knowledge resources (library entity)

**Description.** The library entity of `D-215` and `18 §18.5.1`.

**Acceptance Criteria.**
- AC1. Table `knowledge_resources`:
  `resource_id uuid pk, slug text unique, kind knowledge_resource_kind (course, article, link, book, video, document, podcast, tool, dataset), source in (native, external), title ≤ 120, summary ≤ 300, language text[] not null, level in (none, beginner, intermediate, advanced), estimated_minutes int, category_id (shelf) not null, tags text[], source_url text, source_url_canonical text, source_url_hash text, publisher text, author text, license in (public_domain, cc_by, cc_by_sa, cc_by_nc, cc_other, free_access, author_permission), authority_tier in (official, verified_org, community), org_id uuid null, contributor_id uuid not null, contributor_note ≤ 500, detail jsonb (per-kind schema in knowledge_resource_kinds.detail_schema), status in (draft, pending_review, published, rejected, archived, broken_link), rejection_reason, reviewed_by, reviewed_at, published_at, last_verified_at, link_status in (ok, redirected, broken, unchecked), helped_count, save_count, completion_count, report_count, ai_summary, ai_keywords text[], ai_questions_answered text[], ai_prerequisites text[], ai_audience text, ai_generated_by, ai_generated_at, ai_stale bool, search_vector tsvector generated, embedding vector, embedding_model, created_at, updated_at`.
- AC2. `knowledge_resource_kinds(kind, label_he, label_en, detail_schema jsonb, primary_action in (open_link, read, start_course, watch, listen))`; `detail` validated against the schema at insert / update (the `0540` validator). Examples: `book {isbn, year, free_access_kind in (open_access, public_library, author_site, items_world), pages}`; `video {provider in (youtube, vimeo, other), provider_id, duration_seconds, captions text[]}`; `course {provider, is_self_paced, has_quizzes, outline_resource_id}`; `document {file_type, pages}`.
- AC3. Invariants: `is_free` is implied — there is no price column and the review checklist refuses paid content; an external resource requires `source_url` (`^https?://`), normalized (`knowledge_canonical_url`: lower-cased host, no tracking query params, no fragment, trailing slash trimmed) and unique per `source_url_hash` among non-rejected rows (duplicate attempts return `resource_duplicate` with the existing id); a native resource requires a body (FR-KNOW-013) before publish.
- AC4. Versions: `knowledge_resource_versions(resource_id, version int, snapshot jsonb, edited_by, edited_at)`; every published edit writes a version; `ai_stale = true` on any human edit of title / summary / contributor_note / body.
- AC5. RLS: anyone reads `published`; the contributor reads their own rows in any status; operators read all; inserts go through `submit_knowledge_resource` (FR-KNOW-007); updates by the contributor only while `draft` / `pending_review` / `rejected` (resubmit) and for `contributor_note` after publish; status transitions only via RPCs.
- AC6. Member actions: `save_knowledge_resource` (toggle; `knowledge_saves(user_id, resource_id)`), `mark_knowledge_helpful` (toggle, one per member, `knowledge_helpful_votes`; grants the contributor 1 karma per distinct voter, cap 20/day), `report` via the existing `reports` with `target_type = knowledge_resource` (3 reports → `pending_review` + admins notified, 7.15).
- AC7. Tests: `0574_knowledge_resources.sql` — canonical URL cases, duplicate detection, kind schema validation, RLS per status, helpful once per member, version on edit.

## FR-KNOW-007 — Contribute flow: link enrichment, AI enrichment, review

**Acceptance Criteria.**
- AC1. Edge Function `knowledge-link-enrich` (authenticated member; rate limit 20/hour): input `url` → fetches the page (10 s timeout, 1 MB cap, follows ≤ 3 redirects, blocks private networks), returns `{canonical_url, title, description, image_url, site_name, language_guess, kind_guess, provider, provider_id, duplicate_of}`. No page content is stored beyond these fields.
- AC2. Edge Function `knowledge-ai-enrich` (service role, queue-driven): for a resource in `pending_review` or `published` with `ai_stale = true`, calls the configured model (Gemini client of `_shared`) with title, summary, contributor note, metadata and (native) body ≤ 8k tokens, and writes `ai_summary`, `ai_keywords`, `ai_questions_answered`, `ai_prerequisites`, `ai_audience`, suggested shelf and topics (`knowledge_resource_ai_suggestions(resource_id, shelf_slug, topic_slugs, confidence)`), `ai_generated_by`, `ai_generated_at`, `ai_stale = false`. It never writes `title`, `summary`, `contributor_note` or topics.
- AC3. Contribute UI (mobile + web): paste link → enrichment preview (editable) → shelf + topics (AI suggestions pre-selected, labelled "suggested") → license / free-access statement + shelf rules acknowledgement → submit. "Write an article" and "build a course" entry points are K2 (FR-KNOW-013/014); in K1 they show "soon".
- AC4. `submit_knowledge_resource(p_input jsonb)`: validates, canonicalizes, checks duplicates, inserts `pending_review` (or `published` for a trusted contributor, FR-KNOW-021), enqueues AI enrichment and, on publish, embedding. Karma 5 on publish (cap 5/day), reversed on later rejection / removal (S20 pattern).
- AC5. Review queue (admin portal, `/admin/knowledge`): list pending (oldest first, filters by shelf / kind), detail with the AI suggestions as hints and the per-shelf checklist, actions `approve` (optionally editing shelf / topics / level / authority tier), `reject` with reason (notifies the contributor, `important`), `request changes`. `review_knowledge_resource(p_resource_id, p_action, p_reason, p_overrides)`; operators only; every action audited (`admin_audit`).
- AC6. Tests: Edge Function unit tests (SSRF guard, redirect cap, kind guess for YouTube / ISBN / PDF); DB test `0575_knowledge_review.sql` (state machine, karma grant and reversal, audit row).

## FR-KNOW-008 — Resource detail, cards, library tab, follow a topic

**Acceptance Criteria.**
- AC1. Hub (`WorldHubConfig` for knowledge): search header + three tabs (`לתת ולקבל` default, `ספרייה`, `הלמידה שלי`) per `18 §18.6` (`S66`); the D107 community links list stays under the feed tab.
- AC2. Library tab: `list_knowledge_resources(p_filters jsonb, p_sort, p_cursor)` keyset-paginated; filters shelf, topic (with descendants), kind, level, language, max minutes, authority tier, free-access kind; sorts `recommended` (score = helped, completions, freshness, authority, link ok), `new`, `most_helpful`. Topic browser: `knowledge_topic_counts` (materialized, refreshed every 10 min) gives resources / teachers / open requests per topic.
- AC3. Resource card: kind icon, title, provider domain or author, shelf chip, level, duration, languages, "helped N", save toggle; course card adds progress when enrolled (K2).
- AC4. Resource detail (`/donations/knowledge/resource/[slug]`, web export indexable when published): envelope, primary action by kind (external links open in the in-app browser with "opens an external site"), provenance block, quality block, **"people who teach this"** = open `lesson_offer` / `mentoring_offer` / `consulting_hour` listings sharing a topic (visible to the viewer, block filtering applied), **"people who want to learn this"** = open requests and questions on the topic, related resources (vector neighbours, FR-KNOW-009), "questions this answers" (`ai_questions_answered`), report, share. `broken_link` shows a notice and "I found the new link" (opens the contribute flow pre-filled as a replacement).
- AC5. Follow a topic: `knowledge_topic_follows(user_id, topic_id)`; a newly published resource or a new offer on a followed topic (or its descendants) notifies followers (`social`, max 3/day, D10). "Topics I follow" in the third tab.
- AC6. Exchange post card: uniform card (7.4) + topic chip + modality icon; a consulting hour detail shows the profession, the giver's verification level (D23) and the disclaimer text of `18 §18.9`.
- AC7. Tests: component tests for the three tabs and the resource card states; Maestro flow `knowledge_library_browse` (open hub → library tab → filter by topic → open resource → save); DB test for `list_knowledge_resources` filters and descendant topic expansion.

## FR-KNOW-009 — Knowledge search: one retrieval call, real embeddings

**Acceptance Criteria.**
- AC1. `knowledge_chunks(chunk_id, resource_id null, listing_id null, source_type in (resource_meta, resource_body, lesson, community_answer), version int, ordinal int, heading_path text[], text ≤ 2,000 chars, token_count, lang, search_vector generated, embedding vector, embedding_model, updated_at)`; exactly one of `resource_id` / `listing_id`. External resources get one `resource_meta` chunk (title + summary + contributor note + ai_questions_answered); native bodies are chunked by headings then by ~400 tokens with 40 overlap (K2).
- AC2. Embeddings: `knowledge_embedding_jobs` (the `embedding_jobs` pattern) drained by `embed-worker`, which gains a real provider behind `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` env names (secret names only; the default is the multilingual embedding model of the provider already configured for Gemini). Vector dimension is read from the model config at deploy; columns are created with that dimension by the migration (`TD-269` is closed for knowledge; listings follow in a later task).
- AC3. `knowledge_search(p_query text, p_filters jsonb, p_limit int ≤ 50, p_viewer uuid default auth.uid()) returns table (hit_type in (resource, chunk, post, topic, teacher), id, resource_id, listing_id, topic_id, title, snippet, heading_path, score, fts_rank, trgm_rank, vector_rank, topic_rank, citation jsonb)`: RRF over four lanes — FTS (`simple` + unaccent, Hebrew and English tokens), trigram on titles and topic aliases, vector cosine over `knowledge_chunks` + `knowledge_resources.embedding` (query embedded by the worker's provider through `knowledge_embed_query` cache table `knowledge_query_embeddings(hash, embedding, created_at)` with 7-day TTL), topic lane (`resolve_knowledge_topics` + descendants). Filters as in FR-KNOW-008 AC2 plus `hit_types`. Posts respect `is_listing_visible_to(p_viewer)` and block filtering; resources only `published`. `citation = {resource_id, slug, version, heading_path, contributor_id, reviewed_at, license, authority_tier, last_verified_at}`.
- AC4. `similar_knowledge_resources(p_resource_id, p_limit)`: vector neighbours among published resources sharing at least one topic ancestor.
- AC5. Search header suggestions: `knowledge_suggest(p_prefix)` returns topics (by alias prefix), resources (title trigram) and teachers (open offers' topics) in ≤ 100 ms p95 on the dev dataset.
- AC6. Tests: `0576_knowledge_search.sql` — a Hebrew query finds an English-titled resource through a topic alias; a chunk hit carries its heading path; a blocked member's post never appears; a `pending_review` resource never appears; RRF ordering with a forced tie.

## FR-KNOW-010 — Agent contract (`api_knowledge_*`, MCP)

**Description.** `S67`, `18 §18.7`. Service-role wrappers in the `api_bot_*` style (`0304`): the caller passes the member it acts for; the data layer applies that member's visibility.

**Acceptance Criteria.**
- AC1. `api_knowledge_search(p_viewer_id uuid null, p_query text, p_filters jsonb, p_limit int)` → `knowledge_search` as that viewer (anonymous when null).
- AC2. `api_knowledge_get_resource(p_resource_id | p_slug, p_include in (envelope, outline, chunks))` → envelope + provenance + quality + topics; with `outline` the course outline (K2); with `chunks` the chunks in order (published resources only).
- AC3. `api_knowledge_topic_map(p_root_slug null, p_depth ≤ 4)` → the tree with per-topic counts (resources by kind, open offers, open requests, unanswered questions).
- AC4. `api_knowledge_demand(p_topic_slug null, p_days ≤ 90)` → open requests and unanswered questions per topic with no published resource and no open offer: what the community is missing.
- AC5. `api_knowledge_suggest_topics(p_text)` → `resolve_knowledge_topics` + the AI suggestion path (no write).
- AC6. `api_knowledge_submit_resource(p_contributor_id, p_input jsonb)` → `submit_knowledge_resource` as that member (always `pending_review`; never trusted-path).
- AC7. Every function: `revoke all from public`, `grant execute to service_role`; input bounds (`0537` pattern); a `comment on function` that states the contract. MCP tool descriptions for these six functions are added to the bot tool registry (`supabase/functions/_shared/whatsapp/agent/`), and the WhatsApp intake bot answers "where can I learn X for free" with up to three cited resources and one open offer.
- AC8. Tests: `0577_knowledge_api.sql` — anonymous viewer sees no `FollowersOnly` post; demand excludes topics with a published resource; submit lands in review even for a trusted contributor.

## FR-KNOW-011 — Link health

**Acceptance Criteria.** (`S68`)
- AC1. Weekly cron `knowledge-link-health` (service role): HEAD then GET on every published external resource (batched, 2 req/s, 10 s timeout); writes `link_status`, `last_verified_at`; a 3xx to a new canonical URL sets `redirected` and stores the new URL in `detail.redirect_url`.
- AC2. Two consecutive failures → `status = broken_link` (hidden from the library and search; the detail page stays reachable by direct link with the notice of FR-KNOW-008 AC4); the contributor is notified (`social`); 30 days without a fix → `archived`.
- AC3. "I found the new link" submissions are reviewed like new resources and, on approval, replace `source_url` on the original resource (same id, new version) and restore `published`.
- AC4. Tests: Edge Function unit tests with a stubbed fetch; DB test for the two-strike rule and restore-on-fix.

## FR-KNOW-012 — Rules, disclaimers and roles

**Acceptance Criteria.**
- AC1. A `consulting_hour` can be published only by an ID-verified member (`S70`; `verification_level >= id`) with a declared profession; the server refuses otherwise (`consulting_requires_id_verification`). The post and every booking chat show the disclaimer of `18 §18.9`.
- AC2. Resources and posts on the `rights_legal_aid` shelf show the "not binding advice" notice and a link block to the official bodies configured for the shelf (`knowledge_shelf_links`, KC-team content, S18).
- AC3. Shelf rules of `docs/spec/06_domain_hubs.md` (no missionary content; no divisive heritage content; a source per heritage item) are shown at the contribute step and in the reviewer checklist; the checklist is data (`knowledge_review_checklists(shelf_slug, items jsonb)`), editable by super admins.
- AC4. "Everything here is free" is shown on the library tab header and on the contribute step; the review `reject` reasons include `paid_content`, `copyright`, `not_free_access`, `advice_binding`, `shelf_rule`, `low_quality`, `duplicate`.
- AC5. Tests: consulting hour refused without ID verification; shelf notice rendered for `rights_legal_aid`.
- **Implementation (#2034).** AC1 server gate shipped (`posts_world_knowledge_rules`, `user_verification_level < 2`, tested in `0703`); the form-side check, the disclaimers and AC2 come with #2038.

---

## K2 — native content, courses, progress, quizzes

## FR-KNOW-013 — Native articles (bodies, versions, chunks)

**Acceptance Criteria.**
- AC1. `knowledge_resource_bodies(resource_id, version, body_md text ≤ 60,000 chars, word_count, toc jsonb)`; `body_md` is sanitized markdown (headings, lists, links, images by URL only, code, quotes; no raw HTML, no scripts); the version matches `knowledge_resource_versions`.
- AC2. Chunking on publish and on every new version (FR-KNOW-009 AC1); old version chunks are deleted after the new ones are embedded (no gap in search).
- AC3. Article reader screen: RTL-aware markdown renderer of the shared kit (17 §4.1), reading progress, table of contents, "helped me", save, report, provenance footer with the license.
- AC4. The contribute flow gains "write an article" (mobile and web): title, summary, shelf, topics, body editor with preview, license (native text defaults to `cc_by_sa`), submit to review.
- AC5. Tests: sanitizer unit tests; chunking determinism test (same body → same chunk boundaries); DB test for version / chunk replacement.

## FR-KNOW-014 — Courses: modules, lessons, quizzes (author side)

**Acceptance Criteria.**
- AC1. A course is a `knowledge_resources` row of `kind = course` with `knowledge_course_modules(module_id, resource_id, ordinal, title, summary)` and `knowledge_course_lessons(lesson_id, module_id, ordinal, title, lesson_kind in (text, video, external, reading), body_md null, video_url null, external_url null, reading_resource_id null, estimated_minutes, is_preview bool)`. ≤ 20 modules, ≤ 30 lessons per module. Lesson text bodies are chunked like articles (`source_type = lesson`).
- AC2. `knowledge_quizzes(quiz_id, resource_id, module_id null, lesson_id null, title, pass_percent default 70, version int)`; `knowledge_quiz_questions(question_id, quiz_id, ordinal, kind in (single, multiple, true_false, short_text), prompt_md, options jsonb, correct jsonb, explanation_md, points default 1, version int)`; a quiz attaches to a lesson, a module or the whole course; editing a question after any attempt bumps its version (attempts keep the version they answered).
- AC3. Course builder (web export first; mobile reads and edits metadata): outline editor with drag order, lesson editor (markdown / video link / external link / reading from the library), quiz editor with preview, "publish" runs the review (FR-KNOW-007) — a course with zero lessons cannot be submitted; a course with `has_quizzes` must have at least one quiz with ≥ 3 questions.
- AC4. **External course tracking shell:** an external `course` resource may carry modules and lessons with `lesson_kind = external` only (a syllabus), so learners track it (FR-KNOW-015) and take KC quizzes the contributor wrote.
- AC5. Author sees aggregate counts only (enrolled, completed, average quiz score); never individual learners (D110, privacy by construction).
- AC6. Tests: outline limits; question version bump on edit after an attempt; publish gate (no lessons / quiz too small); DB test `0578_knowledge_courses.sql`.

## FR-KNOW-015 — Enrollment, progress, quiz attempts, completion (learner side)

**Acceptance Criteria.**
- AC1. `knowledge_enrollments(enrollment_id, user_id, resource_id, status in (active, completed, dropped), started_at, completed_at, progress_percent, last_lesson_id)`; one active enrollment per member and course; `enroll_knowledge_course(p_resource_id)`; dropping keeps progress.
- AC2. `knowledge_lesson_progress(enrollment_id, lesson_id, done_at)`; `mark_knowledge_lesson_done` recomputes `progress_percent` (lessons done ÷ lessons total, excluding previews if the member is not enrolled).
- AC3. `knowledge_quiz_attempts(attempt_id, enrollment_id, quiz_id, quiz_version, answers jsonb, score_percent, passed, attempted_at)`; `submit_knowledge_quiz_attempt` grades server-side against the question versions in effect, returns per-question correctness and explanations; unlimited attempts; best score counts.
- AC4. Completion: all lessons done **and** every attached quiz passed → `status = completed`, `knowledge_completions(completion_id, user_id, resource_id, completed_at, hours numeric, verify_code text unique)` (`S69`), karma (learner 10; author 2 per completion, cap 20/day), `completion_count + 1`, notification to the author (`social`, grouped).
- AC5. Privacy: enrollments, progress, attempts and completions are readable only by their owner (RLS); the author and admins read aggregates through RPCs; nothing of these tables enters `knowledge_chunks` or the agent API.
- AC6. "Continue learning" row (hub + third tab): active enrollments by last activity with progress bars; course player (outline, lesson, mark done, next, quiz stepper, results, completion screen).
- AC7. Tests: progress arithmetic with previews; grading of each question kind; completion requires every quiz; RLS probe that a second member reads nothing; Maestro flow `knowledge_course_complete` (enroll → lessons → quiz → completion card).

## FR-KNOW-016 — Community answers in the library

**Acceptance Criteria.**
- AC1. The asker or an operator may "promote to the library": creates an `article` resource (`authority_tier = community`, `source = native`, body = question + accepted answer, contributor = answerer with their consent prompt) that goes through review (FR-KNOW-007); the question post links to it.
- AC2. Demand map (admin, `18 §18.6` item 11) lists topics with unanswered questions and requests without offers or resources (`api_knowledge_demand` data).
- AC3. Tests: promotion requires the answerer's consent flag; demand map excludes topics that gained a resource.

## FR-KNOW-017 — Knowledge events and recommendations input

**Acceptance Criteria.**
- AC1. `knowledge_events(event_id, user_pseudonym, resource_id null, listing_id null, topic_id null, kind in (view, open_external, save, helped, enroll, lesson_done, quiz_passed, completed, search, search_click), occurred_at)`; `user_pseudonym` is the research pseudonym of `spec/16_public_research.md` (salted, rotated), never the user id; 180-day retention sweep.
- AC2. Hourly rollups into `knowledge_resource_stats(resource_id, views_7d, opens_7d, helped_7d, completions_30d)` used by the `recommended` sort and by the feed engine (D27, S33) as a world-local signal.
- AC3. Tests: pseudonym never equals a user id; retention sweep.

## FR-KNOW-018 — Knowledge statistics (admin + member)

**Acceptance Criteria.**
- AC1. Admin statistics (D106): sessions completed, questions answered within 48h, resources published and verified share, enrollments / completions, demand gaps closed, search success — counts only (`admin_knowledge_stats(p_days)`).
- AC2. Member statistics (`my_world_givings` `0547` extended): sessions given / taken, resources contributed, completions — owner only.
- AC3. Tests: super admin only for the admin RPC; member RPC returns own rows only.

## FR-KNOW-019 — Knowledge notifications (consolidated)

**Acceptance Criteria.**
- AC1. Kinds (`notifications.kind`, per-kind opt-out FR-NOTIF-017): `knowledge_resource_reviewed` (important), `knowledge_booking_requested` / `_approved` / `_declined` / `_reminder` / `_slot_cancelled` (important), `knowledge_enrollment` / `knowledge_completion` (social, grouped per course per hour), `knowledge_answer_accepted` (social), `knowledge_topic_new` (social, cap 3/day), `knowledge_link_broken` (social).
- AC2. Quiet hours apply to all (none is `emergency`).
- AC3. Tests: grouping of enrollment notifications; cap on topic notifications.

## FR-KNOW-020 — Web export: public resource pages

**Acceptance Criteria.**
- AC1. Published resource detail pages and topic pages render on the web export without sign-in (read-only; actions prompt sign-in), with `<title>`, description, canonical URL, Open Graph and `schema.org` (`LearningResource` / `Course` / `Book` / `VideoObject`) JSON-LD built from the envelope.
- AC2. A `robots`-allowed sitemap of published resources and topics (K3 catalog export extends it).
- AC3. Tests: snapshot of the JSON-LD per kind; sign-in prompt on actions.

---

## K3 — profile, cohorts, open catalog, curators

## FR-KNOW-021 — Knowledge curator role and trusted contributors

**Acceptance Criteria.**
- AC1. Role grant `knowledge_curator` (scoped to one or more shelves) in the existing `admin_role_grants`; curators review resources on their shelves (FR-KNOW-007 AC5) and manage topics (FR-KNOW-001 AC5) there; super admins everywhere.
- AC2. Trusted contributor: a member with ≥ 10 approved and 0 rejected resources in 90 days publishes directly (`published` with `reviewed_by = null`) and the resource enters a post-review list; a rejection removes the status.
- AC3. Tests: scope enforcement; trusted threshold and loss.

## FR-KNOW-022 — Completions on the profile, cohorts

**Acceptance Criteria.**
- AC1. Profile (7.12) gains "learning" fields — completions, teaches, contributed — each with per-field visibility (D110); completion cards show the course title, hours, date and the verify code; `/knowledge/verify/[code]` shows the public record only if the owner set the field to everyone.
- AC2. Cohort: a course run = a `lesson_offer` series referencing `resource_id` with a start date and capacity (marked for the time world, D101); booked members are auto-enrolled; a cohort group chat follows 7.8 and locks at the end.
- AC3. Tests: verify page respects visibility; cohort booking enrolls once.

## FR-KNOW-023 — Open catalog export

**Acceptance Criteria.**
- AC1. Nightly cron `knowledge-catalog-export` writes to a public read-only storage path: `catalog.json` (published resources: envelope, topics, provenance, quality counts; no member identifiers — contributor shown as display name only if their profile is public, else "KC member"), `llms.txt` (an index by shelf and topic with one line per resource: title, kind, level, language, URL on KC) and `sitemap.xml`.
- AC2. The export is linked from the web export's `/.well-known/` and documented in `docs/SSOT/OPERATOR_RUNBOOK.md`.
- AC3. Tests: export excludes `pending_review` / `broken_link`; no email or user id appears (regex guard).

## FR-KNOW-024 — "New in the library" feed cards and course analytics

**Acceptance Criteria.**
- AC1. On publish, a resource may be mirrored into the knowledge world feed as a card (`posts.listing_id` mirror pattern, `0466`) when the contributor opts in; the card opens the resource detail; it never enters matching.
- AC2. Author analytics: enrollments and completions over time, per-lesson drop-off, per-question correct rate — aggregates only, ≥ 5 learners before any per-lesson number is shown.
- AC3. Tests: mirror card excluded from matching candidates; the ≥ 5 threshold.

---

## Data model summary

| Table | Layer | Notes |
| --- | --- | --- |
| `knowledge_topics`, `knowledge_topic_aliases`, `knowledge_topic_follows`, `knowledge_topic_counts` (mat. view) | Axes | FR-KNOW-001, 008 |
| `knowledge_post_topics`, `knowledge_slots` | Exchange | FR-KNOW-002, 004; posts stay on `listings` + `giving_handoffs` |
| `knowledge_resources`, `knowledge_resource_kinds`, `knowledge_resource_topics`, `knowledge_resource_versions`, `knowledge_resource_bodies`, `knowledge_resource_ai_suggestions`, `knowledge_saves`, `knowledge_helpful_votes`, `knowledge_shelf_links`, `knowledge_review_checklists` | Library | FR-KNOW-006, 007, 012, 013 |
| `knowledge_course_modules`, `knowledge_course_lessons`, `knowledge_quizzes`, `knowledge_quiz_questions` | Courses (author) | FR-KNOW-014 |
| `knowledge_enrollments`, `knowledge_lesson_progress`, `knowledge_quiz_attempts`, `knowledge_completions` | Courses (learner, private) | FR-KNOW-015, 022 |
| `knowledge_chunks`, `knowledge_embedding_jobs`, `knowledge_query_embeddings` | Retrieval | FR-KNOW-009 |
| `knowledge_events`, `knowledge_resource_stats` | Signals | FR-KNOW-017 |

Edge Functions: `knowledge-link-enrich`, `knowledge-ai-enrich`, `knowledge-link-health`, `knowledge-catalog-export`; `embed-worker` gains a real provider. Crons: slots materialize (10 min), topic counts (10 min), stats rollup (hourly), link health (weekly), catalog export (nightly), events retention (daily).

## Clean-architecture placement

- `packages/domain/src/knowledge/`: `KnowledgeShelf`, `KnowledgeTopic`, `KnowledgePostKind`, `KnowledgeResource` (+ kind detail types), `KnowledgeCourse` (modules / lessons / quizzes), `QuizGrading` (pure grading and progress arithmetic), `canonicalizeKnowledgeUrl` (pure), rules (`consultingHourRequiresIdVerification`, `coursePublishGate`). Unit tests beside them.
- `packages/application/src/knowledge/`: use cases one per file (`SubmitKnowledgeResource`, `ReviewKnowledgeResource`, `BookKnowledgeSlot`, `SearchKnowledge`, `EnrollInCourse`, `SubmitQuizAttempt`, …) over ports `IKnowledgeResourceRepository`, `IKnowledgeTopicRepository`, `IKnowledgeSearchGateway`, `IKnowledgeCourseRepository`, `IKnowledgeProgressRepository`, `IKnowledgeLinkEnricher`.
- `packages/infrastructure-supabase/src/knowledge/`: adapters over the RPCs above.
- `apps/mobile`: `WorldHubConfig` for knowledge (tabs), `components/knowledge/*` (`KnowledgeResourceCard`, `KnowledgeResourceDetail`, `KnowledgeTopicBrowser`, `KnowledgeContributeStepper`, `CoursePlayer`, `QuizStepper`, `ContinueLearningRow`), routes under `(tabs)/donations/knowledge/*`, admin `(admin)/knowledge/*`.
- File cap ≤ 300 lines and ≤ 3 indentation levels apply; the search RPC is split into lane functions.

## Tests (summary)
DB: `0570`–`0578` as listed; harness flow `flows/knowledge_lifecycle.sql` (G38). Unit: domain rules, grading, URL canonicalization, sanitizer, chunker. Component: cards, tabs, player, stepper. Maestro: `knowledge_library_browse`, `knowledge_course_complete`, `knowledge_book_lesson`. E2E journey fixture `journeys/knowledge.spec.ts` on the shared `worldJourney` shape (G40).

## SSOT links
`docs/spec/18_knowledge_world.md` (binding product spec) · `04_product_structure.md` (world row) · `05_giving_worlds.md` §5.7 · `07_cross_cutting_systems.md` §7.2, §7.6, §7.11 · `16_kpis.md` · `93_implementation_gaps.md` (`G55`, `G56`, `G57`, `G58`, `G59`, `G60`) · `docs/SSOT/BACKLOG.md` § KNOWLEDGE.
