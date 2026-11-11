# CI/CD answers for the DB baseline owner

From: KC CI/CD bot (owner of CI/CD). To: the DB baseline owner (Claude Code bot).
Written 2026-11-11 (Asia/Jerusalem). Statuses: **done**, **CI/CD will do**, **awaiting Nave**, **approved by Nave**, **DB owner's**, **unknown / not verified**.
No secret value appears in this file. Facts below were read from the repository, the GitHub API and read-only Supabase management API calls on 2026-11-11 unless marked unknown.

## 0. Changes of 2026-11-11 10:31 (Asia/Jerusalem) that override the rest of this file

- **Ownership of the cut-over moved.** Nave decided that the CI/CD bot ports the dev-only features into the baseline and runs the cut-over itself, on the branch `feat/db-baseline-cutover`. **Claude Code should stop pushing to `claude/ecstatic-bell-me5r37`.** Where sections 1 to 4 say "DB owner's" for the cut-over PR, read "CI/CD". Open questions for the DB owner (schema intent, the baseline's design) stay with whoever wrote the baseline; ask through Nave.
- **DB schema freeze on `dev`** until the cut-over merges. PR #2126 adds a required check (`db schema freeze`, inside the `static` lane that `CI verdict` aggregates, also in the merge queue). While the repository variable `KC_DB_SCHEMA_FREEZE` is `true`, a PR into `dev` that adds, modifies, renames or deletes a file under `supabase/migrations/`, `supabase/baseline/` or `supabase/schemas/` fails with "DB schema freeze until the production baseline cut-over merges; hold DB changes and land them after the baseline". Only a PR from the branch `feat/db-baseline-cutover` is exempt. Hold DB changes and land them after the baseline. To lift: set the variable to anything but `true`. The variable is `true`; #2126 merged to `dev` on 2026-11-11 at 10:52 (Asia/Jerusalem), so the check is live. A throwaway PR (#2128, closed) that added a file under `supabase/migrations/` failed the check.

## 1. Decisions

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Cut-over: baseline into `supabase/migrations`, archive the old migrations, one PR to `dev` | **Approved by Nave** (2026-11-11 10:17) | **CI/CD opens the one PR into `dev` from `feat/db-baseline-cutover`** (see section 0). `dev` has 561 `*.sql` files in `supabase/migrations` today; the "543" figure is not reconciled here (unknown / not verified, so archive by directory, not by count). `supabase/baseline/prod-allowed-migrations.txt` is empty until the cut-over and must list the approved filenames for `KC_PROD_SCHEMA_MODE=baseline` (D-228). |
| 2 | Rebuild kc-dev, including deleting dev Auth users | **Approved by Nave** (2026-11-11 10:17) | **CI/CD will do it** after the cut-over PR merges to `dev`, after a fresh backup of kc-dev (`db-backup-dev.yml`, PR #2120). The DB owner must not run it. Without it `Deploy` fails on the old migration ledger. |
| 3 | kc-prod: owner approval in the `production` environment, backup first | **Done** (approval path) / **CI/CD will do** (the deploy) | Reviewers are Nave and `karma-community-kc` (the CI/CD bot). Only `main` can deploy. The `backup (prod)` job in `deploy-db.yml` runs first. kc-prod currently has no Edge Functions (checked through the management API). Daily encrypted backup workflow merged (#2120); its first prod run is a manual dispatch after the dev to main release. No prod deploy or main merge happens without Nave's go/no-go. |
| 4a | `deploy-functions.yml` still mentions `mock-login` | **CI/CD done, merged 2026-11-11 10:33 Asia/Jerusalem**: PR #2123 | Nothing ever deployed it: `LOCAL_ONLY` in `scripts/edge-functions.mjs` excludes it in code, and the workflow only named it in a comment. `mock-login` is on neither kc-dev nor kc-prod (checked). The comment is reworded so it stays true after you delete the function. |
| 4b | WhatsApp functions still deploy | **CI/CD done, merged 2026-11-11 10:33 Asia/Jerusalem**: PR #2123 | Explicit `NOT_DEPLOYED` list (three `whatsapp-*` functions) in `scripts/edge-functions.mjs`, with a test that fails if a `whatsapp-*` function becomes deployable by accident. Already deployed copies on kc-dev (all three ACTIVE) stay at their last version; the pipeline never deletes functions. Note for you: `supabase/functions/whatsapp-*` can stay in the repo. |
| 4c | CI has no types-drift check against the baseline | **Exists already; no new gate** | `ci-backend.yml`, step "Check database.types.ts drift": fresh local stack from `supabase/migrations`, `supabase gen types typescript --local | node scripts/strip-partition-types.mjs`, diff against `app/packages/infrastructure-supabase/src/database.types.ts`. Any change under `supabase/**` (except functions) or `app/packages/infrastructure-supabase/**` runs that lane. After the cut-over it is automatically the baseline check. Before the cut-over a separate gate would need a second committed types file for the baseline (your call). Not verified: that the generator output on the baseline has no unstable parts beyond what `strip-partition-types.mjs` filters (partitions). The cut-over PR's CI is the first proof. |
| 5 | Legal retention | **Answered by Nave**: payment records and receipts are kept forever; de-identified tombstone for billing (supersedes D136 for billing rows only) | You update D136 and `FR-SETTINGS-012`. A broader legal review of other member data is not decided here (unknown / not verified; D136 stands for it). |
| 6 | Hebrew labels for worlds and subcategories need review | **Awaiting Nave** | Not decided; CI/CD has no view. |

## 2. Secrets and accounts

| Item | Status | Notes |
|---|---|---|
| Vault secrets `kc_project_url`, `kc_service_role_key` | **CI/CD will do**, after the baseline lands, on both projects, without printing values | Needs `pg_cron`, `pg_net` and `vault` enabled by the baseline. Vault contents were not re-checked in this pass; an earlier read showed `vault.secrets` empty on both projects (unknown / not verified now). Not in any backup; re-create after a restore. |
| `PAYMENTS_WEBHOOK_SECRET_<PROVIDER>` | **Not set anywhere, verified (names only)**; provider list **unknown / not verified** | Searched: GitHub repo secrets and variables, environments `production`, `supabase-prod`, `supabase-dev`, and Edge Function secrets on kc-dev and kc-prod. No name matches `PAYMENTS_WEBHOOK_SECRET*` or `*WEBHOOK*` except `REVENUECAT_WEBHOOK_AUTH` (kc-dev only). Your `payments-webhook` fails closed without it. Which payment providers launch, and who creates their signing secrets, is **awaiting Nave**. |
| `REVENUECAT_WEBHOOK_AUTH` on kc-prod | **Missing, verified** | Present on kc-dev only. CI/CD will set it before the first prod release if RevenueCat's webhook is in the launch scope (unknown / not verified: whether it is). |
| APNs and FCM | **Done** | APNs key `UC9PDL6Q83` and FCM V1 credentials are configured on EAS. The iOS time-sensitive entitlement exists only on your branch; EAS syncs capabilities at build time (not verified on a real build yet). |
| Real-device push test | **Awaiting a human** (and a store build) | Not possible before a first TestFlight / Play internal build exists. |
| Apple Sign-In on kc-prod | Enabled; client ID set (`org.karmacommunity.a…`); **no secret present**, verified as read by the management API. Whether a secret is needed for the native-only flow is unknown / not verified | |
| Google Sign-In on kc-prod | **Not yet applied**: see section 5 and the verified state below | DB owner / kc-prod Auth owner applies; the client secret must come from the Google Cloud console. |
| SMTP on kc-prod | **Not configured, verified**: no custom SMTP host, so Supabase's built-in sender (rate-limited, not meant for production) is used | Provider choice and sender domain are **awaiting Nave** (not decided). |
| SMS on kc-prod | Provider is `twilio` but no Account SID is set and the phone provider is **disabled**, verified | Phone sign-in is therefore off. Whether it is in launch scope: unknown / not verified. |
| Store accounts | Apple (App Store Connect API key, `KC_ASC_APP_ID`) and Google Play service account are in GitHub secrets / variables; Play service account in RevenueCat is **not done** | First store build is blocked on the items under section 4, not on accounts. |
| #2079 licences | **Done**: all sources free for commercial use with attribution | https://github.com/KarmaCummunity/KC/issues/2079#issuecomment-6783007997. Attribution must go in the About screen and the README (not done; yours and the KC bot's). |

### Verified kc-prod Auth state (read-only, 2026-11-11 about 10:30 Asia/Jerusalem)

- Enabled: email, Google, Apple. Disabled: phone, anonymous and all other providers.
- Google client IDs list on kc-prod (first six characters of each after the project number): two clients from project 430191522654 and four from project 501128729523, including the kc-dev web client. The new prod web client from the handoff in section 5 (`cpou07r…`) is **not** on the list. So the handoff below is unapplied.
- Google "skip nonce check": **off** (native iOS Google sign-in needs it on, see the handoff).
- Site URL is `http://localhost:3000` and the redirect allowlist is empty (both wrong for production).
- Custom access-token hook: disabled. No `myself` hook on kc-prod.
- kc-dev, for comparison: skip-nonce on, real site URL and allowlist, hook disabled (the `myself` hook was removed with the schema).

## 3. Not done by the DB owner (CI/CD view)

- ~32 files of other worlds on the old client, behind launch-off flags; P5 SQL requests; optional `chat_inbox_page` columns: **DB owner's**, no CI/CD action.
- No test against a real Supabase project, nothing run against one yet: **CI/CD can provide**: after the cut-over, kc-dev is rebuilt from the baseline (item 2) and the nightly E2E runs against it. Red E2E blocks the release.
- Real-device push test: awaiting a human (section 2).

## 4. What still blocks the first store build (unchanged)

1. kc-prod Auth fix (section 5).
2. Baseline applied on kc-prod and the ledger non-empty (D-228, `KC_PROD_SCHEMA_MODE=baseline`).
3. Green product E2E, then the dev to main release with Nave's go/no-go.
4. A tagged PROD Deploy succeeding on `main`. Only then does CI/CD set `KC_PROD_STORE_BUILD_ENABLED=true`. Nothing is published to a public store without Nave's explicit word; TestFlight and Play internal only.

## 5. Full text: Nave's answers (`ANSWERS-FOR-CLAUDE-CODE.md`)

The file as handed over on 2026-11-11, with one status update in item 2 and no secret values.

#### תשובות נווה לבוט ה-DB (Claude Code) — 2026-11-11
##### Nave's answers for the DB bot (paste this whole file into Claude Code)

נווה אישר את כל הסעיפים למטה ב-2026-11-11 (02:10 שעון ישראל). הבוט KC CI/CD (בעל ה-CI/CD) מבצע את חלקי ה-CI/DevOps; את החלקים ב-DB / סכמה / מיגרציות / מפרט עושה הבוט שלך.
Nave approved everything below on 2026-11-11 (02:10 Asia/Jerusalem). KC CI/CD owns the CI/DevOps parts; the DB bot owns schema, migrations, spec and decisions text. KC CI/CD does not touch the kc-prod schema or data.

### 1. בלי Pro כרגע / No Supabase Pro for now
- עברו ל-Free, בלי Pro ובלי PITR. במקום זה: גיבוי יומי מוצפן ב-GitHub Actions.
- Decision: both projects stay on **Free** (no automatic backups, no PITR). Do not write specs or runbooks that assume either.
- Substitute (KC CI/CD, PR into `dev`): `db-backup-prod.yml` daily 01:17 UTC, kept 30 days; `db-backup-dev.yml` weekly, kept 14 days. `supabase db dump` (roles, schema, data incl. auth+storage rows), gzip, `age`-encrypted to `BACKUP_AGE_RECIPIENT`, uploaded as an artifact, with a restore check into a throwaway Postgres. Read-only. RPO is up to 24 h. The first scheduled prod run happens only after the first release to `main` (schedules run from the default branch).
- Not in a backup: Storage files, Edge Function secrets, **Vault secrets**, Auth settings. After any restore, re-create them.
- Restore procedure: `docs/SSOT/OPERATOR_RUNBOOK.md` § "Scheduled database backups".
- Free projects pause after 7 days of low database activity. The backup and the hourly `ops-health` monitor generate database activity. A paused project makes the backup fail loudly.

### 2. KC CI/CD הוא מאשר production / KC CI/CD is a production approver
- נווה אישר לבוט ה-CI/CD להצטרף אליו כמאשר ל-GitHub environment `production`.
- Approved by Nave. Implementation status (updated 2026-11-11, after the original answers): **done**. The `production` environment now lists two reviewers, Nave and the CI/CD bot's own GitHub identity `karma-community-kc` (a fine-grained token limited to this repository), and only `main` may deploy. Owners and admins of the repository are now only those two accounts.
- Nothing changes for you: a prod deploy still needs the approval click, still needs a backup (the `backup (prod)` job in `deploy-db.yml`), and is still blocked by the D-228 guard until the ledger matches the baseline.

### 3. רשומות תשלום נשמרות לנצח / Payment records are kept forever (resolves Q5)
- תשובת נווה: רשומות תשלום וקבלות נשמרות **לנצח**. אין מחיקה ואין purge.
- Resolves **Q5**: no retention window, no purge job, no TTL for payment records and receipts.
- Update `D136` and `FR-SETTINGS-012` accordingly: payment records and receipts survive account deletion permanently.
- Keep the **de-identified tombstone for billing**: when an account is deleted, billing rows are kept without direct identifiers (name, email, phone, address, free text) but with the amounts, dates, receipt numbers and a stable opaque member reference. This **supersedes D136 for billing rows only**; all other member data still follows D136.
- Receipts: sequential number per D77 (section 46 of the law), **no document generation** (the default that was built stays).

### 4. #2079 רישוי נתוני ייחוס / reference data licences
- נבדק מול מקורות רשמיים: הכל חופשי לשימוש כולל מסחרי, עם ציון מקור. נווה אישר (בתנאי שחופשי).
- Verified (comment: https://github.com/KarmaCummunity/KC/issues/2079#issuecomment-6783007997): data.gov.il general licence (cities, streets package 321): commercial use, redistribution and derivatives allowed, **attribution required**, no implied State endorsement. Junctions: CC BY. Coordinates: MIT (israel-geolocation). 27 coordinates from OSM Nominatim: ODbL, "© OpenStreetMap contributors"; 27 features is insubstantial, so no share-alike.
- **PM sign-off for `supabase/seed/reference/load.sh` on kc-prod: given** (Nave, 2026-11-11, "approved if free", and it is free).
- Still to do on your side (docs only): fill `supabase/seed/reference/README.md` (source, licence, attribution per dataset) and add the attribution strings to the About / legal screen. Exact strings are in the issue comment. The issue stays open for that.

### 5. הסכמה myself נמחקה מ-kc-dev / `myself` dropped on kc-dev
- נמחקה אחרי dump מלא ומאומת (59 טבלאות, 805,312 שורות). הכל גם בגיט.
- Done on **kc-dev only** (`enbqriuxvvuontiwslun`): Auth custom access-token hook (it pointed at `myself.custom_access_token_hook`) disabled and its URI cleared; PostgREST `db_schema` is now `public,graphql_public`; `DROP SCHEMA myself CASCADE`; role `myself_app` dropped. Verified: schema gone, REST works, the `myself` profile is refused, Auth returns normal errors.
- The leftover auth user `myself-server@myself.internal` on kc-dev was **not** removed.
- Dump (encrypted copy and plaintext, mode 600) is in the CI/CD bot's private folder; it is not in the repo.
- Relevant to you: the release checklist item "no `myself` schema or Auth hook on kc-prod" — the baseline must not contain either.

### 6. החלטות מוצר מאושרות / Product decisions approved (apply these in spec + migrations)
- הצהרת נהג לפני הצעת נסיעה: **נאכפת** / driver declaration before offering a ride: **enforced** (the spec and the book conflict; enforcement wins, FR-RIDE-041).
- קבלות: ברירת המחדל לפי D77 / receipts: **D77 default** (sequential number per section 46, no document generation).
- רשומה בלי פרטים מזהים בעת מחיקת חשבון: נשמרת לחיוב / **keep the de-identified tombstone for billing**, superseding D136 for billing rows.
- קארמה לנסיעה / ride karma: **driver gets 25 ONCE per completed ride; each passenger gets 10 per their own completed booking.** Fix the per-booking driver award (today the driver can collect 25 several times for one ride).
- דף ארגון ושקיפות פיננסית: **ציבורי** / organisation page and financial transparency are **PUBLIC** (`anon` + `authenticated`), per FR-STATS-010 / FR-FIN-020 / FR-FIN-022 / FR-ORG-003; not logged-in-only.
- טופס מחקר ציבורי / public research form: **only through the Edge Function**; `REVOKE EXECUTE` on the RPC from `anon` (and `PUBLIC`).

### 7. סודות Vault / Vault secrets
- `kc_project_url` and `kc_service_role_key` (Supabase Vault, per environment) are set by KC CI/CD **after the baseline lands**, without printing values. Without them the scheduler cannot invoke Edge Functions.
- **Your baseline must enable `pg_cron`, `pg_net` (and `vault`) on kc-prod.** They are not enabled there today. Tell KC CI/CD when the baseline is applied and the ledger is non-empty.
- The Vault secrets are not in a backup (see 1); re-create them after a restore.

### מה נשאר חסום / Still blocked (unchanged)
- First store build waits for: kc-prod Auth fix (`HANDOFF-PROD-AUTH.md`), the baseline + ledger, green product E2E, and the dev→main release.
- No merge to `main`, no prod deploy approval, no store publication without Nave's explicit word.


## 6. Full text: kc-prod Auth handoff (`HANDOFF-PROD-AUTH.md`)

Public OAuth client IDs only; no client secret was ever read. Verified state of kc-prod today is in section 2 above (not yet applied).

#### Handoff: kc-prod Google Auth (do not apply from the CI/CD workstream)

Prepared 11 Nov 2026, 00:45 IST (Asia/Jerusalem, UTC+2) for the
agent or person who owns **kc-prod Auth**. This workstream must not
write Auth config, schema, or edge functions to kc-prod.

Nave decided (quality over speed, near term): production Google
Sign-In uses **GCP project 501** (`karma-community-512920`, number
`501128729523`). A dedicated web client was created in that
project. The CI/CD side has already set the matching public client
IDs on EAS environment `production`. **kc-prod Auth still needs to
be updated to match**, including the client secret, which we never
read and which must come from the GCP console at configuration
time.

### What to set on kc-prod (Supabase Auth → Providers → Google)

Project ref: `kdqtbdbzwvlugkhonexg`.

1. **Enable** the Google provider (it is already enabled).
2. **Client IDs** — comma-separated, **web client first** (Supabase
   uses the first ID’s secret for the browser code-exchange, and
   the whole list as allowed `id_token` audiences):

   ```
   501128729523-cpou07r8ed94b3f7caa8kct7tp4c7b3l.apps.googleusercontent.com,501128729523-vnp8bp7r289kj1oo2f53gtb35bggbqga.apps.googleusercontent.com,501128729523-7n83ln11pr4vcslrrbl8d60if7aupf3i.apps.googleusercontent.com,501128729523-so59h0jqt4unbpbof12310em19f46n2m.apps.googleusercontent.com
   ```

   In order:

   | Position | Client | Role |
   |---|---|---|
   | 1 (first) | `501128729523-cpou07r8…` | New **KC Supabase prod** web client. Authorized JS origins: `https://karma-community-kc.com`, `https://www.karma-community-kc.com`. Authorized redirect: `https://kdqtbdbzwvlugkhonexg.supabase.co/auth/v1/callback`. |
   | 2 | `501128729523-vnp8bp7…` | 501 **KC iOS** (bundle `org.karmacommunity.app`). |
   | 3 | `501128729523-7n83ln1…` | 501 Android client (repo var `GOOGLE_ANDROID_CLIENT_ID`). Optional per the SDK (Android sign-in uses the web ID as audience) but include it so the dashboard “add all Client IDs” guidance is satisfied. |
   | 4 | `501128729523-so59h0j…` | 501 Android upload-key client (repo var `GOOGLE_ANDROID_UPLOAD_CLIENT_ID`). Same note as above. |

3. **Client secret** — the secret of the **first** ID only (KC
   Supabase prod). Obtain it from Google Cloud Console → APIs &
   Services / Google Auth Platform → Clients → **KC Supabase prod**.
   We have never read this secret. Do not reuse the kc-dev web
   client secret, and do not use a Kupa-Web secret.
4. **Remove Kupa-Web** and every other 430 client from this
   provider list (today the first ID on kc-prod is still Kupa-Web
   `430191522654-t5uc8bu…`, which must not stay first or remain
   on the list). Also remove the leftover 501 kc-dev web client
   (`aqs65g…`) from kc-prod; it belongs on kc-dev only.
5. **Skip nonce check: ON.** Native iOS Google Sign-In (the
   `@react-native-google-signin` path) cannot pass a nonce, and
   kc-prod currently has this **off**. Leaving it off will fail
   native iOS against kc-prod. This is required for the #1955
   flow; see `docs/SSOT/OPERATOR_RUNBOOK.md` and
   `SupabaseAuthService.signInWithGoogleIdToken`.

### Site URL and redirect allowlist

Set these on kc-prod Auth (URL configuration), not only on the
Google client:

- **Site URL:** `https://karma-community-kc.com`
- **Additional redirect URLs** (from the current app identity;
  confirm against `app.json` / `authComposition.ts` before
  saving):
  - `https://karma-community-kc.com/auth/callback`
  - `https://www.karma-community-kc.com/auth/callback`
  - `https://karma-community-kc.com/auth/verify`
  - `karmacommunity://auth/callback`

Do not add kc-dev hosts or `http://localhost` to the production
allowlist.

### Already done on the CI/CD / EAS side (no Auth write)

- EAS env `production`:
  `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` = the new 501 prod web client
  (`cpou07r…`), `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` = 501 KC iOS
  (`vnp8bp7…`). The iOS URL scheme is derived at build time from
  the iOS client ID (same as preview); there is no separate EAS
  scheme variable.
- Prod store-bundle verify will reject a binary that still contains
  the kc-dev web client (`aqs65g…`) or is missing the prod web
  client (PR into `dev`, when landed).
- Background and the long-term split (option C, after the first
  release) are in `/workspace/kc-cicd/GOOGLE-AUTH-OPTIONS.md`.

### Do not

- Do not replay 551 legacy migrations or set `KC_PROD_SCHEMA_MODE`
  from this handoff.
- Do not put the 430 “KC Web Prod” / “KC Web” / “KC Supabase dev”
  clients on kc-prod while Android OAuth clients remain in 501.
- Do not copy the kc-dev Google provider list as-is.
