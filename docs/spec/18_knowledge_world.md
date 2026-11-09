# 18 — Knowledge world (`knowledge`): free knowledge, give & take, library, courses, agent-readable storage

> **Scope decision (D119, PM 2026-11-03):** the knowledge world holds **both** the give & take of knowledge between people (lesson offers, mentoring, consulting hours, questions) **and** a **free knowledge library**: courses with progress tracking and quizzes, links to other sites, books, articles, videos, documents — "everything, all knowledge, free". The world is specified functionally, visually, and as a storage model that AI agents can search so they can help members find things.
>
> Everything in this file that is not a `D#` is a KC fill (`S#`, pending PM approval) or an implementation gap (`G#`). Engineering contract with acceptance criteria: [`requirements/23_knowledge.md`](requirements/23_knowledge.md) (`FR-KNOW-*`). Product structure: [04](./04_product_structure.md); world summary: [05 §5.7](./05_giving_worlds.md#57-knowledge-rights--legal-aid-knowledge--phase-2).

## 18.1 Why and what

Content already exists in Israel (Kol Zchut, Campus IL, YouTube, open courses, public libraries). What is missing is **(a)** the personal connection — someone who will teach, mentor or explain for free — and **(b)** a **curated, trustworthy, searchable map** of what free knowledge exists, where, at what level and in which language, good enough that a person or an AI assistant can answer "I want to learn X, I have two hours a week, in Hebrew, from zero" with a concrete path.

Three promises, all free (D4 spirit, R-Knowledge-2 kept):
1. **Give & take knowledge** — teach, mentor, advise, answer; learn, be mentored, ask.
2. **A free library** — every kind of free knowledge resource, in one structured catalog with provenance and quality signals.
3. **Learning you can track** — courses (native or external) with modules, lessons, quizzes, progress and a completion record.

Personas (from [03](./03_users_personas_roles.md)): the expert who will not become a paid teacher but will give an hour a week; the learner changing careers; the parent looking for a free course for a teenager (the account is the parent's, D109); the lawyer/accountant giving a pro-bono consulting hour (S36); the organization (Campus IL, a public library, a nonprofit) publishing its free courses; the KC team and community curators keeping the library clean.

## 18.2 Two layers on one world (S63)

| Layer | What it is | Entity | Lifecycle | Earns |
|---|---|---|---|---|
| **Exchange** (give & take) | Posts between people: teach / learn / consult / ask | **Post** in the knowledge world (D2, D19) with a knowledge extension | open → booked → session completed (handoff, D17) → closed; expiry rules of D21 | Karma at closing (7.6) |
| **Library** (free knowledge) | Durable, curated resources: course, article, link, book, video, document, podcast, tool, dataset | **Knowledge resource** — a catalog entity, like community links (D107) and the organization catalog, **not** a post | draft → pending review → published → archived / broken link; no direction, no handoff, no expiry | Karma at approval and when others mark it helpful |

Why resources are not posts: a resource has no offer/request direction, no counterpart and no closing; it must stay findable for years; it carries structure (modules, lessons, quizzes, chunks) that a post does not. A post may **reference** resources ("I teach this course"), and a resource page shows the open posts about its topics ("people who teach this", "people who want to learn this"). A newly published resource may be mirrored into the world feed as a "new in the library" card (phase K3), the way native listings mirror into the feed today.

## 18.3 Three axes every knowledge object carries (S64)

Agents and filters need more than the six D100 sub-categories. Every post and resource is placed on three orthogonal axes:

| Axis | Values | Who sets it | Purpose |
|---|---|---|---|
| **Shelf** = world sub-category (D100) | science & technology · history & heritage · culture & art · spirituality & philosophy · rights & legal aid · lessons & mentoring | Contributor, required | Product structure, hub browsing, world rules per shelf (06) |
| **Subject** = topic from the **topic graph** | A curated tree: e.g. `programming` → `python` → `python-for-data`; `languages` → `english` → `english-conversation`; `rights` → `tenant-rights` | Contributor picks 1 primary + ≤ 4 more; AI suggests from the content; curators add topics | Precise retrieval, demand map, "follow a topic", cross-language search |
| **Format** = kind | Posts: lesson offer, mentoring offer, consulting hour, learning request, mentoring request, question. Resources: course, article, link, book, video, document, podcast, tool, dataset | Form / contribute flow | Form fields, card shape, player, player-specific rules |

**Topic graph rules:** controlled vocabulary (`knowledge_topics`): slug, Hebrew + English labels, parent, description, **aliases** (Hebrew, English, transliterations, common misspellings — "פייתון / Python / פיתון"), status (active / proposed / merged-into). Topics are seeded by the KC team from the PRD subject list (programming, languages, STEM, professions, arts, cooking, personal development, parenting, life skills, tradition & heritage, rights) and grow by proposal: a contributor or the AI enrichment step may propose a topic; it is used immediately as `proposed` and becomes `active` when a curator approves or merges it. A merged topic keeps its slug as an alias so links never break. Free **tags** remain allowed but are never required and never replace a topic.

## 18.4 Exchange layer — give & take posts

One form per post type (D28), on the one create form (D107), knowledge chosen first, then the shelf, then the type:

| Post type | Direction | Unique fields | Location | Expiry | Closing |
|---|---|---|---|---|---|
| **Lesson offer** (שיעור) | offer | topic(s), level, modality (in person / video / phone), availability slots (one-off or recurring weekdays + time, like recurring rides D103), capacity per slot, language, resources I use | city or remote | last slot + 30 min; recurring: none, relevance reminder (D59) | "session completed" per booking → karma, rating (7.7) |
| **Mentoring offer** (חונכות) | offer | topic(s), audience (career change, students, new immigrants…), cadence (weekly / bi-weekly), seats, language | remote or city | none, relevance reminder | per meeting "session completed"; or mentorship closed by either side |
| **Consulting hour** (שעת ייעוץ, S36) | offer | profession (lawyer, accountant, social worker, tax, housing, employment rights…), topic(s), slots, modality | city or remote | last slot + 30 min | "session completed"; mandatory disclaimer (18.9) |
| **Learning request** (רוצה ללמוד) | request | topic, level, preferred modality, availability, language | city | none | "found a teacher" (links the booking) or "found it in the library" (links a resource) |
| **Mentoring request** (מחפש/ת מנטור) | request | topic, goal, cadence | remote or city | none | matched → closed with the offer |
| **Question** (שאלה) | request | topic, question text ≤ 500, optional context link | none | none; auto-close 30 days after an accepted answer | asker marks an **accepted answer** among comments (7.9); an accepted answer may be proposed to the library as a community answer |

Rules: a lesson offer may also be marked for the **time** world (D101); its completed sessions count as volunteering hours (D32, 7.10). Booking a slot reserves a seat on that slot (`book_knowledge_seat`, #2034); the giver approves within 24 h or by the slot start, whichever is earlier, or the booking expires and frees the seat. A first-come option chosen by the giver is not built yet. A recurring lesson materializes one slot per occurrence like a ride series (D103 pattern). Max open posts per private user (S34) applies.

## 18.5 Library layer — the free knowledge library

### 18.5.1 Resource envelope (one card, many shapes)
Every resource has the same envelope, plus kind-specific detail validated by a JSON schema per kind (the `listing_kinds.detail_schema` pattern):

- **Identity & shape:** `kind`, `title` (≤ 120), `summary` (≤ 300, written for a person *and* an agent: what it is, for whom, what you will be able to do after), `language(s)`, `level` (none / beginner / intermediate / advanced), `estimated_minutes`, `shelf`, primary + additional `topics`, `tags`.
- **Source & rights:** `source = native | external`, canonical `source_url` (normalized, deduplicated by hash), `publisher` / `author` attribution, `license` (public domain / CC-* / free to access / author permission / unknown-not-allowed), `authority_tier` (official source · verified organization · community), `is_free = true` always (a resource that costs money is refused at review; "free tier" is allowed only if the learning content itself is free).
- **Kind detail examples:** course → outline (modules, lessons), provider, has quizzes, cohort or self-paced; book → author, ISBN, year, free legal access (open access link, public library, "someone near you is giving it away" via the items world sub-category books); video → provider id, duration, captions languages; article → native body or external link; document → file type and page count (links only in K1, S71); tool / dataset → what it does, access requirements.
- **Quality & freshness (agent-rankable columns):** `helped_count`, `save_count`, `completion_count`, `report_count`, `last_verified_at`, `link_status` (ok / redirected / broken), `reviewed_at` + reviewer, `authority_tier`.
- **Machine-generated fields, kept apart from human text:** `ai_summary`, `ai_keywords`, `ai_questions_answered` (the questions this resource answers), `ai_prerequisites`, `ai_audience`, each with `generated_by` (model + version) and `generated_at`; regenerated on edit, never overwriting contributor fields.
- **Body & chunks (native content):** the body is markdown, versioned; it is split into **chunks** (heading path + passage + embedding) so an agent can cite "resource › module 2 › lesson 3 › paragraph" rather than a whole document. External resources get one chunk from their metadata plus the contributor's "why it is useful" note.

### 18.5.2 Contribute flow ("+" in the library tab)
1. Paste a link, or choose "write an article", or "build a course".
2. For a link: the server fetches title, description, image, language, provider, and guesses the kind (YouTube → video, ISBN → book, a syllabus page → course); duplicates are shown ("already in the library — add your note instead").
3. AI enrichment proposes shelf, topics, level, summary and the questions it answers; the contributor confirms or edits — the contributor's words win.
4. Contributor states license / free access and accepts the knowledge rules (18.9).
5. Submitted → **pending review** → published or rejected with a reason (S65). Trusted contributors (curators) publish directly with post-review.
6. On publish: karma, embedding and chunking, catalog export, "new on a topic you follow" notifications.

### 18.5.3 Courses with progress and quizzes
- **Structure:** course → modules → lessons. A lesson is text (markdown), a video (embedded provider link), an external page, or a reading from another resource. Each lesson has an estimated duration; a module or the course may end with a **quiz**.
- **Quiz:** single choice, multiple choice, true/false, short answer with accepted answers; explanations per answer; pass threshold (default 70%); unlimited attempts; the best score counts. Questions are versioned; an attempt stores the question version it answered.
- **Progress:** enrollment (self-paced) → per-lesson done → quiz attempts → completion. Progress is **private** to the learner (D110 default "only me"); the author sees counts only. "Continue learning" on the hub and on the profile.
- **External courses, tracked:** an external course (Campus IL, an open university course, a YouTube playlist) may carry a KC outline (its syllabus as modules/lessons without bodies) so a learner tracks it in KC and takes a KC quiz the contributor wrote. "We track your progress even on courses that are not ours."
- **Completion record (S69):** a non-official completion certificate with a verifiable id, course title, hours and date; shown on the profile only if the owner chooses (D110). Not a credential; the wording says so.
- **Cohorts (K3):** a course run with a start date and capacity is the course plus a time-world post (D101); group chat follows the chat rule for a project/challenge/event (7.8).

### 18.5.4 Q&A and community answers
A question post (18.4) with an accepted answer is indexed as a **community answer chunk** (question + accepted answer + topic), so agents can retrieve "someone asked this and here is the answer that helped". The asker or a curator may promote it into the library as an article of `authority_tier = community`.

## 18.6 Display — hub, library, players (S66)

The knowledge hub is the world hub template (D36) with three **tabs** under one search-first header. Per D107 the give & take feed comes first; the PM may flip the default once usage shows which tab people open (open question, [92](./92_open_questions.md)).

1. **Header:** world accent and illustration (17); one search box "מה תרצה ללמוד?" with suggestions as you type: topics, resources, teachers, questions (hybrid search, 18.7). In emergency, the emergency block sits on top (D42).
2. **Tab "לתת ולקבל" (default):** the world feed of exchange posts (7.3 controls; filters add shelf, topic, format, modality, level, language). Under the feed: the community links list (D107).
3. **Tab "ספרייה":** "continue learning" row (if any enrollments) → topic browser (six shelves as sections, topics as chips with counts; drill-down into the tree) → filters (kind, level, language, duration, authority, free-access type) → sort (recommended / new / most helpful) → resource cards.
4. **Tab "הלמידה שלי":** enrollments with progress bars, my completions, my contributions (with review status), topics I follow, my saved resources.
5. **Resource card:** kind icon, title, provider domain or author, shelf chip, level, duration, language flags, "helped N", save; a course card adds a progress bar when enrolled.
6. **Resource detail:** title, summary, metadata grid, primary action by kind (open link / read / start course / watch), provenance block (added by, reviewed, license, source), quality block (helped, completions, last verified), **"people who teach this"** (open lesson / mentoring offers on its topics) and **"people who want to learn this"** (open requests), related resources, "questions this answers", report, share. A broken link shows a notice and "report fixed link".
7. **Course player:** left/top outline (modules → lessons, done ticks), lesson body, "mark done", next; quiz screen with one question per step, result screen with explanations, retry; completion screen with the completion record card.
8. **Contribute flow:** the three entry points of 18.5.2 as a stepper; the course builder is web-first (web export) and mobile-readable; the mobile app can build a link or an article and edit course metadata.
9. **Exchange post cards and detail:** the uniform card (7.4) plus topic chip and modality icon; detail adds the slot picker and "book"; a consulting hour shows the disclaimer and the giver's declared profession with the verification level (D23).
10. **Profile (7.12):** "teaches" (open offers), "learning" (count), "contributed" (count), completions — each under the owner's per-field visibility (D110).
11. **Admin portal:** knowledge review queue (resources pending, with the AI suggestions shown as hints and a reviewer checklist per shelf), topic management (approve / merge / rename), link health report, flagged resources, demand map (open requests by topic with no offer or resource).

## 18.7 Storage and retrieval built for AI agents (S67)

Principles:
1. **Typed first, text second.** Every fact an agent would otherwise have to guess is a column or a topic edge: kind, level, language, duration, authority, license, link status, counts, topics with aliases. Free text (summary, body) is for humans and for semantic search.
2. **One index, three sources, one retrieval call.** Resources, chunks, exchange posts and community answers share one search entry point: `knowledge_search(query, filters, viewer)` returns typed hits (`resource | chunk | post | topic | teacher`) with a score breakdown and a **citation** (resource id, version, chunk path). Fusion = full-text (Hebrew and English, `simple` config + unaccent) + trigram on titles and aliases + **real** vector embeddings (today's `search_listings` already fuses four lanes but its vector lane and the `embed-worker` embedder are placeholders — TD-269; the knowledge index ships on a real multilingual embedding model, chosen by name in config so it can change) + topic match (query terms resolved to topics through aliases, then expanded down the tree).
3. **Citations and provenance are first class.** A hit always carries who added it, who reviewed it, the license and the last verification date, so an assistant can say "from Kol Zchut, verified by KC on …" and never present a community answer as official.
4. **Machine fields never overwrite human fields.** AI summaries, keywords and suggested topics live in their own columns with model and timestamp; a human edit sets them stale and they are regenerated.
5. **Privacy by construction.** Learner progress, quiz answers, enrollments and saved items are never in the index; only aggregates reach a resource. Exchange posts obey the post visibility rules (`is_listing_visible_to`) and block filtering (D105): every agent query runs **as a viewer** (a member id or anonymous), never as a superuser over members' data.
6. **Stable identity.** Topics and resources have stable slugs; a merged topic keeps its slug as an alias; a resource keeps its id across versions; external URLs are normalized and hashed for deduplication.
7. **Freshness is measured, not assumed.** A weekly link checker (S68) marks `redirected` / `broken`, hides broken ones after a grace period and notifies the contributor; `last_verified_at` is a ranking signal.
8. **Agent surface = the same RPCs the app uses, plus a service contract.** `api_knowledge_search`, `api_knowledge_get_resource` (envelope + outline + chunks on request), `api_knowledge_topic_map` (the tree with counts: resources, teachers, open requests per topic), `api_knowledge_demand` (open requests and questions with no answer, per topic — what the community is missing), `api_knowledge_suggest_topics(text)`, `api_knowledge_submit_resource` (as a member; lands in review). These follow the existing `api_bot_*` contract (service role, viewer id as a parameter) and are exposed to the WhatsApp intake bot and to MCP tools.
9. **Open catalog for the outside world (K3).** A daily, public, read-only export of the published library — JSON catalog, an `llms.txt`-style index and a web sitemap — free content and provenance only, no member data, so external assistants and search engines can send people to free knowledge on KC.
10. **Events for learning and recommendations.** `knowledge_events` (view, open external, save, helped, enroll, lesson done, quiz passed, completed) feed "most helpful", "continue learning", the recommendation engine (D27) and research aggregates; pseudonymous, retention per the research rules (16).

Pipeline: contribute → link enrichment (metadata, kind guess, duplicate check) → AI enrichment (shelf, topics, summary, questions) → review → publish → chunk + embed → index → search / recommend / export; weekly link health; nightly catalog export. Each step is an Edge Function or a cron on the existing infrastructure (embed worker, Gemini translation/rerank already in use), named in [`23_knowledge.md`](requirements/23_knowledge.md).

## 18.8 Trust, roles and moderation

- **Who may do what:** every member may ask, request, offer lessons and mentoring, contribute links and articles, enroll, take quizzes. A **consulting hour** requires ID verification and a declared profession shown on the post (S70; an exception to "verification is not blocking", D23, in the spirit of the housing and medical exceptions of D30). Courses: any member may build a course; a course in rights & legal aid or health-adjacent topics is reviewed with a stricter checklist. Organizations publish in their name (D88) and their resources get `authority_tier = verified organization`.
- **Review before publish (S65):** KC admins and moderators review; a **knowledge curator** community role (phase K3, a governance role per 11) may review within their shelf. Reviewer checklist per shelf: free, legal to share, accurate source, no sales funnel, shelf rules (06: no missionary content; no divisive heritage content; a source per heritage item; no binding legal or medical advice, D40).
- **Copyright:** no uploaded copies of books or paid courses (K1 has no file uploads, S71); a book is a reference plus a free legal way to read it. A copyright report hides the resource at once and counts against the contributor (7.15).
- **Reports:** resources, posts, comments and answers are reportable (7.15); three reports hide a resource until review.
- **Quality:** "helped me" votes and completions rank; reports and broken links demote; a contributor whose resources are repeatedly rejected loses the fast path.

## 18.9 Rules shown in the product
- "Everything here is free. Anything that asks for money is removed."
- Rights & legal aid and consulting hours: "This is general information and a volunteer's opinion, not binding legal, financial or medical advice. For a binding answer contact an authorized body." (D40; a link to Kol Zchut / the relevant official body on the shelf page.)
- "A completion record is a KC community record, not an accredited certificate."
- Shelf rules from [06](./06_domain_hubs.md) are shown on the contribute step of that shelf.

## 18.10 Karma, notifications, KPIs (S72)
Karma (adds rows to 7.6; estimates, in `KARMA_POINT_VALUES`): lesson / mentoring / consulting session completed — giver 10 per hour (D32, cap 80/day), learner 5; resource approved — 5 (cap 5/day); resource marked helpful by others — 1 per vote received (cap 20/day); course published — 20; course completed — learner 10, author 2 per completion (cap 20/day); accepted answer — 5; question asked — 2 (cap 5/day). Since #2034 (`0702`) a session grants the giver 5 per started half hour within the 80-a-day cap and the learner 5; mentoring meetings have no completion yet (#2051).

Notifications (7.11): resource approved / rejected (`important`); booking requested / approved / declined and a 24h session reminder (`important`, like rides D73); new enrollment and course completion for the author (`social`, grouped); answer accepted (`social`); "new on a topic you follow" (`social`, the saved-filter rule D10: max 3/day); broken link on your resource (`social`).

KPIs (adds to [16](./16_kpis.md)): sessions completed; questions with an accepted answer within 48h; resources published and share verified; "helped me" per resource; enrollments, lesson completion rate, course completions; demand gaps closed (topics that had requests and gained an offer or a resource); search success (a search followed by open / enroll / book); agent-served answers that cite a KC resource.

## 18.11 Phases
| Phase | Ships |
|---|---|
| **K1** (with the phase-2 knowledge world, [14](./14_roadmap.md)) | Topic graph + aliases; exchange post types on the one create form (lesson offer with slots, mentoring, consulting hour, learning request, mentoring request, question with accepted answer); library of external resources (link, video, book, external course, document link) with link enrichment, AI enrichment, review queue; hybrid search with real embeddings; "people who teach this"; follow a topic; agent read API; link health |
| **K2** | Native articles with versioned bodies and chunks; native courses: builder (web), modules, lessons, quizzes, enrollment, progress, completion record; "continue learning"; external course tracking shells; demand map in admin; community answers indexed |
| **K3** | Completions on the profile; cohorts; course analytics for authors; open catalog export (`llms.txt`, sitemap); knowledge curator role; promote answers to the library; "new in the library" feed cards |

Gaps: G55, G56, G57, G58, G59, G60. Open questions for the PM: [92](./92_open_questions.md) §6.
