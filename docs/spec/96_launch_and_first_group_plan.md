# 96 — Path to official launch and the first WhatsApp group migration (2026-10-30)

Goal: (1) official release on the App Store and Google Play (D58), and (2) migrate **one whole WhatsApp group — rides or items** — into the app (D38, D47).
Each item says who acts. **PM** = needs the PM (credential, account, decision, legal). **Eng** = engineering can do it alone and is tracked as a gap (`G#`).

Security work is tracked privately and is not listed here (README rule).

## 1. Access and credentials (PM)

| # | Need | Why / unblocks | Where it goes |
|---|---|---|---|
| A1 | Invite the Claude-connected Supabase account to the **karmacommunity2.0** Supabase org (Owner or Admin) | Live `kc-dev` / `kc-prod` are in that org; enables advisor scans, drift checks, verifying migrations | Supabase → Organization → Team → Invite |
| A2 | Apple **Team ID** | Universal Links manifest (`TD-66`) | `public/.well-known/apple-app-site-association` (not secret) |
| A3 | Android **release keystore SHA-256** | App Links manifest (`TD-66`) | `public/.well-known/assetlinks.json` (not secret) |
| A4 | Google Play Console access + app record, Data safety answers | Android store release (`play-internal.yml`) | Play Console |
| A5 | **Custom SMTP** provider (e.g. Resend / SendGrid) for Supabase Auth | Supabase's built-in mailer is rate-limited and not for production; reset-password and verification emails (FR-AUTH-006/008) | Supabase → Auth → SMTP (secret by name only) |
| A6 | Hosted **"Reset password" email template** → `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`, recovery expiry 30 min | FR-AUTH-008 (shipped in code) | Supabase → Auth → Templates (dev + prod) |
| A7 | **SMS provider** (e.g. Twilio) for Supabase phone auth | Phone verification (D23) and **claiming imported posts by phone** (S21) | Supabase → Auth → Phone (secret by name only) |
| A8 | **WhatsApp Business**: Meta business verification, WABA, a dedicated KC number, approved display name; then `WHATSAPP_CLOUD_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WABA_ID` | The existing 1:1 bot (posting, search, match notices, consent) and the group bridge | Supabase Edge secrets; template submission per `docs/agents/WHATSAPP_TEMPLATES.md` |
| A9 | Apple **Sign in with Apple** provider config (Services ID + key) in Supabase | Native Apple sign-in is coded; the live flow needs the provider (`TD-24`) | Supabase → Auth → Providers |
| A10 | Confirm which Supabase project **TestFlight** builds use (repo-level secrets `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY`) | D8 — testers must not hit seed data by mistake (G7, Q-6) | GitHub → Settings → Secrets (names only) |
| A11 | Grow merchant account + two hosted pages — one-time and monthly standing order (only if the `money` world is on at launch) | D20 donation to KC (`FR-DONATE-011`) | Insert the page URLs into `public.kc_support_channels` (`OPERATOR_RUNBOOK.md` → KC support channels) — no release needed |
| A12 | **Identity-verification provider**: choose (FR-VERIFY-011 criteria), sign the contract + DPA, sandbox and production keys as environment secrets | Housing launch (D30), elderly home visits (D48) — `D117` | Supabase function secrets `IDV_PROVIDER_API_KEY`, `IDV_WEBHOOK_SECRET`, `IDV_IDENTITY_HASH_KEY` |

## 2. Product decisions (PM)

| # | Decision | Blocks |
|---|---|---|
| P1 | **Which group first: rides or items?** Name, size, admin contact | Everything in §4 |
| P2 | ✅ D102 — launch worlds are items, rides and food (rides flag on since `0511`, time on since `0523`); other worlds are portals (D60) | Launch scope, rides migration |
| P3 | **Import consent (D54, open):** may non-members' messages appear (anonymously, 72 h) or only consenting members'? | Chat-export import design |
| P4 | ✅ D61 — Moderation thresholds (Q-2, D33) | Launch moderation behavior |
| P5 | ✅ D59 — Expiry per type + relevance reminder (G32, D21) — confirm before items stop expiring | Feed quality after launch |
| P6 | Approve the `S#` fills the launch relies on: S1–S4 (post lifecycle), S10 (notification defaults), S11–S12 (suspension), S21–S23 (import, claim, bridge), S34 (limits) | Irreversible behavior must not rest on `S#` alone |
| P7 | Q-3, Q-4, Q-5, Q-8 in [95](./95_reconciliation.md) | Data cleanup, karma totals, deletion behavior |
| P8 | Profile "marketplace" tab (G6, D14): remove it (a feature deletion) or keep for now? | Profile UI |

## 3. Legal and store listing (PM)

| # | Need |
|---|---|
| L1 | Final **Terms of Use** and **Privacy Policy** (dev holds DRAFT texts, migration `0402`) — legal review, incl. Israeli Privacy Protection (Amendment 13) and the database-registration threshold (`TD-54`) |
| L2 | Legal opinion on WhatsApp import (WhatsApp terms + privacy of non-members), tied to P3 |
| L3 | Rides liability wording (cost-sharing caps, no profit — 05.3) |
| L4 | Store listings: app name, subtitle, description (he/en), keywords, screenshots (`docs/store/`), support URL, privacy "nutrition labels" / Data safety answers, age rating |
| L5 | TestFlight **external testers**: tester emails and Beta App Review info (what to test, contact) |
| L6 | Counsel review of the housing and identity-verification legal drafts and the questions for counsel (`docs/legal/drafts/housing_and_verification_he.md`, `D118`) — before the housing launch |

## 4. First group migration — run sheet

| Step | Who | What |
|---|---|---|
| M1 | PM | Recruit the group admin; agree the plan and announcement (S21: admin approval + member announcement) |
| M2 | Eng | Draft the member announcement and FAQ (he) for PM approval |
| M3 | Eng | **Build chat-export import (G27):** parser for WhatsApp `.txt` exports (he/en date formats, multi-line messages, system lines), classifier to post type / world / city, low-confidence review queue, imported post shown "from group X" without identity, claim by phone verification, unclaimed deleted after 72 h (S21) |
| M4 | Eng | Rides readiness: rides world end-to-end on dev, origin/destination/time parsing for ride messages, expiry +30 min (D21) |
| M5 | PM | Admin exports the chat **without media** and shares it through the agreed channel |
| M6 | Eng | Import into **kc-dev** first; PM reviews the review queue and sample posts |
| M6a | Eng | Import the PM-approved posts into **kc-prod** (the project the store app uses, A1/A10) and confirm they appear in the production app before any bridge link is shared |
| M7 | PM + Eng | Group bridge (S23): bot or admin posts daily summaries with app links; measure claimed posts (16 KPIs) |
| M8 | PM | Admin locks the group once most activity moved |

## 5. Engineering work that needs nothing from the PM

Expiry + relevance reminder (G32, after P5), `hidden_pending_review` moderation (G33, after P4), OTA updates (`expo-updates`), full Content-Security-Policy, route-level error boundaries (✅ 2026-10-30: `(tabs)`, `(admin)`, `chat`, `post` — `RouteErrorBoundary`, reported to Sentry), world list cleanup (G35, after Q-3), the chat-export importer (G27) up to the consent switch (P3), store-readiness checks.
