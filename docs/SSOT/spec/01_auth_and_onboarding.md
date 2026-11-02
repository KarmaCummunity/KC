# 2.1 Authentication & Onboarding

> **Status:** 🟡 Partial — Google + guest preview shipped; email/password via secondary link on welcome. Full `FR-AUTH-002` picker (Phone OTP, tabbed email) deferred — `TD-151`; Apple SSO (`FR-AUTH-004`) implemented natively (`D-58`, 2026-06-04), live flow pends Supabase Apple provider config. Onboarding + sessions + delete: ✅. **Audit 2026-05-29:** `performFullSignOut` + restore expiry sign-out shipped (TD-164). ⚠️ Audit 2026-05-16: ~~🔴 **FR-AUTH-017 AC3** sign-out leaves Expo push token active~~ addressed by TD-164; ~~welcome screen has no email entry per FR-AUTH-001 AC2 (TD-104)~~ ✅ 2026-10-30 — "continue with email" text link restored on every platform (KC#1269, `testID=auth-email-entry`); ~~Forgot Password button dead (FR-AUTH-008 unimplemented)~~ ✅ FR-AUTH-008 implemented 2026-10-30; FR-AUTH-015 soft-gate wired only to post-create (not follow + chat); FR-AUTH-016 30-day re-registration cooldown unimplemented; FR-AUTH-011 AC2 avatar resize 512 vs spec'd 1024; SignInWithEmail short-circuits `invalid_email` distinct from `authentication_failed` (D-22 spirit). See `docs/SSOT/archive/audit/2026-05-16/02_auth_profile.md`.



Prefix: `FR-AUTH-*`

---

## Scope

Everything from app launch through the moment the user lands on the Home Feed for the first time, including:

- Splash / Welcome screen
- Sign-up & sign-in entry points
- Three core authentication methods (Google SSO, Phone OTP, Email + password) plus Apple SSO on iOS
- 4-step onboarding wizard (mini about → basic info → profile photo → tour)
- Returning-user session resumption
- Guest preview
- Account deletion & re-registration cooldown

Out of scope here (see referenced files):

- Profile editing after onboarding → [`02_profile_and_privacy.md`](./02_profile_and_privacy.md)
- Settings screen (where the user logs out) → [`11_settings.md`](./11_settings.md)

---

## FR-AUTH-001 — Splash & Welcome screen

**Description.**
Every unauthenticated launch starts on the Splash / Welcome screen showing the value proposition, a primary "Sign up" button, and a secondary "Log in" button.

**Source.**
- PRD: `04_User_Flows.md` Flow 1, `05_Screen_UI_Mapping.md` §1.1.
- Constraints: `R-MVP-Core-2`.

**Acceptance Criteria.**
- AC1. The screen renders within `NFR-PERF-001` (cold-start budget) and exposes both CTAs above the fold on every supported breakpoint.
- AC2. Tapping "Sign up" or "Log in" navigates to the auth screen (`FR-AUTH-002`).
- AC3. A "View as Guest" affordance is visible and routes to `FR-AUTH-014`.
- AC4. The screen is the only screen reachable in the unauthenticated state; any deep link that targets an authenticated screen redirects here first.

**Edge Cases.**
- A user who has a valid session token never sees this screen on launch (see `FR-AUTH-013`).

**Related.** Screens: 1.1 · Domain: `Session`.

---

## FR-AUTH-002 — Authentication entry screen

**Description.**
A single screen exposes all available authentication methods. The set of methods shown is platform-dependent.

**Source.**
- PRD: `03_Core_Features.md` §3.1.1, `05_Screen_UI_Mapping.md` §1.2.
- Constraints: `R-MVP-Core-8`.

**Acceptance Criteria.**
- AC1. On Android and Web, the screen shows: "Continue with Google", "Phone (OTP)" tab, "Email + password" tab.
- AC2. On iOS, the screen additionally shows "Continue with Apple" alongside "Continue with Google" (App Store mandatory parity).
- AC3. The screen offers a single Terms-of-Service consent checkbox required for sign-up; sign-in does not require re-consent.
- AC4. Selecting a method that is unavailable due to a misconfiguration (e.g. Google client not initialized) surfaces a non-blocking error toast and the screen remains usable for the other methods.
- AC5. On successful authentication completion (Google / Apple / email-password), the user is routed to the legal consent gate **before** the authenticated shell renders and before the onboarding soft gate is evaluated. The gate is satisfied either by an existing `user_legal_acceptances` row clearing `needs_legal_reacknowledgement` for the current user, or by completing the post-OAuth consent screen (`FR-SETTINGS-010` AC4). Sign-out from the consent screen returns the user to the welcome screen with the auth session terminated.

**Edge Cases.**
- A user who already linked one method cannot link a second one in MVP (`FR-AUTH-009`).
- A user installing on iOS who previously signed up on Web with email continues to use email; Apple SSO does not auto-link.

**Related.** Screens: 1.2 · Domain: `AuthMethod` enum.

**MVP implementation note (2026-05-12).** The mobile welcome surface (`app/(auth)/index.tsx`) does **not** render the full-width Phone or Email method rows: they were display-only stubs (Phone routed users into the email/password screen without an OTP flow). Current ship: Google SSO, guest preview (`FR-AUTH-014`), an iOS-only Apple **button shell** (still incomplete per `TD-24`), and a tertiary text link to email/password sign-in. Restoring `FR-AUTH-002` AC1–AC2 fidelity is tracked as **`TD-151`** in [`TECH_DEBT.md`](../TECH_DEBT.md).

**Implementation note — web Google sign-in via same-tab redirect (2026-05-17).** On Web, "Continue with Google" performs a **top-level same-tab navigation** to `accounts.google.com` (the standard pattern used by Notion / Linear / GitHub) — no `window.open` popup, no Safari popup-block. The user picks an account on Google's own page, the browser returns to `/auth/callback?code=…`, and the existing callback handler exchanges the code for a Supabase session. Native (iOS ASWebAuthSession, Android Chrome Custom Tabs) is unchanged. Decision recorded in [`DECISIONS.md`](../DECISIONS.md) as `D-33`. An earlier attempt to embed Google Identity Services (`D-32` first-claim, reverted) failed because Google's `accounts.google.com` page sends `X-Frame-Options: DENY` and GIS falls back to `window.open` (blocked by mobile Safari). The in-app "bottom-sheet account picker" UX requested in product remains a goal — it will be delivered on native via the official Google Sign-In SDK (`@react-native-google-signin/google-signin`) in a follow-up PR; on Web the same-tab redirect is the only path that avoids the popup-block constraint.

---

## FR-AUTH-003 — Sign up via Google SSO

**Description.**
A new user signs up using Google and lands in the onboarding wizard with name and profile photo prefilled when available.

**Source.**
- PRD: `03_Core_Features.md` §3.1.1, `04_User_Flows.md` Flow 1.
- Constraints: `R-MVP-Core-8`, `R-MVP-Core-9`.

**Acceptance Criteria.**
- AC1. After successful Google authorization, the system creates a `User` record with `auth_method = google`, the verified Google account email, and pre-populates `display_name` and `avatar_url` from the Google profile when permitted.
- AC2. If a `User` already exists for the same Google `sub`, the user is signed in (treated as `FR-AUTH-007`) — no duplicate created.
- AC3. The user proceeds to the onboarding wizard (`FR-AUTH-010`) with the prefilled fields editable.
- AC4. Cancellation of the Google consent screen returns the user to `FR-AUTH-002` with no state change.
- AC5. **Session profile metadata**: `AuthSession` exposes `displayName` and `avatarUrl` derived from Supabase Auth `user_metadata` (`full_name`/`name`, `avatar_url`/`picture`). **`public.users` is the source of truth** for profile chrome; `IAuthService.syncProfileMetadata` + `ReconcileAuthProfileMetadataUseCase` keep JWT metadata aligned on profile writes and cold start (`FR-PROFILE-007` AC6, `D-38`). My Profile reads from the profile query only — not session fallbacks.

**Edge Cases.**
- The Google account has no profile picture: user proceeds with the default silhouette and is offered the upload step in onboarding.
- The Google account email matches a previously deleted account inside the 30-day cooldown (`FR-AUTH-016`): sign-up is rejected with a clear message instructing to retry after the cooldown.

**Related.** Screens: 1.2, 1.4–1.6 · Domain: `User`, `Session`, `AuthMethod`.

---

## FR-AUTH-004 — Sign up via Apple SSO (iOS only)

**Description.**
On iOS, a user may sign up with "Sign in with Apple". The flow is otherwise identical to `FR-AUTH-003`.

**Source.**
- PRD: `03_Core_Features.md` §3.1.1, `06_Navigation_Structure.md` §6.6.3.
- Constraints: `R-MVP-Core-8`.

**Acceptance Criteria.**
- AC1. On iOS, the button is rendered with parity to Google. On Android and Web, the button is **not** rendered.
- AC2. The system creates a `User` with `auth_method = apple`. Apple's "hide email" relay is stored as the canonical email; the user is informed once that email change requires support.
- AC3. Apple's `name` payload is captured and pre-populated into the onboarding wizard. Re-authentications do not re-deliver this payload — the system must not depend on it after the first completion.

**Edge Cases.**
- The user revokes Apple authorization later (Settings > Apple ID): existing app session remains valid until token expiry; subsequent re-auth attempts route to `FR-AUTH-002`.

**Implementation (2026-06-04).** Native Sign in with Apple via `expo-apple-authentication` → `supabase.auth.signInWithIdToken({ provider: 'apple' })` with a raw nonce (`SignInWithAppleUseCase`; composition `getSignInWithAppleUseCase`). AC1 button is iOS-gated in `(auth)/index.tsx`; AC2 relay email is set by Supabase on first sign-in; AC3 name is captured on first authorization and persisted to `user_metadata.full_name` for onboarding prefill. See `D-58`. **Go-live dependency:** the Apple provider must be configured in Supabase Auth (Service ID + key) and a native rebuild is required — an OTA update cannot add the native capability. `TD-24` Apple portion closed; Phone OTP still deferred.

**Related.** Screens: 1.2 · Domain: `User`, `Session`, `AuthMethod`.

---

## FR-AUTH-005 — Sign up via phone (OTP)

**Description.**
A user signs up with an Israeli mobile number, receives a 6-digit OTP via SMS, and confirms.

**Source.**
- PRD: `03_Core_Features.md` §3.1.1, `05_Screen_UI_Mapping.md` §1.3.
- Constraints: `R-MVP-Core-8`, `R-MVP-Privacy-2`.

**Acceptance Criteria.**
- AC1. Country code is fixed to `+972` and not user-editable in MVP.
- AC2. The OTP code is exactly 6 digits, valid for 10 minutes, and consumable once.
- AC3. After 5 failed attempts on the same OTP, the user is locked out for 60 minutes and a security event is logged.
- AC4. After successful verification, the system creates a `User` with `auth_method = phone`. The phone number is stored normalized (E.164) and is the unique identifier for that user.
- AC5. A "Resend code" button is offered after a 60-second cooldown; total resends per request: 3.

**Edge Cases.**
- Phone is already registered: the flow becomes sign-in (`FR-AUTH-007`); the registration step is skipped.
- Phone matches a deleted-account cooldown: rejected per `FR-AUTH-016`.

**Related.** Screens: 1.2, 1.3 · Domain: `User`, `OtpChallenge`.

---

## FR-AUTH-006 — Sign up via email + password

**Description.**
A user signs up with email and a password, with a verification email containing a magic link to confirm.

**Source.**
- PRD: `03_Core_Features.md` §3.1.1.
- Constraints: `R-MVP-Core-8`.

**Acceptance Criteria.**
- AC1. Password is at least 8 characters, contains at least one letter and one digit, and does not appear in the top-100k breached-passwords list at sign-up time.
- AC2. Supabase Auth creates the account with `email_confirmed_at = null`. The user **cannot sign in** until they click the verification link in the email — `signInWithPassword` returns `email_not_confirmed`. The sign-up screen transitions in place to a verification-pending state with three actions: "פתח אימייל" (launches the default mail client on native; routes to a known webmail provider on web based on the email domain), "שלח שוב" (resends the verification email; disabled for 60 seconds after each click), and "שנה אימייל" (returns to the form with the previously typed email/password preserved). The same verification-pending state is rendered on the sign-in screen when the user attempts to sign in with an unconfirmed email.
- AC3. The verification email is sent via the platform's transactional email service and arrives within 60 seconds at p95.
- AC4. The link is single-use, valid for 24 hours, and expires after consumption.
- AC5. "Forgot password" sends a single-use reset link valid for 30 minutes.

**Edge Cases.**
- Email already used: shown with a benign message ("An account exists. Try logging in or reset your password") that does not confirm registration status (anti-enumeration).
- Email matches a deleted-account cooldown: rejected per `FR-AUTH-016`.

**Related.** Screens: 1.2 · Domain: `User`, `EmailVerification`, `PasswordReset`.

---

## FR-AUTH-007 — Sign in (any method)

**Description.**
A returning user authenticates using the method they originally signed up with.

**Source.**
- PRD: `03_Core_Features.md` §3.1.1, `04_User_Flows.md` Flow 2.

**Acceptance Criteria.**
- AC1. After successful authentication, the user lands on the Home Feed (`FR-FEED-001`), bypassing the onboarding wizard if `User.onboarding_state = completed`.
- AC2. If onboarding is incomplete (`pending_basic_info` or `pending_avatar`), the wizard resumes at the appropriate step on next session start.
- AC3. The session token is stored in platform-secure storage (Keychain on iOS, EncryptedSharedPreferences on Android, a secure HTTP-only cookie on Web).
- AC4. Session expiry is 30 days of inactivity. Active use silently refreshes the token.
- AC6. When `signInWithPassword` returns `email_not_confirmed`, the sign-in screen renders the verification-pending state defined in FR-AUTH-006 AC2 instead of an error alert. The user can then resend, open mail, or change email.
- AC7. The email sign-in screen reads, top to bottom: title → social sign-in (Google; Apple on iOS) → an "או" ("or") divider → the email and password form. The divider sits **below** the social buttons and leads into the form. The email sign-up screen (`FR-AUTH-006`) follows the same order. Implemented by the shared `AuthSocialSignInBlock`; regression test `components/auth/__tests__/AuthSocialSignInBlock.test.tsx`.

**Related.** Screens: 1.2, 1.3 · Domain: `Session`.

---

## FR-AUTH-008 — Forgot password (email method only)

> **Status (2026-10-30):** ✅ Implemented — `RequestPasswordResetUseCase` (AC1 uniform outcome), `ResetPasswordUseCase` (policy check before the single-use token, global sign-out: AC2, AC3), screens `app/(auth)/forgot-password.tsx` and `app/auth/reset-password.tsx`. AC2's 30-minute expiry and the `token_hash` link are hosted Supabase Auth settings (email template + OTP expiry), not repo code — see `docs/spec/95_reconciliation.md` G36.

**Description.**
A user with the email method can request a password reset link.

**Source.**
- PRD: `03_Core_Features.md` §3.1.3.

**Acceptance Criteria.**
- AC1. The reset request returns a uniform success message regardless of whether the email is registered (anti-enumeration).
- AC2. The reset link is single-use, expires in 30 minutes, and invalidates all existing sessions when consumed.
- AC3. After password change, the user is prompted to sign in again on every device.

**Related.** Domain: `PasswordReset`.

---

## FR-AUTH-009 — One auth method per account

**Description.**
The MVP does not allow linking multiple authentication methods to the same account.

**Source.**
- PRD: `03_Core_Features.md` §3.1.4.
- Constraints: `R-MVP-Core-6`, `R-MVP-Core-8`.

**Acceptance Criteria.**
- AC1. The data model represents `auth_method` as a single value on `User`.
- AC2. Attempting a second sign-up with a Google account whose email matches a phone-registered user creates a **separate** account; the system informs the user that account linking is not yet supported and offers to use the original method.
- AC3. The schema must be future-compatible with multi-method linking (the `auth_method` field is part of a one-to-many `AuthIdentity` relationship in the domain model — see [`03_domain_model.md`](../archive/SRS/03_domain_model.md)).

---

## FR-AUTH-018 — Onboarding: Mini About (first screen)

**Description.**
Before collecting profile data, the user sees a short “about us” teaser (value proposition + one paragraph). Copy directs users to the full About content under **Settings → About** after signup. Optional link opens the existing full-screen About route (`/about`) and returns via the screen back affordance.

**Acceptance Criteria.**
- AC1. When `onboarding_state = pending_basic_info`, AuthGate routes to this screen before Basic Info (not directly to `FR-AUTH-010`).
- AC2. Primary **Continue** and header **Skip** both advance to Basic Info (`FR-AUTH-010`).
- AC3. Header **Back** returns the user to the auth welcome surface (`FR-AUTH-001` / `FR-AUTH-002` group).
- AC4. Onboarding step indicator shows **step 1 of 4** on this screen; subsequent wizard screens use 2–4 of 4.

**Related.** Screens: onboarding flow · Settings About: `11_settings.md` (About entry).

---

## FR-AUTH-010 — Onboarding step 2: Basic Info

**Description.**
Captures `display_name`, `city` (canonical picker), and optionally `profile_street` + `profile_street_number` as the second onboarding step (after `FR-AUTH-018`).

**Source.**
- PRD: `03_Core_Features.md` §3.1.2, `05_Screen_UI_Mapping.md` §1.4.
- Constraints: `R-MVP-Profile-1`, `R-MVP-Core-5`.

**Acceptance Criteria.**
- AC1. `display_name` accepts up to 50 characters; whitespace-only is rejected.
- AC2. `city` is a dropdown of the canonical Israeli city list seeded by the system. No free-text city.
- AC2.b. **Optional full address (MVP+):** After choosing a city, the user may enter `profile_street` (1–80 chars) and `profile_street_number` (same validation and storage rule as posts / `FR-PROFILE-007`: digits with an optional single-letter suffix — Latin or Hebrew — e.g. `12`, `12B`, `12א`; see `04_posts.md` street_number AC3). Both must be filled together or both left empty; values persist to `users.profile_street` / `users.profile_street_number` (`FR-PROFILE-007`). Omitting them keeps city-only residence. **Street is a city-dependent canonical picker** over `public.streets` (sourced from data.gov.il package 321; see `D-36`) with a free-text fallback row that lets the user save any string when the typed name is not in the list. **On this screen the street + number fields are progressively disclosed** — hidden until a city is selected, revealed via the existing entry animation, collapsed back to hidden if the user clears the city. Switching the city resets street + number so a Tel Aviv street can never accompany a Jerusalem submission.
- AC2.c. **Optional contact phone (MVP+):** Below the address, the user may enter a free-text contact phone (`users.contact_phone`, 1–20 chars after trim). The field is **non-verified** in MVP — no OTP, no format validation, no country-code normalization. Null = unset. Distinct from the auth phone (`auth.users.phone`) used for `FR-AUTH-005` OTP sign-in. Surfaced to other users as a tappable `tel:` link on the chat anchored-post card (`FR-CHAT-014`).
- AC3. A "Skip" option exists. Skipping advances to step 3 (Profile Photo, `FR-AUTH-011`) but marks `User.onboarding_state = pending_basic_info`. The first attempt at a meaningful action (post creation, follow, sending the first chat message) re-prompts to fill these fields (see `FR-AUTH-015`). The system also persists `users.basic_info_skipped = true` on Skip so returning sessions (cold start, app update, re-auth) **land on the Home Feed** instead of forcing the full-screen wizard again; the deferred fields are still collected only via `FR-AUTH-015` until saved.
- AC4. SSO-prefilled values are editable and persisted upon "Continue".

**Edge Cases.**
- The city list is updated post-launch: existing users with an obsolete city retain it; an inline notice shown next time they edit their profile suggests selecting a current city.

**Related.** Screens: 1.4 · Domain: `User`, `City`.

---

## FR-AUTH-011 — Onboarding step 3: Profile Photo

**Description.**
Captures an optional profile photo.

**Source.**
- PRD: `03_Core_Features.md` §3.1.2, `05_Screen_UI_Mapping.md` §1.5.

**Acceptance Criteria.**
- AC1. Two source options: camera capture (mobile only) and gallery / file upload.
- AC2. Image is resized client-side to a max edge of 1024px and re-encoded to JPEG q=85 before upload.
- AC3. Skipping leaves the user with a generated initial-letter silhouette as avatar.
- AC4. SSO-prefilled photo is shown by default; the user may replace or remove it.
- AC5. Upload errors are recoverable: the user can proceed without a photo and add it later via Edit Profile (`FR-PROFILE-007`).

**Related.** Screens: 1.5 · Domain: `User.avatar_url`.

---

## FR-AUTH-012 — Onboarding step 4: Welcome Tour

**Description.**
A 3-slide explanation of the core value loop, followed by entry to the Home Feed.

**Source.**
- PRD: `03_Core_Features.md` §3.1.2, `05_Screen_UI_Mapping.md` §1.6.

**Acceptance Criteria.**
- AC1. Three slides with the messages defined in PRD §3.1.2 (paraphrased to fit copy guidelines, but conceptually identical).
- AC2. A "Skip" link is present on every slide and routes directly to the Home Feed.
- AC3. On completion, `User.onboarding_state = completed` and the user lands on `FR-FEED-001`.
- AC4. The tour is shown only once per account; subsequent sign-ins skip it.

**Related.** Screens: 1.6.

---

## FR-AUTH-013 — Returning user fast path

**Description.**
A user with a valid session token who launches the app skips Splash and Auth and lands on the Home Feed.

**Source.**
- PRD: `04_User_Flows.md` Flow 2.

**Acceptance Criteria.**
- AC1. Session validity is checked against the auth backend on every cold start; expired or revoked sessions route the user to Splash.
- AC2. If the user was inactive for >24 hours, deep links from the OS resume to the Home Feed rather than the deep-linked screen, then optionally re-route after 1 second to honor the deep link (see `FR-AUTH-013.b`).
- AC3. While the session check is pending, a branded loading splash is shown for at most 2 seconds; longer durations show a "Tap to retry" affordance.

**Edge Cases.**
- Token revoked server-side: user is silently logged out and redirected to Splash.

**Related.** Domain: `Session`.

---

## FR-AUTH-014 — Guest Preview

**Description.**
A non-authenticated user may view a sample of the feed (3 posts) before being asked to sign up.

**Source.**
- PRD: `03_Core_Features.md` §3.3.1.4, `05_Screen_UI_Mapping.md` §1.7.
- Constraints: `R-MVP-Core-2`.

**Acceptance Criteria.**
- AC1. The guest feed shows the 3 most recent **public** posts in chronological order across all of Israel.
- AC2. Guest interactions are blocked: tapping a post / a profile / the "+" button / the message icon all surface the sign-up overlay (`FR-AUTH-014.a`).
- AC3. The overlay copy emphasizes the size of the active community (parameterized count, see `FR-FEED-014`).
- AC4. Closing the overlay returns the user to the guest feed; sign-up routes to `FR-AUTH-002`.
- AC5. The client-side auth redirect gate must treat the dedicated guest-preview route (`Screen 1.7`) as reachable while unauthenticated: navigating there must not be cancelled by the same rule that sends anonymous users from the main shell to Splash/Auth.

**Edge Cases.**
- Fewer than 3 public posts exist system-wide: show all available; do not pad with closed posts.

**Related.** Screens: 1.7.

---

## FR-AUTH-015 — Soft gate before first meaningful action

**Description.**
A user whose `onboarding_state` is `pending_basic_info` and who attempts to create a post, follow another user, or send the first chat message is interrupted by a non-bypassable modal asking for `display_name`, `city`, optionally `profile_street` + `profile_street_number` (same rules as `FR-AUTH-010` AC2.b), and optionally `contact_phone` (same rules as `FR-AUTH-010` AC2.c).

**Source.**
- Decisions: `D-10`.
- PRD: `03_Core_Features.md` §3.1.2 (in spirit).

**Acceptance Criteria.**
- AC1. The modal contains the same fields as the Basic Info onboarding step (`display_name`, city picker, optional street + house number, optional contact phone) and a single "Save and continue" button.
- AC2. Cancelling the modal returns the user to the previous screen with no side effects.
- AC3. After save, the system continues into the originally attempted action.

**Edge Cases.**
- The user closes the app mid-modal: the next launch shows the modal again upon attempting any meaningful action.

**Related.** Domain: `User.onboarding_state`.

---

## FR-AUTH-016 — Account deletion & re-registration cooldown

**Description.**
A deleted account's primary identifier (phone, email, or SSO `sub`) cannot be reused for re-registration for 30 days after deletion.

**Source.**
- Decisions: `D-12`.
- PRD: `03_Core_Features.md` §3.5 (Account deletion).
- Constraints: `R-MVP-Privacy-6`.

**Acceptance Criteria.**
- AC1. On account deletion, the system retains an opaque hash of the identifier with a `deleted_at` timestamp until `deleted_at + 30 days`, after which the record is hard-deleted.
- AC2. Sign-up attempts whose identifier hashes match an entry in the cooldown table are rejected with the message: *"This identifier was used by an account that was recently deleted. You can register again 30 days after deletion."*
- AC3. Cooldown rejection events are counted into security telemetry; >5 rejections from the same device fingerprint within 7 days triggers a soft-block on the device.

**Edge Cases.**
- Phone reuse by a different person within the cooldown is impossible — by design, prevents privacy leaks (the new owner could see leftover artifacts otherwise).

**Related.** Domain: `DeletedIdentifier`.

---

## FR-AUTH-017 — Logout

**Description.**
The user can log out from the Settings screen, terminating the local session.

**Source.**
- PRD: `03_Core_Features.md` §3.5, `05_Screen_UI_Mapping.md` §5.1.

**Acceptance Criteria.**
- AC1. Logout invalidates the local session token immediately and returns the user to Splash.
- AC2. Server-side session is also revoked; subsequent uses of the old token are rejected.
- AC3. Pending realtime subscriptions and push tokens registered for the device are unsubscribed before redirect.

**Related.** Screens: 5.1.

---

| Version | Date | Summary |
| ------- | ---- | ------- |
| 0.1 | 2026-05-05 | Initial draft from PRD §3.1, §3.5, and Decisions D-10, D-12. |
| 0.2 | 2026-05-12 | `auth_check_account_gate` (migration `0046`) must treat `account_status = pending_verification` as gate-allowed so first-time Google sign-in reaches onboarding (`FR-AUTH-003`); client guard + support `mailto` template on account-blocked web. |
| 0.3 | 2026-05-12 | `FR-AUTH-010` / `FR-AUTH-015`: optional profile street + number on step 1 and soft-gate (city picker unchanged). |
| 0.4 | 2026-05-14 | Migration `0067`: `account_status` lifecycle simplified — email/password sign-up blocked at Supabase Auth boundary until verification link clicked; Google/Apple/phone are `active` on first INSERT; new `auth.users` trigger syncs `email_confirmed_at` → `account_status`; one-time backfill clears legacy stuck rows. FR-AUTH-006 AC2 rewritten. FR-AUTH-007 AC6 added. Supersedes `0046_auth_gate_allow_pending_verification`. |
| 0.5 | 2026-05-15 | Migration `0068`: closes verification-status gap from `0067`. Phone-only OTP users never set `auth.users.email_confirmed_at` (they set `phone_confirmed_at`), so the previous trigger never promoted them and they stayed stuck in `pending_verification` — the `auth_check_account_gate` then signed them out on every sign-in. Fix: (a) `handle_new_user` picks the initial status from the provider — `google`/`apple` land directly as `active` (no transient state), `phone` is `active` iff `phone_confirmed_at` was set at INSERT, `email` keeps existing semantics; (b) the verified trigger now watches both `email_confirmed_at` and `phone_confirmed_at` and is renamed `on_auth_user_verified`; (c) one-time backfill flips any row already verified at the auth layer. `FR-AUTH-005` AC4 and `FR-AUTH-007` AC1 are unchanged at the user level; only the implementation note expands. |
| 0.6 | 2026-05-17 | `FR-AUTH-010` AC2.c + `FR-AUTH-015` AC1 extended with optional, non-verified **contact phone** (`users.contact_phone`, 1–20 chars). Distinct from the OTP `auth.users.phone`. Migration `0096`. Surfaced on the chat anchored-post card as a `tel:` link (`FR-CHAT-014`). |
| 0.7 | 2026-11-01 | `FR-AUTH-007` AC7: sign-in / sign-up reading order — social buttons, then the "or" divider, then the email form (the divider used to render above the Google button). |
