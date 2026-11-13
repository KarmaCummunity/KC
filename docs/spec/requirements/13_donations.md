# 2.13 Donations Hub

> **Status:** ✅ Core Complete — Hub, 6 categories, donation links, Edge Function shipped. ⚠️ Audit 2026-05-16: ✅ **`validate-donation-link` SSRF closed** — port allow-list, private / loopback / metadata hosts, IPv4-mapped IPv6 (dotted and hex form), a DNS-resolution check (`dnsGuard.ts`, #1234), all re-validated on every manual redirect hop (TD-79). Residual lookup-vs-fetch race: TD-265. 🟠 FR-DONATE-003 AC2 missing jgive CTA; FR-DONATE-001/006 layout is 2-col grid instead of vertical stacked with divider; FR-DONATE-008 AC3 reachability rule diverged (`!= 404` instead of `200..399`); error-code parity gaps. TD-97. See `docs/SSOT/archive/audit/2026-05-16/06_donations_stats_settings.md`.
>
> **Money hub (2026-10-30):** `FR-DONATE-011` ✅ — direct support for KC (one-time via Bit / PayBox / card page, monthly standing order via a hosted card page) with a donor legal notice; channel URLs are server config (`kc_support_channels`, migration `0447`). `FR-DONATE-003` jgive CTA and community links restored; the sandbox in-app org flow (#850) is hidden behind `money_in_app_org_payments` (default off). Payment confirmation + karma (D20 "receives confirmation", 07.6) remain open — G8.
>
> **Status correction (2026-10-30):** the `validate-donation-link` item from the 2026-05-16 audit (TD-79 there) is resolved in code — host/port/redirect validation is implemented in `supabase/functions/validate-donation-link/index.ts`. Remaining open items: layout, reachability rule (FR-DONATE-008 is superseded by D9, see `docs/spec/95_reconciliation.md`).
>
> **Behavior update (2026-05-12)** — Donation link **remove** is a hard **`DELETE`** on `donation_links` (authorized by RLS policy `donation_links_delete_own_or_admin`); the app no longer sets `hidden_at` / `hidden_by` on remove. **Edit** must always invoke `validate-donation-link` with body field **`link_id`** set to the UUID of the row being edited so the Edge Function performs an **UPDATE**, never a second INSERT. One-time DB cleanup: migration `0050_donation_links_purge_soft_deleted.sql` deletes rows that were previously soft-hidden (`hidden_at IS NOT NULL`). עברית: מחיקה = מחיקת שורה מהטבלה; עריכה = עדכון אותה שורה ב־UUID שנבחר, לא יצירת קישור חדש.

Prefix: `FR-DONATE-*`

---

## Scope

A bottom-bar tab that surfaces the three donation modalities of the platform — items, time, money — and routes the user to the right place per choice. In MVP, only **items** is fully native; **money** and **time** are coming-soon screens that route to external partners (`jgive`, `Lev Echad`), and **time** additionally offers a direct path to volunteer in our own org via the existing Super Admin chat (`FR-CHAT-007`).

Non-goals (out of scope):

- Server-side filtering, ranking, or recommendations on the Hub.
- Per-organization volunteer dispatch beyond a single admin thread.
- Native fundraising / in-app payment processing (deferred — phase 2, D20). Donations to KC itself (`FR-DONATE-011`) and to partner nonprofits are link-outs to licensed providers; the app never handles payment data.
- Universal search across donation categories — that lives in `FR-FEED-016` (placeholder) and a future `FR-FEED-017+` (engine).

---

## FR-DONATE-001 — Donations Hub: one list of giving worlds

**Description.**
The Donations tab opens to a Hub screen with ONE list of tiles, one per giving world (project book `D100`): items, food, transport, time, money, housing, knowledge, medical, animals, democracy, employment, challenges. There is no featured card and no second "domains" section.

**Source.**
- Design spec: [`docs/SSOT/archive/superpowers/specs/2026-05-09-donations-and-search-tabs-design.md`](../../archive/superpowers/specs/2026-05-09-donations-and-search-tabs-design.md) (original three-tile hub, superseded).
- Decisions: `D-16`, `D100`, `D107`; product book `docs/spec/04_product_structure.md`.

**Acceptance Criteria.**
- AC1. *(D100; order refined by AC8)* With no visit history, tiles appear in the order of `GIVING_WORLD_SLUGS` (active worlds before portal worlds, AC8): חפצים, אוכל, תחבורה, זמן, כסף, דיור, ידע, רפואה, בעלי חיים, דמוקרטיה, תעסוקה, אתגרים — in one 2-column grid under one heading, all tiles looking alike (no featured tile). The retired domains and the experiences world have no tile and no screen, and no redirect.
- AC2. Each tile shows an icon, a title, and a one-line subtitle. Tap target ≥ 44×44.
- AC3. Each tile is `accessibilityRole="button"` with `accessibilityLabel` = title + subtitle.
- AC4. The Hub screen is reachable from the bottom-tab `💝 תרומות` icon and from any screen that has a global TabBar.
- AC5. Hub layout is responsive: the container max-width stays centered on Tablet/Desktop.
- AC6. *(2026-11-01, `D-207`)* The hub has **no "donations marketplace" (שוק התרומות) entry** and the marketplace browse screen is gone: listings are found in the main feed and in each giving world's screen (`06_feed_and_search.md`). The old URL `/donations/marketplace` redirects to the hub; single-listing pages (`/donations/marketplace/<id>`), the listings map and "my listings" (profile menu → *המודעות שלי*) stay.
- AC7. *(2026-11-03)* A world whose launch flag is off (D60) is **never hidden**: its tile carries a small **"פורטל"** tag and the subtitle "קישורים וידע"; an active world has no tag. Opening a portal world shows its links and knowledge, with no feed. Worlds without a screen of their own (medical, animals, democracy, employment, challenges) open `/(tabs)/donations/category/<slug>`.
- AC8. *(2026-11-07)* **Personal order.** Active worlds always come before portal worlds (AC7). Inside each group, tiles are ordered by the member's time-decayed visit score: every tap on a hub tile adds 1, and older visits fade with a 14-day half-life (`WORLD_AFFINITY_HALF_LIFE_DAYS`), so recent habits outrank old ones. Equal scores keep the `GIVING_WORLD_SLUGS` order, so a new member sees the canonical order. Scores live on the device only (AsyncStorage `kc-world-affinity-<userId|guest>`), are never sent to the server and are malformed-safe (`parseWorldAffinity`). The order is taken when the hub gains focus, never while the member is on it, so tiles do not move under the finger. Code: `worldAffinity.ts` (domain), `useHubWorldOrder` (mobile).

**Related.** Screens: 2.6 · `FR-DONATE-002`, `FR-DONATE-003`, `FR-DONATE-004`, `FR-POST-001` AC6, `FR-FEED-020`.

---

## FR-DONATE-002 — Items tile navigation

**Description.**
Tapping the Items tile opens the items world screen (`/(tabs)/donations/items`) like every other world tile (`D100`; before 2026-11-03 it opened the Home Feed).

**Source.**
- Design spec: §5.2.

**Acceptance Criteria.**
- AC1. Tap on the **חפצים** tile pushes `/(tabs)/donations/items` — the items world's own feed (`FR-FEED-020` AC2).
- AC2. The main Home Feed stays reachable from the Home tab; its filter state is untouched (per `FR-FEED-005`).
- AC3. Back navigation from the feed returns to the previous screen per OS / expo-router defaults.

**Related.** Screens: 2.1 · `FR-FEED-001`, `FR-FEED-005`.

---

## FR-DONATE-003 — Money sub-screen

**Description.**
The Money hub. Top to bottom: hero → *Support KC directly* card (`FR-DONATE-011`) → partner-nonprofits card linking out to `jgive` → community NGO links (`FR-DONATE-007`) → the in-app verified-nonprofit flow (#850), rendered only while the `money_in_app_org_payments` flag is on (it runs on a sandbox provider). The screen is a single vertical `ScrollView` (`FR-DONATE-007 AC6`).

**Source.**
- Design spec: §5.3.
- Decisions: `D-16`, `D20`, `D37` (project book `docs/spec/05_giving_worlds.md` §5.5).

**Acceptance Criteria.**
- AC1. Hero body copy comes from `donations.moneyScreen.body` (2026-10-30: support KC, find nonprofits, share links — replaces the coming-soon and sandbox wording).
- AC2. The partner card (`PartnerNonprofitsCard`) shows `supportKc.partnersTitle` / `partnersBody` and a secondary button `donations.moneyScreen.openLink` that opens `https://www.jgive.com`.
- AC3. The link opens in the platform's external browser (no in-app WebView).
- AC4. If the link cannot be opened, the user sees `donations.moneyScreen.linkErrorBody`.
- AC5. The screen is auth-required in MVP-core (`FR-DONATE-005`); see TD-112 for future guest-scope mirror.
- AC6. **(FR-DONATE-007 augmentation, 2026-05-10)** Below the existing CTA, the screen renders a `<DonationLinksList categorySlug="money" />` section — same component as the new category screens — listing community-curated links and exposing the *"+"* add-link button.
- AC7. **(2026-10-30)** The in-app verified-nonprofit section (nonprofit list, donation history and standing-order links, sandbox banner) renders only when `useFeatureFlag('money_in_app_org_payments')` is true. Compiled default `false`; remote override row seeded `false` by migration `0447`.

**Related.** Screens: 2.7 · External link target: `jgive.com`.

> **Implementation note (2026-05-12):** As of migration `0048_donation_link_report_message.sql`, the message is an actual `kind='donation_link_reported'` system message (not a plain user message). The admin sees a `DonationLinkReportedBubble` with a tap-to-open card. The Hebrew body in the original AC text describes the previous shape — the new payload structure is `{kind, link_id, url, display_name, category_slug}`.

---

## FR-DONATE-004 — Time sub-screen

**Description.**
A coming-soon screen for the Time modality that links out to `Lev Echad / we-me` and offers a direct volunteer-message path to our Super Admin via inline composer.

**Source.**
- Design spec: §5.4.
- Decisions: `D-16`.

**Acceptance Criteria.**
- AC1. Body copy (Hebrew, verbatim): *"קטגוריית הזמן תפתח בקרוב. ועד אז מזמינים אתכם להיכנס ולמצוא הזדמנויות התנדבות בפלטפורמה של ׳לב אחד׳."*
- AC2. A primary button labeled *"פתח את לב אחד ↗"* invokes `Linking.openURL('https://www.we-me.app/')`.
- AC3. Below a section divider, secondary copy: *"ניתן גם להתנדב ישירות בארגון שלנו, במקצוע שלך. השאירו הודעה ונחזור אליכם."*
- AC4. A multiline `<TextInput>` placeholder: *"הקלידו את ההודעה שלכם — מקצוע, תחום עניין, וזמינות..."*; max length 2,000 characters (consistent with `FR-CHAT-002 AC5`).
- AC5. A primary button labeled *"שלח הודעה"*:
   - Disabled when the trimmed text is empty.
   - On press (authed user, non-empty text): the message is appended to a local `volunteer_intent_log` in `AsyncStorage` (FIFO, capped to 50 entries). An alert is shown: *"תודה! ההודעה התקבלה. ניצור איתך קשר בקרוב דרך הצ'אט."* The textbox is cleared.
   - The screen is auth-required in MVP-core (`FR-DONATE-005`); guest interaction is N/A.
- AC6. ✅ **TD-114 closed (2026-05-16).** Composer uses `GetSupportThreadUseCase` + `SendMessageUseCase` with body prefixed `"התנדבות בארגון: "`; navigates to `/chat/[chatId]` on success. AsyncStorage local log removed.
- AC7. AsyncStorage write failure is silent; the alert is still shown so the user gets feedback.
- AC6. The use-case **resolves** the Super Admin user record by canonical email `karmacommunity2.0@gmail.com` (identical to `FR-CHAT-007 AC1`) and **finds-or-creates** the support `Chat` (`is_support_thread = true`). It **does not** create a second support thread when one already exists.
- AC7. The first message body is the user's text **prefixed** with the literal string *"התנדבות בארגון: "*. The prefix is contractual and is not localized in MVP.
- AC8. Network failure: the textbox content is preserved and an inline retry control is shown: *"לא נשלח. נסו שוב."*
- AC9. **(FR-DONATE-007 augmentation, 2026-05-10)** Below the volunteer composer, the screen renders a `<DonationLinksList categorySlug="time" />` section — same component as the new category screens — listing community-curated links and exposing the *"+"* add-link button.

**Related.** Screens: 2.8 · `FR-CHAT-007` · External link target: `we-me.app`.

---

## FR-DONATE-005 — Guest behavior on Donations

**Description.**
In MVP-core, the Donations tab and its sub-screens are **auth-required**. Guests live in the route-isolated `(guest)/feed` and do not see the bottom bar. A guest who deep-links to any `/donations/*` or `/search` route is redirected to `1.2 Auth`, consistent with PRD §6.8.1.

A future enhancement (`TD-112`) may mirror the Money and Time sub-screens into a `(guest)/donations/...` group so guests can engage with the external partner links (`jgive`, `we-me`) without authenticating; that is out of scope here.

**Source.**
- Design spec: §4.4.
- Constraints: `R-MVP-Core-2`, PRD §6.8.1.

**Acceptance Criteria.**
- AC1. The 5-tab bottom bar (with Donations + Search) is rendered only post-auth (consistent with the existing `_layout.tsx` `showTabBar` condition).
- AC2. A guest who attempts deep-link navigation to `/donations`, `/donations/money`, `/donations/time`, or `/search` is redirected to `1.2 Auth` per PRD §6.8.1.
- AC3. After authentication, the user lands on the home feed (`/(tabs)`) per existing post-auth flow; the originally requested route is **not** preserved in MVP-core (TD-111).

**Related.** Screens: 1.7, 2.5, 2.6, 2.7, 2.8 · `FR-AUTH-014`, `FR-FEED-012`, PRD §6.8.1.

---

## FR-DONATE-006 — Donations Hub: 6 new category tiles

**Description.**
The Donations Hub is extended with 6 community-driven category tiles below the existing items/time/money tiles, separated by a thin divider.

**Source.**
- Design spec: [`docs/SSOT/archive/superpowers/specs/2026-05-10-donation-categories-and-links-design.md`](../../archive/superpowers/specs/2026-05-10-donation-categories-and-links-design.md).

**Acceptance Criteria.**
- AC1. Tile order (visual top-to-bottom in RTL): existing **חפצים → זמן → כסף** group, then divider, then new group **אוכל → דיור → תחבורה → ידע → חיות → רפואה**.
- AC2. Each new tile uses the same `<DonationTile>` component (same height, icon, title, subtitle styling) as the existing tiles.
- AC3. Tap routes to `/(tabs)/donations/category/<slug>` where `<slug>` is one of `food`, `housing`, `transport`, `knowledge`, `animals`, `medical`. The route renders a hero (icon + title + subtitle) and the `<DonationLinksList>` for that slug.
- AC4. The category list (`donation_categories`) and per-category links (`donation_links`) are persisted in Postgres and shared across all users; categories are seeded by migration `0014_donation_categories_and_links.sql`.

---

## FR-DONATE-007 — DonationLinksList component

**Description.**
A reusable component renders the community-curated NGO link list for any category slug in `('time','money','food','housing','transport','knowledge','animals','medical')`. Used both on the new dynamic category screen and embedded below the existing Time and Money screens.

**Acceptance Criteria.**
- AC1. Lists rows for the slug where the row still exists and is visible: `donation_links.category_slug = slug AND hidden_at IS NULL`, newest first. *(2026-11-03, D9, `0546`)* Other members see only rows with `review_status = 'approved'`; the submitter also sees their own pending or rejected row, with its status ("waiting for KC team approval" / "not approved" and the reviewer's note). (Hard-deleted rows are gone from the table; `hidden_at` remains in the schema only for legacy rows until purged.)
- AC2. Header row shows the section title (*"עמותות וקישורים"*) and a small *"+"* icon button (32×32, primary color) on the leading RTL edge.
- AC3. Each row shows: site favicon (with `link-outline` Ionicon fallback on image error), display name (h3), description (body, 2-line clamp), and tiny domain chip. Tap → `Linking.openURL(url)`.
- AC4. Empty state shows a friendly message + centered *"הוספת קישור ראשון"* CTA that opens the add-link modal.
- AC5. Loading state shows an `ActivityIndicator`; transient load failure shows an inline error + *"נסה שוב"* retry button.
- AC6. Rows render in a non-scrolling block (`View`); the **host screen** must wrap the hub section in a vertical `ScrollView` (or equivalent) so long category lists scroll reliably on web and native. Virtualized `FlatList` for this block alone is deferred (nested scroll + unbounded height issues on RN Web).
- AC7. After a successful **add**, **edit**, or **remove** for this category, the component **re-fetches** the list from Postgres (silent refresh: no full-screen loading swap) so the UI matches the database without manual navigation or pull-to-refresh.

---

## FR-DONATE-008 — Add / edit link flow + Edge Function validation

> ⚠️ **Superseded by the project book** — D9 — an org link goes live only after KC admin approval. Binding text: `docs/spec/08_organizations.md`. Evidence and status: `docs/spec/95_reconciliation.md` §2. The text below is kept as history (D35).

**Description.**
Any signed-in user can submit a new donation link via a modal sheet, or **edit their own** link (same modal; FR-DONATE-009). The submission is validated server-side by the `validate-donation-link` Edge Function which performs a URL reachability check and inserts or updates the row using the service-role key. Direct `donation_links` INSERT from client roles is blocked by RLS.

**Acceptance Criteria.**
- AC1. The modal collects: URL, display name (2..80 chars), description (optional, ≤280 chars).
- AC2. The *"הוסף"* / *"שמור"* primary action is disabled until URL matches `^https?://` and display name length is in range.
- AC3. On submit (add), the client calls the `validate-donation-link` Edge Function without `link_id`. The function:
  - Validates inputs and confirms `category_slug` is one of the 8 allowed slugs.
  - Enforces a soft rate-limit of 10 inserts per user per hour; over-limit returns `rate_limited`.
  - Performs `fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) })`. On 4xx/5xx or `405`, retries once with `GET`. Treats status `200..399` as reachable.
  - On reachability success, inserts a row with `validated_at = now()` using the service-role client and returns the inserted row.
- AC3b. On submit (**edit**), the client calls the same Edge Function with `link_id` set to the row UUID and the same field payload; the function verifies the caller is `submitted_by` **or** `users.is_super_admin = true` for that session user, the row is visible (`hidden_at IS NULL`), `category_slug` matches the stored row, then re-checks reachability (same `checkReachable` rules as insert) and **updates** `url`, `display_name`, `description`, `validated_at` (no insert rate-limit).
- AC3c. **Client contract (edit vs add).** While the modal is bound to an existing list row (edit mode), every successful save **must** use the update path (non-empty `link_id` in the Edge Function body). The client **must not** call the insert-only path in that mode; doing so would create a duplicate row. Implementation: submit handler derives `link_id` from the bound row’s primary key (`editingLink.id`), not from auxiliary state that can lag behind `visible`.
- AC4. UI feedback during submit: button shows a spinner with the label *"מאמת קישור..."*; on success the modal closes and the list reflects the change; on failure an inline localized error message is shown keyed off the returned `code` (`invalid_url`, `unreachable`, `rate_limited`, `unauthorized`, `forbidden`, `network`, `unknown`).
- AC5. Auto-publish: a successfully inserted or updated row is visible to all signed-in users immediately (no admin approval queue).

---

## FR-DONATE-009 — Reporting, edit, and removal

**Description.**
Each row's overflow (`…`) menu opens an action sheet with: *"פתח"*, *"דווח על קישור"*, *"ערוך"* (submitter **or** super-admin), and *"מחק"* (submitter **or** super-admin).

**Persistence.** *"מחק"* removes the row from Postgres via **`DELETE`** (see AC4–AC5). The authenticated app uses the Supabase client `delete` on `donation_links.id`; the Edge Function is **not** involved in remove. *"ערוך"* continues to use the Edge Function update path per `FR-DONATE-008`.

**Acceptance Criteria.**
- AC1. *"פתח"* → `Linking.openURL(url)`.
- AC2. *"דווח על קישור"* → reuses the existing get-or-create support thread (`FR-CHAT-007`) and sends a system-style message: `דיווח על קישור (donation_link:<id>) — <url>`. A success alert is shown.
- AC3. *"ערוך"* is shown when `donation_links.submitted_by = auth.uid()` **or** the session user is super-admin (`users.is_super_admin = true`). It opens the same modal as add with fields prefilled; saving calls the Edge Function update path (`link_id`) per `FR-DONATE-008 AC3b` and the client contract `FR-DONATE-008 AC3c`. On success the row updates in the list in place (no duplicate row).
- AC4. *"מחק"* is shown when `donation_links.submitted_by = auth.uid()` **or** the session user is super-admin (`users.is_super_admin = true`). On confirm, **permanently deletes** the row (`DELETE`); the row is removed from the local list immediately. Legacy soft-hidden rows (`hidden_at IS NOT NULL`) are purged by migration `0050_donation_links_purge_soft_deleted.sql` so the table stays aligned with the UI.
- AC5. Delete authorization is enforced by the `donation_links_delete_own_or_admin` RLS policy (own row OR `users.is_super_admin = true`). Columns `hidden_at` / `hidden_by` remain on the table for backward compatibility but are no longer written by the app remove path.

---

## FR-DONATE-010 — Platform-support donation card

**Description.**
A warm card prompting the viewer (guest or signed-in — see AC5) to back the platform itself. Embedded in the About screen (twice — directly after the hero, and after the Vision section) and at the very top of the Settings screen. Since 2026-10-30 it is a thin wrapper over the `FR-DONATE-011` card: same server-configured channels, same legal notice; only the heading and tagline differ.

**Source.**
- Product request 2026-05-18 (PM); 2026-10-30 alignment with `FR-DONATE-011` and `D64`.

**Acceptance Criteria.**
- AC1. `DonationSupportCard` renders `SupportKcCard` with `titleKey = donations.supportUs.title` and `taglineKey = donations.supportUs.tagline` (warm surface, heart icon badge, h3 title, body tagline).
- AC2. Buttons, their order and their destinations come from `FR-DONATE-011 AC1–AC3` (`kc_support_channels`). No payment URL is compiled into the app. While only the interim Bit / PayBox rows are active they are what the card shows; once a `card_one_time` clearing page is configured they are withdrawn (`D64`).
- AC3. Opening and link-failure behavior follow `FR-DONATE-011 AC4`.
- AC4. All visible strings come from `donations.supportUs.{title,tagline}` and `supportKc.*`; no inline strings in components.
- AC5. Card is auth-agnostic — it renders for guest and signed-in users (`kc_support_channels` is readable by `anon`). The standing-order cancellation link is shown to signed-in users only (`FR-DONATE-011 AC6`).
- AC6. Placement:
  - `AboutLandingScreen` — between `AboutHero` and `AboutSectionBlocksTop`, wrapped in `<AnimatedEntry delay={240}>` so it appears after the hero stagger completes.
  - `AboutSectionBlocksTop` — between the Vision section card and the Problems section card, wrapped in the same `AnimatedEntry` stagger as adjacent sections.
  - `settings.tsx` — first element inside the outer `ScrollView`, padded with `spacing.base` on both axes (`supportCardWrap`).
- AC7. Touch targets ≥ 44 × 44 px; each button's accessibility label names the channel and provider (`supportKc.channelA11y`).
- AC8. The only network read is the channel list; when it cannot load, the card shows `supportKc.unavailable` and no payment link.

**Related.** `FR-DONATE-011` (shared card, channels and legal notice). Independent of the community-curated NGO links (`FR-DONATE-007..009`).

---

## FR-DONATE-011 — Support KC directly: one-time + monthly standing order

**Description.**
A *Support KC directly* card at the top of the Money hub lets a donor give to Karma Community itself — once (Bit, PayBox, or a credit-card hosted page) or as a monthly credit-card standing order. Per `D20` the app **only redirects**: every option is a licensed provider's hosted page opened outside the app, so card and bank details never pass through KC (no PCI-DSS scope) and App Store 3.2.2(iv) / Google Play donation rules are respected. Destination URLs are server configuration so the provider can be swapped without a release (`D20`).

**Source.**
- PM request 2026-10-30; project book `D4`, `D20`, `D64` (`docs/spec/05_giving_worlds.md` §5.5, `docs/spec/08_organizations.md`), gap `G8`.

**Acceptance Criteria.**
- AC1. **Configuration.** Channels live in `public.kc_support_channels` (migration `0447`; after the baseline cut-over migration `0019`, read through `list_kc_support_channels()`, written by the super admin only): `channel ∈ {bit, paybox, card_one_time, card_standing_order}` (PK), `url`, `provider_label`, `is_active`. A CHECK accepts only `https://` URLs without credentials or whitespace. RLS: `anon` + `authenticated` read active rows; only `has_admin_role(auth.uid(),'super_admin')` may write. `bit` and `paybox` are seeded with the `FR-DONATE-010` URLs; card rows are added by the operator once the Grow merchant account exists (launch plan A11, `docs/SSOT/OPERATOR_RUNBOOK.md` → *KC support channels*).
- AC2. **Resolution.** `GetKcSupportOptionsUseCase` returns `{ oneTime, standingOrder }`: insecure URLs are dropped (domain `isSecureSupportUrl`, mirrors the CHECK), the first row per kind wins, one-time order is `bit → paybox → card_one_time`. **`D64`:** Bit / PayBox are interim transfer links, not clearing — when an active, secure `card_one_time` row exists they are omitted. The server list is the single source: there is no compiled fallback; a load failure surfaces as the *unavailable* state (AC3), and an empty list is respected (operator disabled all).
- AC3. **Buttons.** One-time heading + one full-width button per one-time channel (first = primary style, rest = secondary); standing-order heading, body naming the provider (`supportKc.standingOrderBody`), and a *Set up a standing order* button — each section only when it has a channel. Every button carries an `open-outline` icon and an accessibility label naming the provider and that it opens outside the app. While loading, a spinner; with no channels, `supportKc.unavailable`.
- AC4. **Opening.** A tap opens the exact configured URL in the external browser / provider app (`Linking.openURL`; `window.open` on web). Never an in-app WebView. Failure → `supportKc.linkError`.
- AC5. **Legal notice** (`SupportKcDisclosure`, always shown): payment is processed off-app by a licensed provider and card/account details are neither seen nor stored by KC; the money goes to the **personal account of KC's founder** (D121) and funds building and running the platform; KC is not yet a registered nonprofit, so **no section-46 tax credit**, and the provider sends the payment confirmation; the donation is voluntary and grants no in-app benefit, service or priority.
- AC6. **Standing-order cancellation.** When a standing order is offered, the notice adds that it can be cancelled at any time, effective within 3 business days at the latest (Israeli Consumer Protection Law §13D), and — for signed-in users — a *Request to cancel a standing order* link: confirm dialog → the fixed text `supportKc.cancelMessage` is posted to the user's support thread (`FR-CHAT-007`) → navigate to that chat. Send failure keeps the user on the screen with `supportKc.cancelError`. Operator obligation: stop the order at the provider and confirm in that chat within 3 business days.
- AC7. All strings live in `supportKc.*` (he + en); the disclosure wording changes only with PM approval.
- AC9. **Payee phone (interim, D121).** `kc_support_channels.payee_phone` (migration `0550`, Israeli mobile `05XXXXXXXX`, Bit / PayBox rows only) holds the number donors transfer to. The app reads channels only through `list_kc_support_channels()`, which returns active rows and NULLs the phone for guests; `anon` has no column grant on `payee_phone`. For signed-in users each Bit / PayBox button is followed by *"Or transfer manually to 050-XXX-XXXX"* (selectable) and a copy action — browser clipboard on web, system share sheet on iOS / Android. The number is configured by the operator in the DB and never committed to the repo.
- AC8. Out of scope (open, `G8`): provider confirmation webhook, recording donations to KC, and the karma award for donations / standing orders (`docs/spec/07_cross_cutting_systems.md` §7.6) — they require the Grow API credentials.

**Related.** `FR-DONATE-003` (host screen), `FR-DONATE-010` (same card on About + Settings), `FR-CHAT-007`.

---

## FR-DONATE-011 — Medical category: curated life-saving bodies directory

**Description.**
The `medical` category screen (`/(tabs)/donations/category/medical`) renders a static, app-wide directory of leading Israeli life-saving and medical bodies above the community-curated `DonationLinksList`. Unlike `FR-DONATE-007` links, entries are shipped with the app (not user-submitted) and are not editable by users.

**Source.**
- Product request 2026-10-30 (PM).

**Acceptance Criteria.**
- AC1. Entries are grouped into five sections, in order: blood donation, organ & bone marrow donation (ADI card), first aid & rescue, medical equipment loans, patient & family support.
- AC2. Each entry shows a name, a short description and an `open-outline` affordance; tapping opens the official https URL in the external browser (`Linking.canOpenURL` → `Linking.openURL`). On failure an `Alert` shows `medicalBodies.linkError`.
- AC3. All visible strings come from `medicalBodies.*` (he + en bundles); URLs and section structure live in `features/donations/medicalBodies.ts`.
- AC4. Each card has `accessibilityRole="link"`, an `accessibilityLabel` naming the body, and a touch target ≥ 44 px.
- AC5. The section renders only for slug `medical`; other categories are unchanged. The community `DonationLinksList` remains below it.
- AC6. No network or storage side-effects.

**Related.** `FR-DONATE-006`, `FR-DONATE-007`.

---

| Version | Date | Summary |
| ------- | ---- | ------- |
| 0.1 | 2026-05-09 | Initial draft. Reintroduces Donations tab into MVP per `D-16`. Defines `FR-DONATE-001..005`. |
| 0.4 | 2026-05-12 | `FR-DONATE-007 AC6` — list rows are always a non-virtualized block; host screens use outer `ScrollView`. `FR-DONATE-008/009` — super-admin may **edit** any donation link via Edge Function + overflow menu. |
| 0.5 | 2026-05-12 | `FR-DONATE-009 AC4` — super-admin **remove** in row menu (native + web); matches existing `donation_links_delete_own_or_admin` RLS. |
| 0.6 | 2026-05-12 | `FR-DONATE-009 AC4–AC5` — remove path uses hard `DELETE` (not soft-hide); migration purges historical soft-hidden rows. |
| 0.7 | 2026-05-12 | Status banner + `FR-DONATE-008 AC3c` (client edit vs add contract); `FR-DONATE-007 AC1` + `FR-DONATE-009` description clarify DELETE vs Edge update; Hebrew summary in status. |
| 0.8 | 2026-05-12 | `FR-DONATE-007 AC7` — silent server refetch after add/edit/remove so the list re-renders without manual reload. |
| 0.9 | 2026-05-18 | Adds `FR-DONATE-010` — platform-support card (Bit + Paybox) embedded on About + Settings. |
| 0.10 | 2026-10-30 | Adds `FR-DONATE-011` — curated medical / life-saving bodies directory on the `medical` category screen. |
| 1.0 | 2026-10-30 | Adds `FR-DONATE-011` — direct support for KC (one-time + monthly standing order, legal notice, server-configured channels). `FR-DONATE-003` rewritten to the current Money hub; jgive CTA + community links restored; sandbox org flow behind `money_in_app_org_payments`. |
| 1.1 | 2026-10-30 | `D64` — Bit / PayBox are withdrawn once a one-time clearing page exists; no compiled payment URLs or offline fallback; `FR-DONATE-010` card now wraps the `FR-DONATE-011` card (same channels + legal notice). |
| 1.2 | 2026-11-01 | `FR-DONATE-001` AC6 — the "donations marketplace" hub card and browse screen are removed; `/donations/marketplace` redirects to the hub, listing pages / map / my listings stay. |
| 1.3 | 2026-11-03 | `FR-DONATE-011` AC5 recipient = founder's personal account; AC9 payee phone for Bit / PayBox, signed-in only (migration `0550`) — D121. |
