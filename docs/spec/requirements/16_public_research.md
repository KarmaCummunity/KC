# 2.15 Public Market Research

> **Status:** 🟡 Code complete, post-merge QA pending — Survey B captures pain-language from alt-platform users (FB / WhatsApp / Agora). Output: Karma Phrasebook (see design spec §2). Migration `0123`, Edge Functions `public-research-submit` + `rotate-research-salt`, and `.web.tsx` routes are implemented; individual FR statuses remain ⏳ Planned until manual QA on dev confirms ACs.
> **Post-merge QA (2026-06-14):** fixed mid-survey draft loss on reload — answers lived in ephemeral React state and were wiped by any refresh; now persisted to `localStorage` (FR-RESEARCH-001 AC7). The public form was also reflowed into a single, more spacious scroll column (intro + progress + question scroll together; only the prev/next nav stays pinned). Backend save path verified healthy end-to-end on prod (origin allowlist, daily salt, service-role, RPC insert).
> **In progress:** FR-RESEARCH-004 (share affordance) — three viral surfaces (public thank-you page, public survey header, in-app Settings row) to make the survey self-spreading among non-registered users.

Prefix: `FR-RESEARCH-*`

## Scope

A public, anonymous web form at `/research/[slug]?src=...`, served from the Expo Router web bundle, never shown in mobile app shells. Survey content is server-driven through the same questions schema as Survey A; submissions go to a dedicated anonymous table fronted by an Edge Function for IP forwarding and origin validation.

---

## FR-RESEARCH-001 — Public market research runner

**Status.** ⏳ Planned

**Acceptance Criteria.**
- AC1. Web-only route `/research/[slug]` rendered via Expo Router `.web.tsx` platform extension. The route file does not exist in iOS/Android bundles (bundle-inspection test).
- AC2. No auth shell, no tab bar, no app navigation. Standalone landing. `AuthGate` treats `/research/*` as a public surface (same class as `/about`) so shared links never redirect to `/(auth)`.
- AC3. Reuses Survey A's question runner components; supports 11 questions for slug `alt-platforms-research`.
- AC4. Optional `?src=` query param captured and persisted on submission (regex `^[a-z0-9_-]{1,32}$`; defaults to `direct`).
- AC5. On submit, navigates to `/research/thanks` which offers an optional email opt-in for launch updates.
- AC6. Intro copy and CTA copy as per design spec §9.
- AC7. In-progress answers persist across reloads. Ratings, free text, the active-question index, and the contact fields are written to `localStorage` (keyed by slug, tagged with the bundle version) on every change and restored when the form remounts, so a refresh mid-survey no longer discards the visitor's work. The draft is cleared on successful submit, and ignored after a republish (version mismatch) or a 14-day TTL. Web-only; no-ops where `localStorage` is unavailable.

---

## FR-RESEARCH-002 — Anti-abuse for public research form

**Status.** ⏳ Planned

**Acceptance Criteria.**
- AC1. Hidden honeypot field; non-empty value → silent reject (200 OK but no row inserted).
- AC2. Edge Function `public-research-submit` validates `Origin` header against allowlist before invoking RPC.
- AC3. Per-IP-hash rate limit: 5/min, 30/hour, 100/day. IP hashed with daily-rotated salt (`research_secrets.daily_research_salt`). Hash computed in Edge Function from `x-forwarded-for`, not in Postgres.
- AC4. Global circuit breaker: if `>500` inserts in the last 60 seconds across all sources, RPC returns 503 (`research_circuit_open`).
- AC5. RPC is `SECURITY DEFINER` with `SET search_path = ''`; revoked from `PUBLIC`; explicit `GRANT EXECUTE TO anon`.

---

## FR-RESEARCH-003 — Contact-request opt-in

**Status.** ⏳ Planned

**Acceptance Criteria.**
- AC1. Submission can optionally include `contact_email` (RFC-5322-lite validated) + `contact_window_he` (free text ≤200 chars).
- AC2. Stored in separate table `public_research_contact_requests` with FK to `public_research_responses(id) ON DELETE CASCADE`. Survey answers and contact email are deletable independently.
- AC3. Only super-admins can read `public_research_contact_requests` (RLS denies all to anon/authenticated).
- AC4. Thank-you page `/research/thanks` shows email opt-in for launch updates as a separate, additional capture.

---

## FR-RESEARCH-004 — Share affordance for public research survey

**Status.** 🟡 Code complete, post-merge QA pending

**Acceptance Criteria.**
- AC1. On `/research/thanks` (web-only), a share button labeled "שתפו את הסקר עם חבר/ה" renders as a primary CTA, visible immediately on page load (not gated by the 5-second visit-CTA reveal timer), alongside the existing "Visit Karma site" CTA.
- AC2. On `/research/[slug]` (web-only), a small share affordance — icon + label "שתפו" — renders in the screen header area, visible from page load, positioned so the question rows remain the visual focus.
- AC3. The market-research survey card in `/settings/surveys` (all platforms) carries an inline share affordance (share icon, `in-app-share-settings` src). A separate top-of-page share row was removed (2026-06-13) to avoid duplicate share entry points on the same screen.
- AC4. Share flow: native iOS/Android uses `Share.share` (placement 3 only); web with `navigator.share` uses the Web Share API; web without uses `navigator.clipboard.writeText`. The flow never throws — it returns one of `{ kind: 'shared' | 'copied' | 'dismissed' | 'failed' }`.
- AC5. Shared URL is `${webBaseUrl}/research/alt-platforms-research?src=<placement-src>` where `<placement-src>` ∈ {`share-thanks`, `share-during-survey`, `in-app-share-settings`}. All three pass the CHECK regex `^[a-z0-9_-]{1,32}$`.
- AC6. The URL appears in the share message body exactly once on every platform (mirrors the FR-POST-023 fix).
- AC7. Recipients can open the link and submit answers without registration, login, or app install (already guaranteed by FR-RESEARCH-001 AC1-AC2; this AC asserts the invariant survives the new entry paths).
- AC10. Unauthenticated visitors see a guest-invite banner on `/research/*` (sign-up CTA, survey remains fully usable). After all questions are rated, an end-of-survey share card appears before submit. Both surveys show a thank-you modal on completion (public: on `/research/thanks`; in-app: on `/settings/survey/[slug]`).
- AC8. Status feedback: `shared` → "הקישור שותף" (2.2s success), `copied` → "הקישור הועתק" (2.2s success), `failed` → "לא הצלחנו לשתף, נסה/י שוב" (2.2s error), `dismissed` → silent. On web placements 1 and 2 where no toast host is mounted, an inline status line below the button (auto-clearing after 2.2s) is acceptable.
- AC9. `track('research_share_initiated', { src, outcome })` fires on every share attempt. Production-noop today per TD-161; will produce data once analytics ingest lands.

---

| Version | Date | Summary |
| ------- | ---- | ------- |
| 0.1 | 2026-05-26 | Initial draft. FR-RESEARCH-001..003 (public market research runner, anti-abuse, contact opt-in). |
| 0.2 | 2026-05-28 | FR-RESEARCH-004 (share affordance) — three viral surfaces to self-spread the survey. |
| 0.3 | 2026-06-14 | FR-RESEARCH-001 AC7 — in-progress answers persist across reload (localStorage draft, cleared on submit). Public form reflowed into one spacious scroll column. |
