# 2.20 Organization Profile & Organization Accounts

> **Status:** ⏳ Planned — spec v0.1 (2026-10-30, PM-approved scope). No `FR-ORG-*` code shipped yet. **Phase 1** `FR-ORG-001..010` (one organization entity, registration + approval, public profile, edit, follow, act-as-organization, posts in the organization's name, share link, money page folded in). **Phase 2** `FR-ORG-011..016` (team tab, activity tabs, impact metrics, organizations filter in Search + hub directories, organization inbox, notifications). **Phase 3** `FR-ORG-017..020` (claiming catalog organizations, Registrar enrichment, verification-level badges, transparency tab hand-off to `spec/19_org_finance.md`).

Prefix: `FR-ORG-*` · Migration range claimed: `0490–0509` (see `docs/agents/MIGRATION_RANGES.md`) · Product decisions: `D88–D92` + fills `S50`/`S51` (`docs/spec/90_decisions_log.md`, `91_kc_fills_pending.md`) · Engineering decision: `D-199` (`docs/SSOT/DECISIONS.md`).

---

## Scope

An **organization profile** is a profile like a person's, adapted to organizations: logo and cover, name, what the organization does and where, website and social links, contact details, verification badges, the posts it published, who follows it, and (later) its team, activities, impact and financial transparency. Behind it stands an **organization account** that real people operate: the organization has its own sign-in identity, and individual members with roles act in its name from their own accounts.

This spec covers the organization as a **community actor**: registration, the public profile, who may edit it, how it publishes and follows, and how it is found. Running the organization (team, hierarchy, finance, tasks) stays in the Admin Portal (`spec/12_super_admin.md` §12–§16 for roles and hierarchy, `spec/19_org_finance.md` for finance). The finance sub-tree's public **transparency** section is consumed here as a tab (FR-ORG-020) and specified there (FR-FIN-018..020).

### What already exists (baseline, do not re-build)

| Asset | Where | Reuse in this spec |
| ----- | ----- | ------------------ |
| Person profile: header, counters, open/closed posts tabs, follow, message, share, privacy mode | `spec/02_profile_and_privacy.md`, `spec/03_following.md`, `app/user/[handle]/*`, `components/profile/*` | Organization profile reuses the same components (`ProfileHeader`, `ProfileStatsRow`, `ProfileTabs`, `ProfilePostsGrid`, `FollowButton`) with an organization variant. |
| `organizations` (`org_id`, `name`, `slug`, `is_platform`, `verified_at`, `verification_method`, `is_verified_nonprofit`, `public_tagline_he/en`, `public_about_he/en`) | migrations `0203`, `0264`, `0360` | **The** organization entity. Extended in place (FR-ORG-001). |
| `org_memberships` (`org_id`, `user_id`, `role`) + org-scoped `admin_role_grants` (`org_admin`, `org_manager`, `org_employee`, `volunteer_manager`, `org_volunteer`) + hierarchy tree + D86 "every organization runs its own team in the admin portal" | migrations `0143`, `0173`, `0203`, `0264`; `(admin)/admins` | Authorization source for "who may act as the organization". Unchanged except two display columns (FR-ORG-011). |
| `org_applications` + `(admin)/org-approvals` (pending / approved / rejected; approval creates nothing yet) | migration `0168` | Folded into `organizations.status = 'pending'` (FR-ORG-001, FR-ORG-002). Admin screen keeps working against the new source. |
| `external_bodies` catalog (medical / animals / environment bodies for post forms) | migrations `0241`, `0353` | Folded into `organizations` as **unclaimed** organizations (FR-ORG-001, FR-ORG-017). Closes gap G5 ("two org entities"). |
| Public nonprofit page `/(tabs)/donations/money/nonprofit/[slug]` + `get_nonprofit_public_page` + `list_verified_nonprofits` | money world `0360–0369` | Becomes the **"תרומות"** tab of the organization profile; the old route redirects (FR-ORG-010). |
| Universal Search + shared filter vocabulary | `spec/06_feed_and_search.md` FR-FEED-017/018, `(tabs)/search.tsx` | Gains the "ארגונים" parent filter with sub-filters (FR-ORG-014). |
| Product book: org = separate entity with roles (S15), every org verified (D53), levels 1–5 (D53), Registrar open data (S35), private person as org (D57), free for orgs (D55), per-hub org directory (D36) | `docs/spec/08_organizations.md` | Honoured; refined by D88–D92. |

### Glossary

- **Organization profile** — the public page of an organization at `/org/{slug}`. Always public (D90).
- **Organization account** — a sign-in identity (`users.account_type = 'organization'`) created at registration with the organization's email. It is bound 1:1 to the organization and has no personal profile of its own; signing in with it means acting as the organization.
- **Member** — a person (`users.account_type = 'individual'`) holding an org-scoped role grant for the organization. Members may **act as the organization** from their own account (D88).
- **Acting as** — the active profile context of a signed-in session: the person themself, or one of the organizations they may act for. Chosen in the profile switcher (FR-ORG-006).
- **Unclaimed organization** — a catalog entry (imported body or Registrar record) with no account yet. It has a read-only profile and can be **claimed** by its real organization (FR-ORG-017).
- **Verification level** — D53: 1 basic (registration approved) → 2 proper management → 3 Midot rated → 4 transparency → 5 effectiveness. This spec renders levels; criteria stay in `08_organizations.md` (S40/S41).

### Non-goals (explicit, PM 2026-10-30)

- Custom page layouts, drag-and-drop blocks, paid customization (PRD V2 §3.1.5). Omitted; one uniform template (D92).
- Private / followers-only organization profiles. An organization is always public (D90).
- Organization karma, leaderboards or ratings of organizations. Karma stays per person (D29); impact metrics (FR-ORG-013) are not karma.
- Requiring an Israeli registration number. Any non-profit organization may register; the number is optional (D89).
- Paid subscriptions for organizations (D55: free for now).
- Bilingual profile fields. Hebrew only in MVP (`R-MVP-Core-4`); the existing `*_en` columns stay unused.

---

## Product decisions recorded for this spec

| # | Question (2026-10-30) | Decision | Log |
| - | --------------------- | -------- | --- |
| 1 | Identity | An organization has its own sign-in identity **and** members with roles act in its name from their own accounts. | D88 |
| 2 | Registration | Self-service multi-step registration + KC admin approval that creates the profile. **No registration number required**: any non-profit organization may register; the applicant declares non-profit status and accepts the terms. Registrar lookup is optional when a number is given. | D89 |
| 3 | Private person as organization | Allowed (D57). The person's own account is linked to the new organization as its first admin and switches between the personal and the organization profile. | D88 |
| 4 | Profile fields | PM leans to transparency → the full field list is public by default; only contact phone and the team list are opt-in (S50). | S50 |
| 5 | Tabs | Phase 1 posts + info; Phase 2 team, activities, campaigns; Phase 3 transparency + documents. | D88 |
| 6 | Posting | Organizations publish in every world like a person, with no post cap (S15). A member publishing from their own account can post **in the organization's name**; the card shows the organization, the detail shows the member when they opted in. | D91 |
| 7 | Following & privacy | Always public; organizations can follow people and organizations; being followed never needs approval. | D90 |
| 8 | Actions on the profile | Donate (verified nonprofit with payments), Volunteer (open opportunities), Message (organization inbox), Share, Report. | D88 |
| 9 | One entity | External bodies and organization applications fold into `organizations`; catalog entries become unclaimed organizations that the real organization can claim. Closes G5. | D-199 |
| 10 | Directory | No separate directory screen. Search gets an "ארגונים" parent filter; its sub-filters (field, city, verification level, organization type) appear only while the parent filter is on. Hub directories reuse it with the hub's field pre-applied. | D91, S51 |
| 11 | Custom design | Omitted for now; stays long-horizon vision. | D92 |
| 12 | Web address | Each organization gets a stable link `karma.community/org/{slug}`, separate from person links `karma.community/u/{handle}` (`FR-PROFILE-008`). The slug is derived from the name at registration and editable once by an org admin. | D-199 |

---

## Roles & permissions

Authorization reuses the existing org-scoped roles (`spec/12_super_admin.md` FR-ADMIN-016) and the D85 rule that permissions derive from roles only.

| Permission | organization account | `org_admin` | `org_manager` | `org_employee` | `volunteer_manager` | `org_volunteer` |
| ---------- | :-: | :-: | :-: | :-: | :-: | :-: |
| `org.act_as` (switch context, publish, follow, like, comment as the organization) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ only when `org_memberships.can_post = true` |
| `org.profile.edit` (fields, logo, cover, links) | ✓ | ✓ | ✓ | — | — | — |
| `org.profile.slug` (change the slug, once) | ✓ | ✓ | — | — | — | — |
| `org.team.visibility` (toggle who appears on the team tab) | ✓ | ✓ | ✓ | — | ✓ (volunteers only) | — |
| `org.inbox` (read and answer messages sent to the organization) | ✓ | ✓ | ✓ | ✓ | — | — |
| `org.claim` (claim an unclaimed organization) | any signed-in individual, approved by KC admin | | | | | |

- The organization account is implicitly `org_admin` of its organization (a grant row is created at approval, FR-ORG-002 AC6) so every existing `has_admin_role` / `can_grant_role` path keeps working.
- Server side: `can_act_as_org(p_user uuid, p_org_id uuid) returns boolean` (`SECURITY DEFINER`) checks the organization account binding or an active org-scoped grant; every write RPC that takes `p_org_id` calls it and raises `forbidden` (SQLSTATE `42501`). The client's profile switcher is UX only.
- KC platform roles: `super_admin` / `admin` approve registrations and claims (`org.review_applications`, existing), may edit any organization profile (moderation), and may suspend an organization (`status = 'suspended'`).

---

## Data model (summary)

Exact DDL lands with each phase inside the claimed range. All tables keep RLS; writes go through RPCs (`D-194` / ADR-002).

| Table | Phase | Columns / rules |
| ----- | ----- | --------------- |
| `organizations` (extend) | 1 | `+ status text check in ('unclaimed','pending','active','rejected','suspended') default 'pending'`, `+ org_type text check in ('nonprofit_association','public_benefit_company','public_body','informal_initiative','private_venture')`, `+ legal_name text` (≤120), `+ registration_number text null` (unique where not null), `+ founded_year smallint`, `+ logo_path text`, `+ cover_path text`, `+ short_description text` (≤160; backfilled from `public_tagline_he`), `+ about text` (≤4000; backfilled from `public_about_he`), `+ website_url text`, `+ social_links jsonb default '{}'` (keys: `facebook`, `instagram`, `linkedin`, `youtube`, `tiktok`, `x`, `whatsapp`; https URLs only), `+ contact_email text`, `+ contact_phone text`, `+ contact_phone_public boolean default false`, `+ city text`, `+ address text`, `+ address_public boolean default false`, `+ service_area text[]` (city names) + `+ nationwide boolean default false`, `+ fields text[]` (domain slugs from `spec/06_domain_hubs` + world slugs), `+ verification_level smallint check between 0 and 5 default 0`, `+ is_claimed boolean default true`, `+ claimed_at`, `+ source text check in ('registration','external_bodies_import','registrar_import','admin')`, `+ source_ref text`, `+ terms_accepted_at`, `+ created_by uuid`, `+ approved_at`, `+ approved_by uuid`, `+ review_note text`, `+ followers_count int default 0`, `+ following_count int default 0`, `+ open_posts_count int default 0`, `+ updated_at`. `is_verified_nonprofit` stays (set when `org_type in ('nonprofit_association','public_benefit_company') and status='active'`). |
| `users` (extend) | 1 | `+ account_type text check in ('individual','organization') default 'individual'`, `+ org_id uuid null references organizations(org_id)` (set only for organization accounts; unique where not null). An organization account's `display_name` / `avatar_url` mirror the organization's name / logo via trigger so every existing "author" projection keeps working. |
| `org_memberships` (extend) | 1 / 2 | `+ can_post boolean default false` (volunteers), `+ show_in_team boolean default false`, `+ title text` (≤60, e.g. "רכזת מתנדבים"), `+ joined_at`. |
| `org_registrations` (new; replaces `org_applications`) | 1 | `registration_id`, `org_id` (the pending organization row), `applicant_user_id`, `step_state jsonb` (saved draft of the multi-step form), `documents jsonb` (storage paths in bucket `org-documents`, kind: `registration_certificate`, `proper_management`, `other`), `declared_nonprofit boolean not null`, `submitted_at`, `decided_at`, `decided_by`, `decision text check in ('approved','rejected')`, `decision_note`. Backfill: every `org_applications` row becomes an `organizations(status='pending')` + `org_registrations` pair; `org_applications` is then dropped (`migration-safety: allow`, justification in the PR). |
| `external_bodies` → `organizations` | 1 | Backfill each active body as `organizations(status='unclaimed', is_claimed=false, source='external_bodies_import', source_ref=body id, fields=[world])`. `listings.external_body_id` is re-pointed to the new `org_id` (`+ listings.external_org_id`), and `external_bodies` remains as a **compatibility view** over `organizations where source='external_bodies_import'` until TD-229 removes it. |
| `follows` (extend) | 1 | `+ actor_org_id uuid null`, `+ target_org_id uuid null`; CHECK exactly one of (`follower_user_id`, `actor_org_id`) and exactly one of (`followed_user_id`, `target_org_id`). Existing rows untouched. Partial unique indexes per pair. Counters on `organizations` maintained by trigger (same pattern as `users.followers_count`). |
| `listings` (extend) | 1 | `+ author_org_id uuid null references organizations(org_id)`, `+ posted_by_user_id uuid null` (the acting person; `owner_id` stays the account that created the row). Feed/card projections read `author_org_id` first. |
| `chats` (extend) | 2 | `+ org_id uuid null` — a support-style **organization inbox** thread between a person and the organization; members with `org.inbox` see it; replies are attributed to the organization. |
| `org_claims` | 3 | `claim_id`, `org_id` (unclaimed), `claimant_user_id`, `evidence jsonb`, `status`, `decided_by/at`. |
| Storage | 1 | Bucket `org-media` (public read, write via RPC-issued signed upload URL): `{org_id}/logo.{ext}`, `{org_id}/cover.{ext}`; ≤ 5 MB, JPEG/PNG/WebP; `-thumb` siblings per PERF-4. Bucket `org-documents` is private (shared with `spec/19_org_finance.md` FR-FIN-018). |

Audit: `audit_events` rows for `org_register`, `org_approve`, `org_reject`, `org_profile_update`, `org_slug_change`, `org_suspend`, `org_claim_request`, `org_claim_decide`, `org_member_visibility`, with `target_type='organization'`, `target_id=org_id`.

Notifications (`notifications_outbox`, per-kind opt-out per FR-NOTIF-017): `org_registration_decided` (to applicant), `org_new_follower` (to organization inbox members, batched daily), `org_new_post` (to followers of the organization, category `social`, dedupe `org_new_post:<listing_id>`), `org_message_received` (to inbox members), `org_claim_decided`.

---

## Routes

| Route | Screen | Phase | Access |
| ----- | ------ | ----- | ------ |
| `/org/[slug]` | Organization profile (header, info, badges, actions, tabs) | 1 | public, guest-readable |
| `/org/[slug]/followers`, `/org/[slug]/following` | Lists (mirror `FR-PROFILE-009/010`) | 1 | public |
| `/org/[slug]/edit` | Edit organization profile | 1 | `org.profile.edit` |
| `/org/register` (+ `/org/register/[step]`) | Registration wizard | 1 | signed-in individual |
| `/org/[slug]/team` | Team & volunteers tab (deep link) | 2 | public |
| `/org/[slug]/donate` → existing money flows | Donate tab (`FR-DONATE-011`, standing orders) | 1 (fold) | public |
| `/(tabs)/donations/money/nonprofit/[slug]` | **Redirect** to `/org/[slug]?tab=donate` | 1 | — |
| `/org/[slug]/claim` | Claim an unclaimed organization | 3 | signed-in individual |
| `/(admin)/org-approvals` | Existing admin screen, now over `org_registrations` + claims | 1 / 3 | `org.review_applications` |
| Profile switcher | Sheet opened from the avatar in My Profile, the post composer and the chat composer | 1 | members / organization account |

Web link: `https://karma.community/org/{slug}` (same Universal Link / App Link scheme as `FR-PROFILE-008 AC1`).

---

## Phase 1 — One entity, registration, public profile, acting as the organization

## FR-ORG-001 — One organization entity (unify + statuses)

**Acceptance Criteria.**
- AC1. Migration extends `organizations` per § Data model and backfills: existing rows → `status='active'`, `is_claimed=true`, `source='admin'`; `org_applications` → pending organizations + `org_registrations`; active `external_bodies` → `status='unclaimed'`. Row counts before/after are asserted in the migration (`raise exception` on mismatch).
- AC2. `listings.external_body_id` consumers (`search_external_bodies`, `create_marketplace_listing`, medical / animals / environment forms) read from the compatibility view with identical columns; no client change in this PR. TD-229 tracks the follow-up cut-over to `external_org_id`.
- AC3. RLS: `organizations_public_read` returns rows where `status in ('active','unclaimed')` to anon/authenticated; `pending` / `rejected` / `suspended` rows are visible only to their applicant, members, and KC admins (`has_admin_role`).
- AC4. `get_nonprofit_public_page(slug)` and `list_verified_nonprofits` keep their signatures and now read from the unified row; TD-230 tracks their removal once `get_org_public_profile` ships (FR-ORG-003).
- AC5. `slug` generation: Hebrew/Latin name → transliterated kebab-case ≤ 60 chars, unique with a numeric suffix on collision; the platform organization keeps its existing slug.

---

## FR-ORG-002 — Registration wizard + admin approval (creates the profile)

**Description.** Any signed-in individual registers a non-profit organization. KC admins approve; approval activates the profile, creates the organization account and makes the applicant the first `org_admin`.

**Acceptance Criteria.**
- AC1. Entry points: Settings → *"רישום ארגון"*, the empty state of the Search "ארגונים" filter, and the About screen. Hidden for organization accounts (one account, one organization).
- AC2. Steps (draft autosaved to `org_registrations.step_state` after each step; resumable):
  1. **סוג וזהות** — organization type (5 options from § Data model, with one-line Hebrew explanations), legal name (2–120), display name (2–60, defaults to legal name), registration number (**optional**, digits 5–12; when given, FR-ORG-018 offers Registrar enrichment in Phase 3), founded year (optional).
  3. **מה אנחנו עושים** — short description (≤160, required), about (≤4000, optional), fields of activity (1–5 from the domain + world vocabulary), city (required, `public.cities`), service area (cities or "ארצי").
  4. **קשר וקישורים** — organization email (required; becomes the organization account's sign-in email), contact phone (optional, default hidden), website (optional, `https://` enforced), social links (optional).
  5. **לוגו וקאבר** — logo (required, square crop), cover (optional).
  6. **מסמכים** — optional uploads (registration certificate, proper-management certificate, other). Shown as *"מומלץ"*; never required (D89).
  7. **הצהרה ותנאים** — mandatory checkbox *"הארגון פועל ללא מטרות רווח"* (`declared_nonprofit`), mandatory terms + privacy acceptance; `private_venture` adds the D57 marker and the declared social goal (≤280).
- AC3. Submit (`rpc_org_register`) creates `organizations(status='pending')` + `org_registrations`, validates every field server-side, rejects duplicate `registration_number` (`org_registration_number_taken`) and warns on a near-duplicate name (`org_name_similar`, non-blocking, surfaces existing profile + "זה הארגון שלכם? תבעו אותו" when the match is unclaimed → FR-ORG-017). The applicant sees a *"ממתין לאישור"* card in Settings with the submitted summary.
- AC4. Admin review in `(admin)/org-approvals`: each pending row shows every submitted field, documents (signed URLs), near-duplicate hints, and **Approve / Reject (+ note)**. Approve = `admin_org_approve(org_id, note)`; Reject = `admin_org_reject(org_id, note)` (applicant may edit and resubmit once per 7 days).
- AC5. Approval side effects, in one transaction: `status='active'`, `verification_level=1`, `approved_at/by`, `is_verified_nonprofit` per type; create the **organization account**: an auth user with the organization email (invite-style, password set via magic link), `users.account_type='organization'`, `users.org_id=org_id`, `display_name`/`avatar_url` mirrored; grant `org_admin` (scope = org) to **both** the organization account and the applicant; `org_memberships` rows for both; notification `org_registration_decided`; audit `org_approve`.
- AC6. If the organization email already belongs to an individual account, approval stops with `org_email_in_use` and the admin asks the applicant for another email (the applicant can edit the pending registration).
- AC7. All copy under `org.register.*`; every step passes `R-MVP-Core-4` (Hebrew only) and the Hebrew source scan.

---

## FR-ORG-003 — Organization profile screen (public)

**Acceptance Criteria.**
- AC1. `get_org_public_profile(p_slug)` (anon + authenticated, `SECURITY DEFINER`) returns one JSON object: identity (name, legal name, type, founded year, slug), media (logo, cover thumbs), short description, about, fields, city, nationwide / service area, website, social links, contact email, contact phone **only if** `contact_phone_public`, address only if `address_public`, verification level + badges (`is_verified_nonprofit`, `sec46_active` from `spec/19` when present, `proper_management` when a valid document exists, `private_venture` marker), counters (followers, following, open posts), `status`, `is_claimed`, and the viewer's relation (`is_following`, `can_act_as`, `can_edit`). Never returns member identities (those come from FR-ORG-011 with opt-in).
- AC2. Header (organization variant of `ProfileHeader`): cover image (16:9, placeholder tint when missing), square logo overlapping the cover, display name + verification badge row, type chip (e.g. *"עמותה"*, *"יוזמה פרטית"*), city · fields chips (max 3 + "+N"), short description, then the **actions row** (FR-ORG-005). `ProfileStatsRow` shows followers / following / open posts.
- AC3. **Info block** (collapsible *"על הארגון"*): about (expand/collapse at 6 lines), website (opens externally), social icons row, contact email (mailto), phone (tel, when public), address (when public, opens maps), service area, founded year.
- AC4. Tabs (`ProfileTabs`): **פוסטים פתוחים** / **פוסטים סגורים** (FR-ORG-007 rules), **תרומות** (FR-ORG-010, only when `is_verified_nonprofit` and payments enabled). Phase 2 adds **צוות**, **פעילות**, Phase 3 adds **שקיפות**.
- AC5. Status rendering: `unclaimed` shows a banner *"הפרופיל נוצר ממאגר ציבורי ועדיין לא נתבע"* + *"זה הארגון שלכם?"* CTA (FR-ORG-017); `suspended` renders only name + *"הפרופיל מושבת"*; `pending` / `rejected` are not routable for the public (404 → *"הארגון לא נמצא"*).
- AC6. Guest-readable (`FR-DONATE-005` route isolation does not apply to `/org/*`); tapping Follow / Message / Donate as a guest routes to Auth and returns.
- AC7. Responsive per `spec/17_responsive_desktop.md`: cover + two-column info/tabs at ≥ tablet, single column on phones; all touch targets ≥ 44×44; RTL-first.

---

## FR-ORG-004 — Edit organization profile

**Acceptance Criteria.**
- AC1. `/org/[slug]/edit` for `org.profile.edit`: logo (replace), cover (replace / remove), display name, legal name, type (admin-only after approval; others see read-only + "פנו לתמיכה"), founded year, short description, about, fields (1–5), city, service area / nationwide, website, social links, contact email, contact phone + public toggle, address + public toggle. Registration number is read-only after approval (edited via support).
- AC2. Save goes through `rpc_org_update_profile(p_org_id, p_patch jsonb)`; the RPC validates per field (URL scheme `https`, lengths, allowed social keys, fields in vocabulary), writes `updated_at`, mirrors name/logo to the organization account's `users` row, audits `org_profile_update`.
- AC3. Biography/about URL filter from `FR-PROFILE-014` does **not** apply to organizations (website and links are legitimate); instead links are validated as URLs and open externally.
- AC4. Slug change (`rpc_org_change_slug`, `org.profile.slug`): allowed once; the previous slug is kept in `org_slug_redirects` so old links keep resolving (301-style redirect in the route).
- AC5. Errors mapped to Hebrew: `forbidden`, `invalid_url`, `invalid_field`, `name_too_long`, `slug_taken`, `slug_already_changed`, `unknown`.

---

## FR-ORG-005 — Actions on the organization profile

**Acceptance Criteria.**
- AC1. Actions row order (RTL): **עקוב/עוקב** (FR-ORG-008), **שלח הודעה** (Phase 1: opens the existing 1:1 chat with the **organization account** user; Phase 2 upgrades it to the organization inbox FR-ORG-015), **תרום** (only when the Donate tab exists; deep-links to it), **התנדב** (Phase 2, only when the organization has open time-world opportunities), share icon, `⋮` with *"דווח"* (reuses `FR-MOD-*` report flow with `target_type='organization'`) and, for KC admins, *"השבת ארגון"*.
- AC2. Owners/members see **ערוך פרופיל** instead of Follow/Message, and a **"פעל בשם הארגון"** entry that opens the profile switcher (FR-ORG-006).
- AC3. Share uses the OS share sheet / `navigator.share` with `https://karma.community/org/{slug}` (same mechanics as `FR-PROFILE-008 AC3`).

---

## FR-ORG-006 — Profile switcher (act as the organization)

**Description.** A member chooses whether their session acts as themself or as one of their organizations. The organization account always acts as its organization.

**Acceptance Criteria.**
- AC1. `rpc_my_actable_orgs()` returns the organizations the caller may act for (`can_act_as_org`), with name, logo, role. The app stores `activeProfile = { kind: 'user' } | { kind: 'org', orgId, slug }` in AsyncStorage keyed by user id; default `user`. An organization account is pinned to `org` and sees no switcher.
- AC2. Switcher UI: a sheet from the avatar in My Profile, from the post composer header (*"מפרסם בשם: …"*) and from the chat composer; shows the person first, then organizations with role chips. Switching re-renders My Profile as the organization's profile with edit affordances, and sets the composer context.
- AC3. Every write that can be done "as organization" (publish, edit/close post, follow/unfollow, like, comment, chat reply from the inbox) takes an explicit `p_as_org_id uuid default null`; the RPC re-checks `can_act_as_org(auth.uid(), p_as_org_id)` and records the acting person (`posted_by_user_id`, `message.sent_by_user_id`) for audit.
- AC4. A persistent, visually distinct banner *"את/ה פועל/ת בשם {org}"* (organization logo, primary tint) shows on every screen while context ≠ user, with a one-tap *"חזרה לפרופיל שלי"*. Context resets to `user` on sign-out.
- AC5. Guard rails: karma is **never** awarded to the person for actions done as the organization (FR-KARMA-* ledger entries are skipped when `author_org_id` is set — D29/D63 unchanged); ratings given to a post authored by an organization target the organization and are visible to admins only (D24).

---

## FR-ORG-007 — Posts in the organization's name

**Acceptance Criteria.**
- AC1. `create_marketplace_listing` (and every world's create RPC) accepts `p_as_org_id`; on success `listings.author_org_id = org`, `posted_by_user_id = auth.uid()`, `owner_id` = the acting account. Edit/close/republish permissions: any member with `org.act_as` for that organization (not only the original poster).
- AC2. Cards and detail: author block shows the organization's logo + name + verification badge and routes to `/org/[slug]`. Detail adds *"פורסם על ידי {first name} בשם הארגון"* **only** when the acting member has `show_in_team = true`; otherwise just the organization.
- AC3. Organization profile tabs: **פתוחים** lists `author_org_id = org` with status `open`; **סגורים** lists closed where the organization is publisher or respondent, same union rule as `FR-PROFILE-001 AC4`. Visibility `OnlyMe` / `FollowersOnly` are not offered when posting as an organization (always `Public`, D90).
- AC4. No post cap for organizations (S15). Expiry/relevance reminders (D59) go to the organization inbox members (FR-ORG-015) and, until Phase 2, to the organization account.
- AC5. Handoffs: the counterpart sees the organization and the acting member's first name at handoff time (same rule as D16 counterpart masking lifts); chat for the handoff is the organization inbox thread (Phase 2) or the organization account's chat (Phase 1).

---

## FR-ORG-008 — Following organizations and organizations following others

**Acceptance Criteria.**
- AC1. Follow an organization: immediate (no request, D90), `follows(follower_user_id → target_org_id)` or, when acting as an organization, `follows(actor_org_id → target_org_id)`. Unfollow symmetrical. Button states reuse `FR-FOLLOW-011` minus the "request" states.
- AC2. An organization following a **person**: public person → immediate; private person → follow request per `FR-FOLLOW-003`, shown to the person as *"{org} מבקש לעקוב"* with logo. The person's approval rules are unchanged.
- AC3. Followers/following lists on `/org/[slug]/followers|following` mix people and organizations (logo vs avatar, type chip); person lists (`FR-PROFILE-009/010`) gain organization rows too.
- AC4. Blocking: a person can block an organization (hides its posts and prevents the inbox thread); an organization cannot block people (moderation via report).
- AC5. Counters via triggers; the person's `following_count` includes organizations.

---

## FR-ORG-009 — Share link and routing

**Acceptance Criteria.**
- AC1. `https://karma.community/org/{slug}` opens the organization profile in the app or the responsive web profile (`FR-PROFILE-008 AC2` mechanics).
- AC2. Old slugs resolve through `org_slug_redirects` (FR-ORG-004 AC4). Unknown slugs show *"הארגון לא נמצא"* with a link to Search.
- AC3. Deep links from cards, chat avatars, admin hierarchy (`FR-ADMIN-025` tree nodes) and the money world all point here.

---

## FR-ORG-010 — Fold the money nonprofit page into the profile

**Acceptance Criteria.**
- AC1. The **תרומות** tab renders what `/(tabs)/donations/money/nonprofit/[slug]` renders today (campaign progress, total raised, donate once / standing order CTAs, external donation links) using the same components; the old route `router.replace`s to `/org/[slug]?tab=donate`.
- AC2. `list_verified_nonprofits` (money hub directory) is replaced by the Search organizations filter with `fields ∋ 'money'` in Phase 2 (FR-ORG-014); until then it keeps working over the unified row.
- AC3. `listings.beneficiary_org_id` (campaigns) is unchanged.

---

## Phase 2 — Team, activity, discovery, inbox

## FR-ORG-011 — Team & volunteers tab (opt-in visibility)

**Acceptance Criteria.**
- AC1. `rpc_org_team_public(p_slug)` returns members with `show_in_team = true` and an active role: display name, avatar, role label (Hebrew), `title`, joined month. Grouped: הנהלה (`org_admin`, `org_manager`), צוות (`org_employee`, `volunteer_manager`), מתנדבים (`org_volunteer`). Never returns phone/email.
- AC2. Each member toggles their own visibility from Settings → *"הארגונים שלי"*; `org.team.visibility` holders can also hide (never force-show) a member. Default hidden (S50).
- AC3. Tapping a member opens their person profile per `FR-PROFILE-002..004` rules.
- AC4. Empty state: *"הארגון עדיין לא הציג את הצוות שלו"*; for members a hint how to appear.

---

## FR-ORG-012 — Activity tabs (events, volunteering, campaigns)

**Acceptance Criteria.**
- AC1. **פעילות** tab lists, newest first, the organization's open items across worlds: time-world opportunities and events (`spec/05` time world), money campaigns (`beneficiary_org_id`), jobs (employment domain). Each row uses the world's existing card component and routes to its detail.
- AC2. Sub-chips filter by kind (אירועים / התנדבות / קמפיינים / משרות); chips with zero items are hidden.
- AC3. **התנדב** action (FR-ORG-005) appears when ≥ 1 open time-world item exists and scrolls to the tab.

---

## FR-ORG-013 — Impact metrics

**Acceptance Criteria.**
- AC1. `rpc_org_impact(p_slug)` returns: posts closed with a handoff (lifetime), active volunteers (members with `org_volunteer` active), approved volunteer hours (`spec/07.10`), events held, money raised (when verified nonprofit), followers. Computed on read, cached 60 s client-side; no row-level data.
- AC2. Rendered as 3–6 stat tiles under the info block, only tiles with a non-zero value; Hebrew labels; numbers formatted `he-IL`.
- AC3. Not karma: no ranking, no comparison between organizations (non-goal).

---

## FR-ORG-014 — "ארגונים" filter in Search + hub directories (replaces a separate directory)

**Acceptance Criteria.**
- AC1. Universal Search (`FR-FEED-017`) gets a parent filter chip **ארגונים**. While on, results switch to organization cards (logo, name, type chip, city, fields, verification badge, followers) and the **sub-filter row appears**: תחום (fields vocabulary), עיר (`public.cities`), רמת אימות (1–5, D53), סוג ארגון (5 types). Sub-filters are hidden whenever the parent chip is off, and reset when it turns off (S51).
- AC2. Query matches `name`, `legal_name`, `short_description` (ILIKE + trigram), ranked: exact name, then verification level desc, then followers desc. Server pagination 30. RPC `rpc_search_organizations(p_query, p_fields, p_city, p_min_level, p_types, p_limit, p_cursor)` returns only `status in ('active','unclaimed')`; unclaimed rows carry the badge *"לא נתבע"* and sort last.
- AC3. Hub directories (D36): each world/domain hub's *"ארגונים"* block opens Search with the parent filter on and תחום pre-set to the hub's slug. The money hub uses `fields ∋ 'money'` and verified-nonprofit only (replaces `list_verified_nonprofits`).
- AC4. Empty state offers *"רישום ארגון"* (FR-ORG-002) and, when the query looks like a known unclaimed organization, its claim CTA.

---

## FR-ORG-015 — Organization inbox

**Acceptance Criteria.**
- AC1. *"שלח הודעה"* on the profile opens (or reuses) the one thread between the person and the organization (`chats.org_id = org`, participants: the person + the organization). Messages from the organization side are rendered with the organization's logo/name; the acting member is recorded in `messages.sent_by_user_id` and shown to inbox members only.
- AC2. Members with `org.inbox` see an **"תיבת הארגון"** section in Chat (grouped by organization when they serve several), with unread counts; any of them can reply. Read receipts (`FR-CHAT-011`) reflect "read by the organization".
- AC3. `org_message_received` notifications go to inbox members (per-kind opt-out); the person gets regular chat notifications.
- AC4. Phase 1's fallback (chat with the organization account) migrates: existing threads with the organization account get `org_id` set in the Phase 2 migration.

---

## FR-ORG-016 — Notifications for organizations

**Acceptance Criteria.**
- AC1. Followers receive `org_new_post` when an organization publishes a public post (dedupe per listing, respects quiet hours FR-NOTIF-016 when shipped, per-kind opt-out).
- AC2. Inbox members receive a daily digest `org_new_follower` (count + up to 5 names) instead of per-follow pushes.
- AC3. The organization account itself receives no pushes (it is an identity, not a person); routing goes to inbox members.

---

## Phase 3 — Claiming, enrichment, badges, transparency

## FR-ORG-017 — Claim an unclaimed organization

**Acceptance Criteria.**
- AC1. On an unclaimed profile, *"זה הארגון שלכם?"* opens `/org/[slug]/claim`: a short form (role in the organization, organization email, optional registration number, optional document) → `org_claims(status='pending')`; the admin screen gets a **תביעות** tab.
- AC2. Approve = the claimant becomes `org_admin`, the organization account is created with the given email (same side effects as FR-ORG-002 AC5), `is_claimed=true`, `status='active'`, `claimed_at`; the catalog data stays and becomes editable. Reject keeps the row unclaimed.
- AC3. A registration (FR-ORG-002) whose name or number matches an unclaimed row is redirected to claim it instead of creating a duplicate (`org_claim_suggested`).

---

## FR-ORG-018 — Registrar enrichment (optional, S35)

**Acceptance Criteria.**
- AC1. When a registration number is entered (registration or edit), `rpc_registrar_lookup(p_number)` queries a server-side mirror of the Registrar of Nonprofits open data (data.gov.il, synced nightly by an Edge Function; source attribution stored) and offers to prefill legal name, founded year, city, and shows whether a **proper-management certificate** is current (→ `verification_level ≥ 2` badge candidate; admin confirms).
- AC2. Lookup failures are silent (the number stays optional, D89); a *"מקור: רשם העמותות, עודכן ב-…"* line appears under prefilled fields.
- AC3. We never scrape GuideStar (S35).

---

## FR-ORG-019 — Verification-level badges (display contract for D53)

**Acceptance Criteria.**
- AC1. The profile header shows the highest level as a badge with Hebrew label: 1 *"ארגון רשום ב-KC"*, 2 *"ניהול תקין"*, 3 *"דירוג מידות"*, 4 *"שקיפות"*, 5 *"אפקטיביות"*; tapping explains the level (sheet). Levels are set by KC admins (`admin_org_set_verification_level`, audited) or by rules defined in `08_organizations.md` S40/S41 when they land.
- AC2. Search sub-filter *"רמת אימות"* and the card badge read the same column.
- AC3. The Section 46(a) badge from `spec/19_org_finance.md` FR-FIN-007 renders beside the level badge when active.

---

## FR-ORG-020 — Transparency tab (hand-off to `spec/19_org_finance.md`)

**Acceptance Criteria.**
- AC1. The **שקיפות** tab mounts `OrgTransparencySection` (FR-FIN-020) fed by `rpc_org_transparency(slug)`; hidden when the organization published nothing and has no 46(a) badge (FR-FIN-020 AC3).
- AC2. Organization admins see an *"ניהול שקיפות"* shortcut into the Admin Portal finance sub-tree (`/admin/finance/transparency`).

---

## Non-functional requirements

- **Security.** RLS on every table; writes RPC-only with `can_act_as_org`; organization-account sign-in is a normal Supabase auth user (no shared passwords in the app); media bucket public-read but write-by-RPC; documents bucket private.
- **Privacy.** Members are invisible by default; phone and address hidden by default; the acting person behind an organization action is visible publicly only by opt-in; organizations are always public, so no private-profile code paths are added.
- **Integrity.** One organization per organization account (`users.org_id` unique); exactly one actor and one target per follow row; counters by trigger with a nightly reconciliation job.
- **Performance.** `get_org_public_profile` p95 < 300 ms; organizations search p95 < 400 ms on 50k organizations (GIN on `fields`, trigram on `name`/`legal_name`).
- **Accessibility / RTL.** Header, chips, tabs and switcher banner fully RTL; `accessibilityRole` on every action; the context banner is announced on change.
- **Testing.** Domain + application unit tests; `map*Row` tests; SQL tests for `can_act_as_org`, the follow CHECKs, backfill counts; RLS persona suite rows (guest, individual, member, organization account, admin); Playwright: register → approve → profile → follow → post as organization → appears on profile.
- **i18n.** Hebrew bundle only; keys under `org.*` (`org.profile`, `org.register`, `org.switcher`, `org.team`, `org.search`), notification keys in `dispatch-notification/i18n.json`.

---

## Open items for the PM (non-blocking; defaults apply until answered)

| # | Question | Default applied |
| - | -------- | --------------- |
| O1 | Field list and default visibility (Q4): anything to hide by default beyond phone, address and team? | S50 as written. |
| O2 | Should an organization be able to **like / comment** as the organization, not only publish? | Yes, same as publish (FR-ORG-006 AC3). |
| O3 | Terms of use for organizations (a short organization addendum) — legal text needed before FR-ORG-002 ships. | Placeholder key `org.register.termsAddendum`; PM supplies the text. |
| O4 | Should rejected registrations be visible to the applicant with the admin note? | Yes, note shown verbatim (FR-ORG-002 AC4). |

---

| Version | Date | Summary |
| ------- | ---- | ------- |
| 0.1 | 2026-10-30 | Initial end-to-end spec from PM Q&A. Defines `FR-ORG-001..020` in three phases: one organization entity (folds `org_applications` + `external_bodies`, closes G5), registration without mandatory registration number (D89), public profile at `/org/{slug}`, edit, profile switcher / act-as (D88), posts in the organization's name (D91), always-public + organizations may follow (D90), Search "ארגונים" filter with sub-filters instead of a directory screen (D91/S51), no custom layouts (D92), team opt-in (S50), inbox, impact, claiming, Registrar enrichment, badges, transparency hand-off. Claims migrations `0490–0509`. Engineering decision `D-199`. |
