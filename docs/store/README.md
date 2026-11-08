# Store submission kit (TestFlight / App Store, Play internal / production)

Status: **DRAFT — everything legal or listing-facing needs Nave's review before submission.**
Bundle id / package: `org.karmacommunity.app`. Config: `app/apps/mobile/app.json`, `app.config.ts`, `eas.json`.
Release mechanics: [docs/agents/RELEASE.md](../agents/RELEASE.md).

| File | What |
|---|---|
| [listing-he.md](./listing-he.md) / [listing-en.md](./listing-en.md) | Name, subtitle, short/full description, keywords, categories, URLs, what's new |
| `app/apps/mobile/public/privacy.html` → `/privacy` | Public privacy policy, he + en (`#en`), no login, no JS |
| `app/apps/mobile/public/terms.html` → `/terms` | Public terms of use, he + en, incl. zero-tolerance UGC clause (Apple 1.2) |
| `app/apps/mobile/public/support.html` → `/support` | **Support URL**: contact email, FAQ, how to report / block / delete account (he by default, en at `#en`; one language shown at a time, CSS-only toggle) |

## Readiness checklist

| Item | Status |
|---|---|
| App icon 1024 (no alpha), Play icon 512, adaptive icon + monochrome | ✅ |
| Splash (was corrupt, regenerated) | ✅ |
| Permission strings he + en, honest purposes (camera, photos, notifications; no location, no microphone) | ✅ |
| iOS privacy manifest (`privacyManifests` in app.json) | ✅ |
| `ITSAppUsesNonExemptEncryption = false` (HTTPS / OS crypto only) | ✅ |
| Android target/compile SDK 36 | ✅ |
| Versioning: `app/VERSION` + EAS remote build numbers, `autoIncrement` | ✅ |
| Sign in with Apple (required because Google sign-in is offered, 4.8) | ✅ entitlement on |
| In-app account deletion (5.1.1(v)) | ✅ Settings → מחק חשבון (needs `delete-account` deployed per env) |
| Report post / listing / chat / user (1.2) | ✅ |
| Block user (1.2) | ✅ profile ⋮ menu |
| Public privacy + terms + support URLs | ✅ on dev; reaches `karma-community-kc.com` only with a dev → main release |
| In-app `/legal/*` readable while signed out | ✅ |
| Store listing text he + en | ✅ draft |
| Screenshots (6.7" + 6.5" iPhone, Play phone) | ⏳ to capture from a preview build |
| Review demo account | ⏳ needs Nave (see decisions) |

## Blocked on keys / access (Nave)

- **Apple:** App Store Connect app record + `ascAppId` in `eas.json` (`submit.production.ios.ascAppId` is a placeholder), ASC API key (Issuer ID, Key ID, .p8) as EAS / GitHub secrets, Apple Team ID.
- **Expo:** `EXPO_TOKEN` (EAS build + submit).
- **Google Play:** Play Console app record, service-account JSON for `eas submit` (`google-play-service-account.json`, never committed — EAS secret), first AAB uploaded manually once (Play requirement).
- **Prod Edge Functions:** `delete-account` must be deployed to prod too (prod functions workflow is disabled by policy).

## Decisions Nave must make (business / legal)

1. **Legal text sign-off.** Privacy policy + terms are drafts based on the in-app v2 documents, updated for current processors (Supabase, Cloudflare, Expo, Google/Apple sign-in, Google Gemini translation, Meta WhatsApp, Sentry, PostHog, payment provider). A lawyer should review. The in-app v2 privacy text says "deleted account: 30 days then hard delete", but the app deletes immediately — the draft says immediate; the in-app document should be republished to match.
2. **Money donations on iOS (guideline 3.2.1(vi) / 3.2.2(iv)).** In-app donations are only allowed for Apple-approved nonprofits (with Apple Pay) or by linking out to the browser. Options: (a) hide the money world on iOS for v1, (b) open donations in Safari, (c) apply as an approved nonprofit. Recommendation: (a) or (b) for the first TestFlight/App Store build.
3. **Retention of financial records on account deletion.** Implemented as: payments, receipts and donation intents are kept but de-identified (user link removed). Confirm this matches accounting obligations.
4. **24-hour report handling.** Terms commit to reviewing reports within 24 hours (Apple expects timely action on UGC reports). Confirm someone owns the moderation queue.
5. **Store name.** "KC - קהילת קארמה" / "KC - Karma Community" — the app name with the `KC - ` prefix (spec 17 §1; the locale `appName`, pinned by `brandGuard.test.ts`). The name must be unique on the App Store; "KC" alone is the iOS display name.
6. **Review account.** Apple/Google reviewers need a working login on prod (email + password) and notes; create a dedicated reviewer account on prod.
7. **Support URL.** Done: `/support` (he + en). Confirm the support email `karmacommunity2.0@gmail.com` is the one to publish.
8. **WhatsApp bot data** (phone numbers) is collected outside the app but by the same service — include it in the App Privacy answers (done below) or keep the bot separate.

## Age rating answers (draft)

Apple (questionnaire) — expected result **13+**, matching the 13+ minimum age in the terms:
- Violence, sexual content/nudity, profanity, horror, mature/suggestive themes, alcohol/tobacco/drugs, simulated gambling, contests, medical/treatment info: **None**
- User-generated content: **Yes** (posts, listings, comments, photos) — moderated, report + block available
- Messaging / chat between users: **Yes**
- Unrestricted web access: **No**
- Made for kids: **No**

Google Play (IARC): category *Social / Communication*; users can interact and exchange content: **Yes**; shares user's current location with others: **No** (city only, typed by the user); digital purchases: **No** (donations go to nonprofits via a payment provider, not in-app purchases); expected rating **Teen / PEGI 12**.

## App Privacy (Apple) / Data safety (Play) — draft answers

Tracking: **No**. Data sold: **No**. Data encrypted in transit: **Yes**. Users can request deletion: **Yes** (in-app).

| Data | Collected | Linked to user | Purpose |
|---|---|---|---|
| Name, email, user ID | Yes | Yes | App functionality (account) |
| Phone number | Only via WhatsApp bot | Yes | App functionality |
| Coarse location (city the user picks) | Yes | Yes | App functionality (matching) |
| Photos | Yes | Yes | App functionality (posts, listings, avatar) |
| Messages (chat) | Yes | Yes | App functionality |
| Other user content (posts, comments, reports) | Yes | Yes | App functionality, moderation |
| Purchase / donation history | Yes (money world) | Yes, de-identified on deletion | App functionality |
| Product interaction (PostHog) | Yes | No | Analytics |
| Crash + performance data (Sentry) | Yes | No | App functionality / analytics |
| Precise location, contacts, health, browsing history, advertising ID | No | — | — |

## Review notes template

> Karma Community is a free giving community (items, food, rides, volunteering, knowledge, donations to verified nonprofits). Sign in with the demo account below. To test reporting: open any post → ⋮ → Report. To block a user: open a profile → ⋮ → Block. To delete an account: Settings → Delete account.
> Demo account: *(to be created by Nave on prod — never commit credentials)*

## Screenshots

Draft captures at the required sizes are in [`screenshots/`](screenshots/README.md): iPhone 6.9", iPhone 6.5", Android phone.
