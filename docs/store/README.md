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
| Permission strings he + en, honest purposes (camera, photos, notifications, approximate location while the app is in use for the map's "near me" and a ride's starting city; no background location, no microphone) | ✅ Location is requested on iOS and on the web only: Android blocks both location permissions (`app.json` `blockedPermissions`). [TO CONFIRM] the iOS `locationWhenInUsePermission` string names only the map, while the ride "from my current location" switch (`RideRouteFields.tsx`) uses it too |
| iOS privacy manifest (`privacyManifests` in app.json) | ✅ |
| `ITSAppUsesNonExemptEncryption = false` (HTTPS / OS crypto only) | ✅ |
| Android target/compile SDK 36 | ✅ |
| Versioning: `app/VERSION` + EAS remote build numbers, `autoIncrement` | ✅ |
| Sign in with Apple (required because Google sign-in is offered, 4.8) | ✅ entitlement on |
| In-app account deletion (5.1.1(v)) | ✅ Settings → מחק חשבון: the `request_account_deletion` RPC deactivates the account at once and the `purge-deleted-accounts` worker purges it after the 30-day grace period |
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

## Decisions Nave must make (business / legal)

1. **Legal text sign-off.** The public privacy policy (`/privacy`) is a draft that follows what the code does: 18+, approximate device location (iOS and web), the full data list including date of birth, processors (Supabase, Cloudflare, Expo, Google/Apple sign-in and purchases, RevenueCat, Meta WhatsApp, Sentry and PostHog on US hosts, map providers: OpenStreetMap tiles on the web, Apple Maps on iOS, Google Maps on Android, payment provider), identity verification by Didit (document, liveness, face match: biometric, behind a recorded consent; not yet offered in the app), deletion = hidden at once and purged after the 30-day grace period, and the retention periods the code enforces. Automatic translation of member content is off (`ugc_auto_translation` defaults to off), so no translation provider is listed. The Gemini features (match re-rank, external post import) are built but off (`llm_rerank_enabled`, `external_post_import_enabled`); the WhatsApp Pro assistant runs only when its Gemini key is set [TO CONFIRM]. Items marked [TO CONFIRM] / [להשלמה] need a decision, and a lawyer should review. The in-app legal text (`legal_document_versions`, still version 1 with 13+ on prod) is updated separately with the database changes, after the lawyer's review.
2. **Money donations on iOS (guideline 3.2.1(vi) / 3.2.2(iv)).** In-app donations are only allowed for Apple-approved nonprofits (with Apple Pay) or by linking out to the browser. Options: (a) hide the money world on iOS for v1, (b) open donations in Safari, (c) apply as an approved nonprofit. Recommendation: (a) or (b) for the first TestFlight/App Store build.
3. **Retention of financial records on account deletion.** Implemented as: payments, receipts and donation intents are kept but de-identified (user link removed). Confirm this matches accounting obligations.
4. **24-hour report handling.** Terms commit to reviewing reports within 24 hours (Apple expects timely action on UGC reports). Confirm someone owns the moderation queue.
5. **Store name.** "KC - קהילת קארמה" / "KC - Karma Community" — the app name with the `KC - ` prefix (spec 17 §1; the locale `appName`, pinned by `brandGuard.test.ts`). The name must be unique on the App Store; "KC" alone is the iOS display name.
6. **Review account.** Apple/Google reviewers need a working login on prod (email + password) and notes; create a dedicated reviewer account on prod.
7. **Support URL.** Done: `/support` (he + en). Confirm the support email `karmacommunity2.0@gmail.com` is the one to publish.
8. **WhatsApp bot data** (phone numbers) is collected outside the app but by the same service — include it in the App Privacy answers (done below) or keep the bot separate.

## Age rating answers (draft)

Apple (questionnaire) — expected content rating **13+** [TO CONFIRM: whether to declare 18+ to match the app's minimum age]. Independently of the rating, the app's own minimum age is **18** (terms, privacy policy and the date-of-birth check at sign-up):
- Violence, sexual content/nudity, profanity, horror, mature/suggestive themes, alcohol/tobacco/drugs, simulated gambling, contests, medical/treatment info: **None**
- User-generated content: **Yes** (posts, listings, comments, photos) — moderated, report + block available
- Messaging / chat between users: **Yes**
- Unrestricted web access: **No**
- Made for kids: **No**

Google Play (IARC): category *Social / Communication*; users can interact and exchange content: **Yes**; shares user's current location with others: **No** (on iOS and the web, the device's approximate location is used on the device for the map and a ride's starting city and is not stored; a post shows only an approximate location); digital purchases: **Yes** (the KC Pro subscription through App Store / Google Play billing, managed by RevenueCat — behind the `pro_paywall` flag; money donations to nonprofits go through a payment provider and are not in-app purchases); expected rating **Teen / PEGI 12** [TO CONFIRM: same question as the Apple rating, given the 18+ minimum age].

## App Privacy (Apple) / Data safety (Play) — draft answers

Tracking: **No**. Data sold: **No**. Data encrypted in transit: **Yes**. Users can request deletion: **Yes** (in-app; the account is hidden at once and permanently deleted after a 30-day grace period).

| Data | Collected | Linked to user | Purpose |
|---|---|---|---|
| Name, email, user ID | Yes | Yes | App functionality (account) |
| Phone number | Optional contact phone (shown only in a direct chat); WhatsApp bot users | Yes | App functionality |
| Physical address | Optional (profile street, event address, meeting points) | Yes | App functionality |
| Date of birth | Yes | Yes | App functionality (age check, 18+) |
| Approximate location (device, about 100 m, while in use; iOS and web only) | Yes, processed on the device, not stored | No | App functionality (map "near me", ride starting city) |
| Coarse location (city, saved ride routes, emergency report location the user chooses) | Yes | Yes | App functionality (matching) |
| IP address and user agent (records of accepting the terms / privacy policy) | Yes | Yes | App functionality (legal record) |
| Survey answers, feedback | Yes | Yes | Product improvement |
| Photos | Yes | Yes | App functionality (posts, listings, avatar) |
| Messages (chat) | Yes | Yes | App functionality |
| Other user content (posts, comments, reports) | Yes | Yes | App functionality, moderation |
| Purchase / donation history (donations; in-app subscription status via RevenueCat) | Yes | Yes, de-identified on deletion | App functionality |
| Government ID and biometric data (identity verification by Didit: document photo, selfie, face match) | Not yet: the feature is not offered in the app. Once it is: Yes, processed by Didit; KC stores the outcome, document type / country / expiry, date of birth, name match yes/no and a keyed hash of the document number | Yes | App functionality (verification level) |
| Product interaction (PostHog) | Yes | No | Analytics |
| Crash + performance data (Sentry) | Yes | No | App functionality / analytics |
| Precise location, contacts, health, browsing history, advertising ID | No | — | — |

## Review notes template

> Karma Community is a free giving community (items, food, rides, volunteering, knowledge, donations to verified nonprofits). Sign in with the demo account below. To test reporting: open any post → ⋮ → Report. To block a user: open a profile → ⋮ → Block. To delete an account: Settings → Delete account.
> Demo account: *(to be created by Nave on prod — never commit credentials)*

## Screenshots

Draft captures at the required sizes are in [`screenshots/`](screenshots/README.md): iPhone 6.9", iPhone 6.5", Android phone.
