# ADR-013 — Identity: KC signs its own members in, on the same users and the same policies

- **Status:** Accepted (2026-11-27) · phase 9 of [ADR-009](./ADR-009-backend-platform.md)
- **Decision log:** `{{ENG:own-identity}}` in [`../../SSOT/DECISIONS.md`](../../SSOT/DECISIONS.md)
- **Related:** [ADR-010 port gateway](./ADR-010-port-gateway.md), [ADR-011 realtime gateway](./ADR-011-realtime-gateway.md), [ADR-012 media storage](./ADR-012-media-storage.md) (the same principle, applied to sign-in)

## Context

Supabase Auth signs KC's members in and issues the tokens every other part trusts. What depends on it today:

- **The app** reaches it through one port, `IAuthService` (15 methods), implemented by one adapter. The methods a member can reach are: Google (an ID token from the native sheet, or a browser redirect that ends in a one-time code), Apple on iOS (an ID token with a nonce), and email with a password behind a launch switch (sign-up, the verification link, sign-in, the reset link). There is no phone sign-in, no second factor and no anonymous account in the code. The adapter also keeps the session on the device, refreshes it, and tells the app when it changes.
- **The database** hangs every member off one row: `public.users.id` references `auth.users (id)` and everything else references `public.users`. Two triggers on `auth.users` create a member's rows and activate the account when its address is verified. Deleting the row is how an account is purged. Every policy reads the caller through `auth.uid()` (223 uses), which reads the `sub` claim of the transaction; the only other claim SQL reads is `role`.
- **The API** verifies the access token against the issuer's public keys (asymmetric algorithms only, the audience and role `authenticated`, a user id as subject) and sets the claims on the transaction.
- **Nothing on the server ends a session.** A ban is enforced by row-level security on every query and by the app, which asks the account gate once a minute; the only global sign-out is the one after a password reset.

Leaving Supabase means replacing the service that proves who a member is. As with realtime and files, what must survive is everything built on top of it: the user row and its triggers, `auth.uid()`, the policies, and the app's port.

## Decision

### 1. The API is the issuer; the user row and the claims stay

An `identity` module in the API signs members in and issues their tokens. `auth.users` stays, as KC's own table (as `storage.objects` and `realtime.messages` did): the module inserts the row a sign-up creates, and the triggers, the foreign key, the purge and every policy work as they do today. An access token carries exactly the claims the API and the database already read (`sub`, `role`, `aud`, `iss`, `exp`, `iat`) and one more, the session's id (`sid`). No SQL is rewritten.

What Supabase Auth keeps in tables of its own (identities, password hashes, sessions, refresh tokens, one-time links) moves to tables KC owns in `kc_private`, reachable only by the API's service role. They reference `auth.users (id)` and are removed with it, so the purge keeps deleting one row.

### 2. Tokens

- **Access token:** a JWT signed with ES256, valid for one hour, as today. The API publishes its public keys at `<issuer>/.well-known/jwks.json`, where its own verifier already looks. Signing keys are a set held as a deployment secret: the first signs, all are published, so a key is rotated by adding the new one first and removing the old one an hour after it stopped signing.
- **Refresh token:** 256 random bits, opaque, stored only as a SHA-256 hash. Each use replaces it. A token that was already replaced is accepted for ten seconds (two requests of one app racing each other, as Supabase Auth is configured today); after that its use means the token was copied, and the whole session ends.
- **Session:** one per sign-in, on one device. It ends at sign-out, at a password reset (all of the member's sessions), when a replaced refresh token is reused, or after 30 days without a refresh (FR-AUTH-007 AC4).
- **A session that ended is refused at once**, not when its access token expires: wherever the API establishes who a request is from, it also asks the database whether the token's session is still live, in one round trip. That is one place for every route, the realtime handshake included. This is what FR-AUTH-017 AC2 asks ("subsequent uses of the old token are rejected") and Supabase Auth does not do.

### 3. Sign-in methods: the ones the app has, behaving as they do

- **Google and Apple ID tokens** are verified against the provider's published keys, for KC's own client ids, with the nonce where the app sent one. An identity is the pair (provider, the provider's subject).
- **Google in a browser** stays a redirect that ends in a one-time code (D-33): the API sends the browser to Google, receives the answer, and hands the app a code it exchanges once, bound to a secret only that app instance has (PKCE).
- **Email and password**: the same rule as today (eight characters, a letter and a digit), the same uniform answers that never say whether an address is registered (D-22), single-use links for verification (24 hours) and reset (30 minutes), stored hashed. A reset ends every session of the member (FR-AUTH-008 AC2).
- **Passwords** already set are carried over as the bcrypt hashes Supabase Auth made, and verified as such, so nobody resets a password. A password set or changed on KC is hashed with scrypt, and a carried-over hash is replaced by a scrypt one at the member's next sign-in. Both run on the platform's own cryptography; no native module is added.
- **Sending email** is behind one interface. No provider is chosen yet (D-231); until one is, email sign-up stays behind its launch switch as it is today.

### 4. The app keeps its port

`IAuthService` does not change. A second adapter in `@kc/infrastructure-api` implements it against the API: it keeps the session in the same secure storage, refreshes it before it expires, and reports changes to the same listeners. The composition root picks the adapter per build, like the other doors.

### 5. The switch is part of the database move

KC's tokens are trusted by KC's API only. While the app still talks to any Supabase service directly, it needs Supabase's tokens; and realtime and files can only leave Supabase together with the database (ADR-011, ADR-012). So identity is built and proven now on KC's own Postgres, and switched on in the cut-over of phase 10, in one step:

1. Supabase Auth is closed to new sign-ins.
2. Users, identities, password hashes and live refresh tokens are copied into KC's tables, by a job that can be re-run and that verifies its counts.
3. The app version that talks to KC's identity becomes the minimum version (KC#2675).

Because the refresh tokens are carried over (hashed), a member who is signed in stays signed in: their app presents the token it already holds and receives KC's tokens.

## Order of work

| # | Step | State |
|---|---|---|
| 1 | Signing keys, the access token, the published key set, the verifier that accepts KC's own issuer | Done (`apps/api/src/platform/identity`): with `KC_AUTH_SIGNING_KEYS` set the API signs with its first key, verifies against its own set without a network call, and publishes the public halves at `/v1/auth/.well-known/jwks.json`; without it nothing changes |
| 2 | The tables (`kc_private`): identities, passwords, sessions, refresh tokens, one-time links | Done (migration `identity_tables`, with its database test): closed to every client role, removed with the member's row, and the rule that says whether a session still proves its member |
| 3 | Sessions: issue, refresh with rotation and reuse detection, sign-out (one device, everywhere), the 30-day limit, the check on every request | Done (`apps/api/src/modules/identity`, `platform/identity/sessionCheckedVerifier.ts`): `POST /v1/auth/token` and `/v1/auth/sign-out`, in the wire format shared with the app (`identityWire.ts`). Checked on the KC schema through the real routes: two requests racing with one token, a replayed token ending the session, one device or all of them signed out, the 30-day lapse, a removed account |
| 4 | Email and password: sign-up, verification, sign-in, reset, change; the email interface | — |
| 5 | Google and Apple ID tokens; Google's browser redirect | — |
| 6 | The app's adapter (`@kc/infrastructure-api`) and its composition switch | — |
| 7 | The copy of users, identities, hashes and refresh tokens from Supabase Auth, checked against a real one (the local stack) | — |
| 8 | The end-to-end journeys and the scripts that sign test users in, on KC's tokens | — |

Steps 1 to 5 and 7 need nothing from a person. Step 6 lands with the app's other wiring. Real sign-in with Google and Apple on a device needs KC's client ids (KC#2584), and real email needs the provider.

## Consequences

- One row still is the member, and one set of policies still decides everything. The identity module can be replaced again without touching the product's SQL.
- KC now holds what an identity service holds: password hashes, refresh-token hashes and signing keys. The hashes are in tables no client role can read; the keys are a deployment secret and never in the database or the repository.
- Ending a session takes effect on the next request, which is stricter than today.
- The check on every request is one more round trip to the database, reading one row by its primary key. It was first meant to ride on the statement that opens a request's transaction; three code paths open one, and a rule enforced in one place is worth the round trip.

## Open, for the PM

- **The same email address through two methods.** FR-AUTH-009 says an account has one sign-in method. What Supabase Auth does today when, for example, a member who signed up with a password later continues with Google under the same verified address has to be established on the real service first (step 7), and the module will then do the same, so the move changes nothing for anyone. If that turns out to differ from FR-AUTH-009, it is a product decision which of the two is right; the agent will raise it with what it found.
- **The password list.** FR-AUTH-006 AC1 also asks that a password is not among the 100 000 most breached ones. The app does not check this today. It is not added silently by this move; it is a small separate task once decided.

## Limits

- An access token is valid for an hour as a signature. What ends it earlier is the API's own session check; a service that only verifies the signature (none exists today) would not see a sign-out until the token expires.
- A member signed in on an app version from before the cut-over is signed out when Supabase Auth stops answering it; the minimum version (KC#2675) is what turns that into an update prompt instead.
