# 2.22 Identity verification (ID document + face)

> **Status:** ⏳ Spec v1 (2026-11-03). Not implemented: today only a verified phone exists (FR-PROFILE-017) and `users.verified_at` / `verification_method` are set by hand. Blocked on a provider contract (FR-VERIFY-011).

Prefix: `FR-VERIFY-*`

> **Source of truth.** Product book [`docs/spec/07_cross_cutting_systems.md` §7.14](../07_cross_cutting_systems.md) wins where it disagrees (D35). Decisions: D23 (levels phone → ID → blue check, shown on post, card and profile; not blocking in general), D30 (housing: both sides; medical: bodies only), D31 (an event may require verified users), D48 (elderly home visit: ID-verified volunteer), D109 (private date of birth, minimum age 18), `D117` (what "ID verified" means). Fills pending approval: `S60`, `S61`, `S62`.

> **Scope.** A professional identity check that proves a real, adult person stands behind an account: a government identity document **and** a live face that matches it, run by a certified verification provider. KC keeps the result, never the images.

> **Non-goals (v1).** Background or criminal-record checks; address proof; verifying organizations (FR-ORG-*, D53); reading the passport NFC chip (V2); the "blue check" level beyond ID (D23, still open, G13); any use of the face data other than the one-time match.

---

## FR-VERIFY-001 — Verification levels (D23, `D`)
| Level | Name (HE) | Badge | How it is reached | Code |
|---|---|---|---|---|
| 0 | — | none | Signed up | none of the below |
| 1 | פרופיל מלא | green check | Complete profile (FR-VERIFY-012); no SMS, no cost (`D`) | all FR-VERIFY-012 AC1 fields non-empty |
| 2 | זהות מאומתת | blue check | ID document + live selfie match (this spec) | `users.verified_at IS NOT NULL` and `verification_method IN ('provider','manual')` (`'manual'` via FR-VERIFY-008) |
| 3 | ארגון מוכר | gold check | A recognised organization account (FR-ORG-019, D53) | the organization account type of `20_organizations.md`; renders nothing until that type ships |

- AC1. One server function `user_verification_level(uid) → smallint` is the only source for the level; cards, profiles, gates and RLS call it, never re-derive it. It returns the **highest** level whose condition holds.
- AC2. The level is shown as a badge next to the member's name (D23) on: profile (own and others'), post card, post detail, chat (inbox row and conversation header), search results and follow suggestions. One badge only — the highest level. The badge never shows which fields were filled, nor the document type, number, nationality or date of birth.
- AC3. The three badges share one check-mark shape and differ by color (green / blue / gold) from the design-system palette (`17_brand_and_design_system.md`); each has an accessibility label with the level name.
- AC4. Read paths that return another member (profile, post owner, chat peer, search, suggestions) carry the level as a number only; the private fields behind level 1 (street, contact phone, date of birth) are never exposed to compute it.
- AC5. The old "verified phone" level is withdrawn (`D`): phone OTP (FR-PROFILE-017) stays a sign-in method and does not change the level.

## FR-VERIFY-012 — Complete profile (level 1)
- AC1. A profile is complete when all of these are non-empty: `display_name`, `city`, `date_of_birth`, avatar (`avatar_url`), `profile_street` + `profile_street_number`, `contact_phone`. Biography is not required.
- AC2. The level updates on save: once the member fills the last field in Edit profile (FR-PROFILE-007), the badge appears without a restart; clearing a field drops the member back to level 0.
- AC3. Unit-tested completeness rule in the domain layer mirrors the SQL rule; an SQL test covers each missing field.

## FR-VERIFY-013 — Complete-profile nudges
Shown only to the signed-in member about their **own** profile, only while their level is 0.
- AC1. **Avatar dot.** A small accent dot on the member's own avatar (own profile header). Tapping the avatar area opens Edit profile.
- AC2. **Main feed banner.** At the top of the main feed (feed header slot, above other banners), a card: title "השלימו את הפרטים בפרופיל", body "פרופיל מלא מגדיל את הסיכוי למצוא התאמות", primary action "להשלמת הפרופיל" → Edit profile, and a close (×).
- AC2a. **Profile button.** On the member's own profile, the "Edit profile" button becomes a primary-filled "השלמת הפרופיל" button (same destination, Edit profile) while the level is 0; it is never snoozed.
- AC3. **Snooze.** Closing the banner hides it for 7 days (stored on the device per user); after that it returns until the profile is complete. The avatar dot is never snoozed.
- AC4. Both disappear as soon as the level reaches ≥ 1 (FR-VERIFY-012 AC2). Guests never see them.
- AC5. Copy lives in i18n (he + en); no Hebrew literals in code or SQL (D-24).

## FR-VERIFY-002 — Where verification is required
- AC1. **Required** (server-enforced, `world_permission_denied` / `verification_required`): every housing action of FR-HOUSING-003 AC1 (D30, `D116`); an elderly home-visit volunteer (D48); joining an event whose organizer requires it (D31).
- AC1a. **Emergency exception** (`D122`): in a declared emergency an evacuee housing **guest** without documents may be confirmed by a recognised organization instead (`verification_method='org_vouch'`), for evacuee stays in that region only, lapsing with the emergency (FR-HOUSING-033 AC3). Never for hosts.
- AC2. **Voluntary** everywhere else: any member may verify to earn the badge and the trust weight (D23 "not blocking").
- AC3. **Pre-check before effort.** A gated action reads the level first and shows the verification card instead of a form the member cannot submit (TD-245 pattern).

## FR-VERIFY-003 — Entry points
- AC1. Profile → "Verify my identity" row (until level 2); Settings → Account → Identity verification (status page); the verification card of every gated action (FR-VERIFY-002 AC3), which returns the member to that action when done.
- AC2. The status page shows: not started · in progress · in review · verified (with date) · declined (with the reason in plain language and what to do) · expired (FR-VERIFY-009).

## FR-VERIFY-004 — Explainer and consent
- AC1. Before the provider flow opens, one screen explains in plain Hebrew: why (safety of hosts and guests and of people at home), what is checked (document + live selfie), who does it (the named provider, on KC's behalf), what KC keeps (FR-VERIFY-006), how long the provider keeps images (FR-VERIFY-006 AC3), and that the member can withdraw.
- AC2. Explicit consent to processing biometric data (the face) is a separate unticked checkbox; without it the flow does not start. Consent is stored per user and text version (`identity_verification_consents (user_id, version, accepted_at)`), like legal documents.
- AC3. The consent and the privacy-policy addendum texts are the drafts in [`docs/legal/drafts/housing_and_verification_he.md`](../../legal/drafts/housing_and_verification_he.md) §13–§14, pending counsel review before launch.

## FR-VERIFY-005 — Verification flow
- AC1. Accepted documents: Israeli identity card (smart biometric card, front + back; legacy paper card: photo page only — the appendix (ספח) is **never** captured), Israeli passport, foreign passport (photo page). Driver's licences are not accepted in v1.
- AC2. Steps, inside the provider's hosted flow (opened in the in-app browser on iOS / Android and in a tab on web, so no native module is required): choose document → capture (glare / blur / crop checks live) → selfie with liveness (certified presentation-attack detection) → face match with the document photo → result.
- AC3. The session is created by the server (Edge Function `identity-verification-session`): it checks the attempt limits (FR-VERIFY-007), creates a provider session tied to the KC user id, and returns only the hosted-flow URL. The client never holds a provider key.
- AC4. The result arrives by a signed provider webhook (Edge Function `identity-verification-webhook`): signature verified, idempotent through `provider_webhook_events` (`0270`), then FR-VERIFY-006 applied. A client "done" redirect only refreshes the status; it never sets a level.
- AC5. Outcomes: `approved` → level 2; `declined` (forged / mismatch / underage / duplicate) → reason shown, retry rules of FR-VERIFY-007; `resubmit` (blurry, glare, expired document) → retry with tips; `review` → provider's or KC's manual review (FR-VERIFY-008).
- AC6. Median end-to-end time target: ≤ 3 minutes for the member, ≤ 2 minutes for an automatic decision.

## FR-VERIFY-006 — What KC stores (`S60`)
- AC1. `identity_verifications` (one row per attempt): `user_id`, `provider`, `provider_session_id`, `status`, `decision_reason_code`, `document_type` (`il_id_card` · `il_passport` · `foreign_passport`), `document_country` (ISO 3166-1), `document_expires_on`, `name_match` (boolean, legal name vs profile name), `created_at`, `decided_at`. **No images, no document number, no face template, no address.**
- AC2. `users`: `verified_at`, `verification_method='provider'`, `verification_expires_at` (FR-VERIFY-009); the document's date of birth is written to the private date of birth (D109) — if the member's self-declared date differs, the document wins and the change is logged.
- AC3. The provider deletes images and biometric data within 30 days of the decision (contract term, FR-VERIFY-011); a declined attempt under fraud review may be kept up to 90 days.
- AC4. **One person, one account.** The server stores a keyed hash (HMAC with a secret held as an environment secret, by name `IDV_IDENTITY_HASH_KEY`) of `document_country + document number`, given by the provider in the webhook and never written in clear. A second account presenting the same identity is declined with `identity_already_used` and pointed to account recovery / support (also serves D49 "one verified person one vote").
- AC5. The legal name returned by the provider is **not** stored; only `name_match` is. A strong mismatch (`name_match=false`) does not block, but is a trust-engine signal (G10) and shows the member a prompt to use their real name in housing.
- AC6. Account deletion (D108): at purge, `identity_verifications` rows are deleted; the identity hash is kept 12 months only for an account that was banned, to stop re-registration of a banned person, then deleted.
- AC7. RLS: a member reads only their own `identity_verifications` status columns; support and super-admins read all; no anon access. Every admin read is audited.

## FR-VERIFY-007 — Attempts and abuse (`S61`)
- AC1. At most 3 sessions per member per 24 h and 5 per 30 days (cost and fraud control); beyond that → `verification_attempts_exhausted`, with the support path.
- AC2. Two `declined` results for forgery or face mismatch → no further automatic attempts; KC manual review only (FR-VERIFY-008) and an admin task.
- AC3. Underage result (document date of birth < 18, D109) → declined; the account is flagged for review under the minimum-age rule.

## FR-VERIFY-008 — Manual review fallback
- AC1. When the provider returns `review`, or a member is stuck after FR-VERIFY-007 AC2, a KC admin with permission `users.verify` reviews in the provider's dashboard (images are not copied into KC) and decides approve / decline with a reason; approve sets `verification_method='manual'`.
- AC2. Target: 48 h. The member sees "in review".
- AC3. Every manual decision is in the admin audit log.

## FR-VERIFY-009 — Validity and re-verification (`S62`)
- AC1. A verification is valid until the earlier of the document's expiry date and 5 years after `verified_at` (`verification_expires_at`).
- AC2. 30 days before expiry the member is reminded; at expiry the level drops to 1 and gated actions show the verification card again. Confirmed housing bookings already made are not cancelled by an expiry.
- AC3. An admin may revoke a verification (fraud, impersonation): level drops at once, the member is told, and FR-HOUSING-025 applies to their housing activity.

## FR-VERIFY-010 — Architecture
- AC1. Port `IIdentityVerificationService` in `@kc/application` (`startSession`, `getStatus`), use cases `StartIdentityVerificationUseCase`, `GetIdentityVerificationStatusUseCase`; one adapter per provider in `@kc/infrastructure-supabase` calling the Edge Functions. Domain: `VerificationLevel`, `IdentityVerificationStatus`, `IdentityVerificationError`.
- AC2. Provider-specific code lives only in the two Edge Functions behind a small provider seam, so the provider can be swapped without client changes (the D65 translation-provider pattern).
- AC3. Secrets by name only: `IDV_PROVIDER_API_KEY`, `IDV_WEBHOOK_SECRET`, `IDV_IDENTITY_HASH_KEY` (Supabase function secrets, per environment). kc-dev uses the provider's sandbox.
- AC4. Tests: domain level function; webhook signature + idempotency; RLS probe in `supabase/tests/`; a Maestro flow against the sandbox for the happy path and a declined path.

## FR-VERIFY-011 — Provider selection (PM action)
- AC1. Requirements: Israeli identity card (smart card) and passports of every country; certified liveness (ISO/IEC 30107-3 presentation-attack detection, tested by an accredited lab); Hebrew UI and RTL; a hosted web flow; signed webhooks; configurable image retention ≤ 30 days; a data-processing agreement acceptable under the Israeli Privacy Protection Law and its amendment 13; per-verification pricing within the launch budget.
- AC2. Candidates to evaluate (no preference implied): Au10tix (Israeli), Sumsub, Veriff, Onfido, Persona.
- AC3. The PM chooses, signs the contract and DPA, and provides the sandbox and production keys through the environment secrets of FR-VERIFY-010 AC3. This is the blocker of HOUSING-H0.

## Notifications
| Key | Trigger | Recipient | Group |
|---|---|---|---|
| `identity_verified` | `approved` | Member | important |
| `identity_verification_declined` | `declined` / `resubmit` | Member | important |
| `identity_verification_expiring` | expiry − 30 d | Member | important |
| `identity_verification_revoked` | admin revoke | Member | important |

## Success metrics
| Metric | Target |
|---|---|
| Started → approved | ≥ 80% |
| Median time to decision | ≤ 2 min (automatic) |
| Manual reviews | ≤ 10% of sessions |
| Duplicate-identity declines | tracked |

## Change log
| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-11-03 | New domain file: ID document + live selfie via a certified provider (`D117`); FR-VERIFY-001…011. |
| 0.2 | 2026-11-07 | Levels reshaped (`D`): 1 = complete profile (FR-VERIFY-012, replaces verified phone), 2 = ID, 3 = recognised organization; color-tier badges and display surfaces (FR-VERIFY-001 AC2–AC5); complete-profile nudges (FR-VERIFY-013). |
