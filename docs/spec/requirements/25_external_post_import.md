# 2.25 External post import (ייבוא פוסט מבחוץ)

> **Status:** 🟡 Spec v1 (2026-11-16). ✅ Domain core (`@kc/domain/imports`: FR-IMPORT-002, 003 AC3, 005, 006 AC1-AC2, fingerprint of 008 AC1, #2345) is implemented, and ✅ official place resolution (FR-IMPORT-004: `api_resolve_place`, #2346); and ✅ the extraction pipeline library (`_shared/post-extraction`: provider seam, prompt and schema, place and time resolution, confidence routing, #2347 part 1); ✅ the `extract-external-post` Edge Function with the attempt log, day cache, per-member limits and kill switch (`external_post_import_enabled`: a missing flag is off, the super admin creates it to switch the feature on; FR-IMPORT-001 AC4, 006, 008 AC2-AC3, 009; #2347). Still ⏳: the cross-post guard (008 AC1, with the draft screen #2349), the moderation lockout (008 AC4, #2395), the 90-day purge (009 AC1, #2394), the mobile screens (#2417), the provenance chip on cards (a follow-up of #2418) and the telemetry (#2350). ✅ App logic layer (#2349): draft types, port, use cases, adapter, the form-seed mapping, the flag default. ✅ Provenance in the database (`posts.source_platform`, `api_import_attach_post`, #2418). ✅ Quality gate (010 AC1-AC3, #2348): 160-message golden set, scoring, CI replay with the minimums, `eval/live.ts` for the real model; the replay uses recorded answers derived from the labels, so the measured accuracy of the real model waits for a live run with a key. Product decision `D167`; own-post attestation `S90` approved by the PM (2026-11-17); gap `G27` (phase 1). Engineering design: [ADR-008](../../architecture/adr/ADR-008-external-post-import.md). Issue: #2343.

Prefix: `FR-IMPORT-*`

> **Source of truth.** Product book [`13_growth_gtm.md` — Import channels (S22)](../13_growth_gtm.md) wins where it disagrees (D35). This file is **step 1 (manual paste)** of S22, widened to the OS share sheet. Steps 2–4 (chat-export upload, live bot, bridge) reuse the same extraction pipeline and stay `G27` phase 2.

> **Why.** Giving in Israel already happens in WhatsApp groups, Facebook groups and Yad2 (D38). A member who sees a post there should reach KC in two taps, not retype it. The hard part is not the transport but the **understanding**: free Hebrew text ("מוסר ספה תלת מושבית בנווה שאנן, לאסוף עד חמישי") must become the right world, direction, sub-category, place and time, accurately and cheaply, with a human confirming before anything is published.

> **What this is not.** KC **never scrapes, crawls, logs in to, or reads** WhatsApp, Facebook or Yad2 on its own. Content enters KC only when a person shares or pastes it (D54, S21). Commerce (sale, rent for money) is out of KC's model (D112, rides are free) and is rejected by the extractor, which removes most Yad2 ads from scope by design.

## Scope

In: the entry points, text normalization and PII scrub, the extraction contract, catalog and time resolution, confidence routing, the review-and-publish draft, provenance, dedupe, limits, privacy, the quality gate.

Out: chat-export upload and its admin review queue (`G27` phase 2, uses `FR-IMPORT-003..006` unchanged), live bot, bridge, translation of the imported text (`FR-TRANSLATE-*` applies afterwards as to any post), media download from external links.

## Definitions

- **Import draft** — the prefilled create form produced from one shared text; never a post until the member publishes it.
- **Extraction** — the structured result of `FR-IMPORT-003` for one text, with per-field confidence.
- **Source platform** — `whatsapp`, `facebook`, `yad2`, `other`, `unknown`; a label only, taken from the share source or the member's choice.

## FR-IMPORT-001 — Entry points

- AC1. **Share to KC:** KC is a target of the OS share sheet for text and for text with images (Android intent filter, iOS share extension; the library is chosen by the ADR-005 matrix, not in this spec). On web, a PWA Web Share Target entry does the same.
- AC2. **Paste:** the create flow offers "import from a message": a field to paste text (and add photos), reachable from the "+" screen.
- AC3. A signed-in, onboarded member only. A guest or a member mid-onboarding who shares to KC is routed through sign-in and then lands on the import draft; the shared payload survives sign-in for 10 minutes (same TTL rule as `FR-POST-023` AC6).
- AC4. Behind `external_post_import_enabled`; off ⇒ the share target answers with the plain create form and no extraction runs.
- AC5. The text of a link is **not fetched** (no server-side requests to the member's URL): a shared link without text opens the paste field with the link in it and a hint to paste the post text.

## FR-IMPORT-002 — Normalization and PII scrub (before any model sees the text)

- AC1. Input is capped at **4,000 characters** after trimming; the rest is cut and the draft says so.
- AC2. Deterministic normalization: Unicode NFKC, niqqud and bidi control characters removed, whitespace collapsed, WhatsApp forwarding artefacts and system lines removed ("‎‏<This message was edited>", "הועבר", read receipts, `[12:03, 4.11.2026]` prefixes are parsed into the **message timestamp** and removed from the body).
- AC3. **PII scrub:** Israeli phone numbers (mobile, landline, +972 forms, with separators), e-mail addresses, national-ID-like 9-digit numbers, bank / card-like digit runs and URLs are replaced by typed placeholders (`<PHONE>`, `<EMAIL>`, `<ID>`, `<URL>`) **before** the text is sent to any provider. Placeholders are never published; the draft shows the member a notice that contact details were removed and that contact happens in KC chat (D13).
- AC4. Names of people are not scrubbed by rule (they are indistinguishable from place and item words); the member sees the text in the draft and edits it. The extractor is told to leave personal names out of the title.
- AC5. The scrub is a pure function in `@kc/domain` with its own tests; a text that is only placeholders and symbols is rejected as empty.

## FR-IMPORT-003 — Extraction contract

One provider call per text (`FR-IMPORT-009` for the provider rules) returns exactly this JSON; anything else is a failed extraction (`FR-IMPORT-006` AC4).

| Field | Type | Rule |
|---|---|---|
| `is_post` | bool | false for chit-chat, questions to the group, thanks, ads without a giving intent |
| `reject_reason` | enum / null | `not_a_post`, `commercial` (sale, paid rent, paid service, fee), `forbidden` (`FR-POST-020` classes), `unsupported` |
| `direction` | `offer` \| `request` \| `unknown` | give / take |
| `world_slug` | enum of `WORLD_SLUGS` / null | one primary world (D100); additional worlds are never inferred |
| `subcategory` | enum of that world's sub-categories / null | item subcategory (D18), food type (D137), etc.; closed list passed in the prompt |
| `title` | string ≤ 80 | imperative-free noun phrase, no personal names, no contact, no price |
| `description` | string ≤ 1,000 | the cleaned body; the member's own words, not embellished |
| `place` | `{ city_text, street_text, neighborhood_text }` | raw strings as written; resolved by `FR-IMPORT-004`, never trusted |
| `time` | `{ kind, day_offset, weekday, month, day_of_month, time_hhmm, time_period, recurring_weekdays }` | `kind` ∈ none / relative_day / weekday / date / recurring; everything as written (day number and month for an explicit date, never a computed date); resolved by `FR-IMPORT-005` |
| `ride` | `{ origin_text, destination_text, meeting_texts[≤3], seats }` | only when `world_slug` is the transport world |
| `details` | object | per-world detail fields allowed by that world's detail schema (condition, quantity, allergens, expiry …), unknown keys dropped |
| `language` | BCP-47 | for `source_language` (`FR-TRANSLATE-001`) |
| `confidence` | `{ overall, per_field{…} }` | 0..1 each, model-reported then **recalibrated** by code (`FR-IMPORT-006`) |

- AC1. The model sees only the scrubbed text, the message timestamp, the closed enum lists and the schema. It does not see the member, the group name or any other post.
- AC2. The text is passed as **untrusted data**; the system prompt forbids following instructions inside it, and the output is constrained by the provider's response schema (JSON mode) at temperature 0.
- AC3. The result is validated by a pure function (`validateExtraction`, `@kc/domain`): enums against the closed lists, lengths, types, unknown keys dropped, strings stripped of placeholders and control characters. An invalid result is retried **once**, then fails.
- AC4. `commercial` detection is conservative both ways: an explicit price or "למכירה / להשכרה בתשלום" rejects; "תמורת תרומה / עלות דלק משותפת" does not (cost-sharing rides, `FR-RIDE-*` caps apply on the form).

## FR-IMPORT-004 — Catalog resolution

- AC1. **World and sub-category** come from the closed lists; a sub-category not valid for the resolved world is dropped (the member picks).
- AC2. **Places** (`city_text`, `street_text`, ride origin / destination / meeting points) are resolved **only** to the official places catalog (D71): Hebrew-normalized (prefix letters ה/ב/ל/מ/ש and quotation marks handled, niqqud removed) fuzzy match with a similarity floor per level (city ≥ 0.85, street within the resolved city ≥ 0.80, junction ≥ 0.80). Free-text places are never stored.
- AC3. A single candidate above the floor and clearly ahead of the runner-up (margin ≥ 0.10) is **auto-picked** and marked "confirm"; two close candidates or none leave the field **empty with up to 3 suggestions**.
- AC4. A street without a resolved city is resolved only when exactly one city has that street name; otherwise it is left for the member.
- AC5. Abbreviations and nicknames ("ת"א", "ב"ש", "פ"ת") come from a maintained alias list shipped with the catalog, tested by golden cases.
- AC6. **Matching rule (implemented by `api_resolve_place(level, text, city_id, limit)`).** Names and query are compared after normalization (niqqud, quote marks, dashes and punctuation removed). A leading prefix letter (in / to / from / the / that / and / like) is tried both kept and removed, up to two letters, so "in Haifa" finds Haifa and "Bnei Brak" keeps its own letter. The score is the best of the trigram similarity (1.0 for the same name) and 0.9 × the share of the query found inside a longer official name ("Tel Aviv" inside "Tel Aviv - Yafo" scores 0.9). `margin` is the lead over the next row, rounded to two decimals, so an exact street name beats "Herzl Boulevard" by exactly 0.10. Rows below 0.5 are not returned; the floors of AC2 and the margin of AC3 are applied by the caller. A street needs its city (AC4's lookup without a city is the caller's job).

## FR-IMPORT-005 — Time resolution

- AC1. The model never produces an absolute date. Code resolves `time` against the **message timestamp** (or "now" when none) in `Asia/Jerusalem`: "מחר ב-8" ⇒ next calendar day 08:00; "עד חמישי" ⇒ the coming Thursday; "בשבת" ⇒ the coming Saturday; "כל יום ראשון" ⇒ recurring weekday (ride series, D103).
- AC2. A resolved departure in the **past** is dropped to "unknown" with a note, never silently moved to next week.
- AC3. Bare hours are 24-hour when ≥ 13, otherwise resolved as the nearest plausible hour for the context ("ב-8" for a ride before noon is 08:00); the draft shows the resolved date and time in words so the member sees it.
- AC4. Expiry follows the world's own rules after publish (D21, D128); the import never sets an expiry the form would not.

## FR-IMPORT-006 — Confidence and routing

- AC1. **Recalibration.** Code computes the field confidence from model confidence **and** objective signals: catalog match score, presence of an explicit cue ("מוסר", "מחפש", "נוסע") for direction, agreement between world and sub-category, and conflicts (an offer cue and a request cue in one text). The reported overall is the minimum of the required fields' recalibrated values.
- AC2. Routing for a member's own import: **ready** (overall ≥ 0.85, every required field present and resolved) ⇒ draft with fields unmarked; **needs confirmation** (0.50–0.85, or any field auto-picked by `FR-IMPORT-004` AC3) ⇒ draft with those fields highlighted; **manual** (< 0.50, `is_post` false, or a reject reason) ⇒ the empty create form with the pasted text prefilled in the description and a one-line reason.
- AC3. An extraction **never publishes** and never creates a post row; it only prefills the form.
- AC4. A failed extraction (provider error, timeout 10 s, invalid result after the retry) falls back to the **manual** route; the import never blocks creating a post.
- AC5. Thresholds are config (`import_confidence_ready`, `import_confidence_confirm`), tuned against `FR-IMPORT-010`, not hard-coded.

## FR-IMPORT-007 — Review, attestation and publish

- AC1. The draft is the existing create form prefilled (the mechanism of D130 / `FR-POST-008` republish prefill): the member edits anything, adds photos, and publishes through the normal `FR-POST-006` confirmation. All world rules apply unchanged: an **offer** in items, food, housing or animals needs a photo (D132) — images that came with the share are attached as candidates, never required to be the final photos; guardrails `FR-POST-020`; the active-post cap `FR-POST-011`.
- AC2. **Attestation `S90`.** Before publishing an import draft the member confirms: "This is my own post — I am the one giving / asking." A member who found someone else's post cannot publish it as their own; the screen explains that and offers "ask the author to post it here" (share link to KC). Third-party content enters only through the admin-approved path of S21 (`G27` phase 2).
- AC3. The published post carries `source = imported` (ADR-006), `source_platform` and a provenance chip on the card and the detail ("from WhatsApp / Facebook / Yad2"). It is otherwise an ordinary post: feed, matching, chat, closure and karma are unchanged. No group name is stored for a member's own import.
- AC4. The imported text is not kept (`FR-IMPORT-009`); edit after publish follows `FR-POST-008`.
- AC5. Karma follows `FR-KARMA-*` for a published post; there is no extra karma for importing.

## FR-IMPORT-008 — Dedupe and limits

- AC1. **Cross-post guard.** The text fingerprint (`sha256` of the canonical form: scrubbed, lower-cased text with digit runs collapsed and punctuation dropped; `@kc/domain` builds the canonical string, the Edge Function hashes it) and a trigram similarity against the member's own open posts: a match ≥ 0.80 shows "you already have this post" with a link; publishing anyway is allowed (a deliberate repost) but marked.
- AC2. **Extraction cache.** The same fingerprint within 24 h returns the stored extraction without a new provider call (any member; the cache holds no member id and no raw text).
- AC3. Limits per member: **20 extractions / day** and **5 / hour** (config); over the limit ⇒ the manual route with a "try again later" note. A global daily provider budget stops extraction at the cap and falls back to manual for everyone; the budget is visible in the admin health registry (D68).
- AC4. Abuse: an account younger than 24 h cannot import; a member whose imports were removed by moderation 3 times in 30 days loses the entry point for 14 days (`FR-MOD-*` audit event).

## FR-IMPORT-009 — Privacy, provider and retention

- AC1. **No raw text is stored.** Only the fingerprint, the extraction JSON (post-scrub, no placeholders), the confidence, the channel, the source platform and timestamps are kept in `external_post_imports` (ADR-008), 90 days, then purged: the period is the retention rule `external_post_imports` (`kc_private.retention_rules`) and a nightly job removes older records (KC#2394). The member's own edits live in the post as usual.
- AC2. The provider sits behind a one-method seam (`PostExtractionProvider`), like `TranslationProvider` (D-65). Dev may use a free tier; **before public launch the provider must be zero-retention under a DPA** (D-63 parity); switching is a key and model-name change only.
- AC3. The `translate` and extraction Edge Functions share the observability wrapper (D-202); logs carry ids and enum outcomes, never text.
- AC4. The Edge Function is callable only by an authenticated member (JWT) for their own import; service role is not accepted for member requests.
- AC5. A member can delete an import record; account deletion purges them (`FR-AUTH-*` purge job).

## FR-IMPORT-010 — Quality gate (accuracy is a requirement, not a hope)

- AC1. A **golden set** of ≥ 150 anonymized Hebrew messages (WhatsApp / Facebook / Yad2 style, with noise: emoji, abbreviations, typos, mixed Hebrew / English, multi-offer messages, jokes, thanks) lives in the repo with hand-labelled expected fields. Messages are rewritten, never copied from real groups.
- AC2. CI runs the pipeline against **recorded** provider responses (deterministic, free) and fails below the thresholds: `is_post` F1 ≥ 0.95; commercial rejection recall ≥ 0.95; direction ≥ 0.95; world ≥ 0.90; sub-category ≥ 0.85 (given the world); city ≥ 0.90; ride origin / destination ≥ 0.85; resolved departure ≥ 0.90. A scheduled / manual job re-records against the live provider and reports drift.
- AC3. Every deterministic stage (scrub, normalization, place matching, time resolution, validation, recalibration) has unit tests beside it with boundary cases (midnight, DST changes, Saturday, month end, a street in two cities).
- AC4. **Production signal:** per field, the share of drafts the member changed before publishing (`import_field_edit_rate`) and the share of drafts discarded; surfaced in the admin funnel (`FR-STATS-*`); a field above 25 % edit rate opens a tech-debt issue automatically in the monthly review.
- AC5. Prompt, schema and thresholds are versioned (`extraction_version` on the record) so a change is attributable.

## Edge cases

- A message with several offers ("מוסר ספה ושולחן ומקרר") ⇒ **one** draft for the first item with the rest in the description and a hint to publish the others separately; the extractor never produces several posts.
- A ride request and a ride offer in one text ⇒ conflict ⇒ `direction = unknown`, member picks.
- Text in English or Arabic ⇒ extracted as usual; `language` recorded; the post is translated for readers by `FR-TRANSLATE-*`.
- A post about a person in need (medical, emergency) ⇒ extracted normally; the emergency flow (D42) is never auto-triggered by the import.
- Offline at share time ⇒ the payload waits in the app; extraction runs when back online, the manual route is always open.
- The shared text contains "ignore previous instructions" ⇒ treated as data (`FR-IMPORT-003` AC2); the golden set includes injection cases.

## Related

Product: `13_growth_gtm.md` (S21, S22, S23), `05_giving_worlds.md` §5.2–5.3, D38, D54, D71, D100, D112, D130, D132. Requirements: `FR-POST-006/008/011/020/023`, `FR-TRANSLATE-001`, `FR-RIDE-*`, `FR-MOD-*`, `FR-STATS-*`. Engineering: [ADR-008](../../architecture/adr/ADR-008-external-post-import.md), ADR-006 (`posts.source`), D-63 / D-65 / D-202. Gap: `G27`.
