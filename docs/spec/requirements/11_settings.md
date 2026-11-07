# 2.11 Settings

> **Status:** ✅ Core Complete — Settings layout, privacy, legal, about, logout shipped. FR-SETTINGS-006 (Notifications toggles) shipped in P1.5 PR-1. ⚠️ Audit 2026-05-16: 🔴 **FR-SETTINGS-010** Terms/Privacy are static inline strings, not in-app web views with remote-config URLs + AC3 re-acknowledge (TD-80, BACKLOG P2.18 — EU/IL privacy gap). 🟠 FR-SETTINGS-002 Account section unbuilt; FR-SETTINGS-011 AC1 logout has no confirmation modal; FR-SETTINGS-012 AC1 delete-account modal uses keyword instead of display_name. (✅ 2026-06-09: the un-owned About `support@karma.community` mailto was removed — single operated mailbox `karmacommunity2.0@gmail.com`, `D-59`.) TD-99. See `docs/SSOT/archive/audit/2026-05-16/06_donations_stats_settings.md`. 🟡 **FR-SETTINGS-015..017** (Surveys & feedback hub, server-driven survey runner, free feedback form) — code complete, post-merge QA pending (BACKLOG P2.34); individual FR statuses remain ⏳ Planned until manual QA on dev confirms ACs. ✅ 2026-07-05: **FR-SETTINGS-018** (App language — Hebrew/English UI switch) shipped — opt-in English, machine-translated (TD-176), direction-aware layout (✅ 2026-11-07 residual hardcoded RTL removed, AC6, #1749; native prod reload TD-178).



Prefix: `FR-SETTINGS-*`

---

## Scope

The Settings screen and its sub-pages:

- Account info (read-only in MVP except where noted).
- Notification preferences (`Critical` / `Social` toggles).
- Privacy controls (profile mode, follow requests entry; blocked-users entry deferred per `EXEC-9`).
- Stats shortcut.
- Support & legal.
- Logout.
- Account deletion.
- **About (in-app):** long-form narrative (vision beyond MVP, roadmap, FAQ, team, Instagram embed) with section navigation; marketing alias route `/about-site` and optional `hideTopBar` / `hideBottomBar` query flags for embedded web shells.
  - **AC (About refresh, 2026-05-16):** Problems / Features / Goals share a synchronized MVP↔Vision scope toggle (default MVP on each screen visit; not persisted). Vision uses a short lead plus a single expandable block for deeper KPI-style prose. Roadmap phases show a summary with independently expandable per-phase details. Mission and Team are one scroll target (dual section anchors). Values copy reflects product transparency plus optional user anonymity (no “privacy by default” product framing). Contact lists WhatsApp (community + personal), two mailto links, in-app report CTA, and an explicit out-of-app Bit/PayBox note with the published phone number. Instagram on web uses no embedded browser module—static card + external open only.

---

## FR-SETTINGS-001 — Settings screen layout

**Description.**
A single screen of grouped rows. Tapping a group either toggles inline or navigates deeper.

**Source.**
- PRD: `03_Core_Features.md` §3.5, `05_Screen_UI_Mapping.md` §5.1.

**Acceptance Criteria.**
- AC1. Sections (in this order): Account, Notifications, Privacy, My Stats, Support, Legal, Logout, Delete Account.
- AC2. Section headers are localized; their order does not change on tap or scroll.
- AC3. Destructive actions (Logout, Delete Account) are visually subdued unless tapped.

**Related.** Screens: 5.1.

---

## FR-SETTINGS-002 — Account section

**Description.**
Read-only display of identity fields plus a "Change password" affordance for email-method users.

**Source.**
- PRD: `03_Core_Features.md` §3.5.

**Acceptance Criteria.**
- AC1. Shown: `display_name` (read-only here, edited via `FR-PROFILE-007`), the masked phone or email (read-only), the auth method label.
- AC2. "Change password" is shown only when `auth_method = email` and routes to a dedicated screen requiring the current password.
- AC3. SSO users see a small note: "Your sign-in is managed by Google" (or Apple) with a link to those services.

**Related.** Domain: `User`, `AuthMethod`.

---

## FR-SETTINGS-003 — Privacy section: profile mode toggle

**Description.**
The privacy mode toggle (`Public` ↔ `Private`) lives here, not in Edit Profile.

**Source.**
- PRD: `03_Core_Features.md` §3.2.5, §3.5, `05_Screen_UI_Mapping.md` §5.1.

**Acceptance Criteria.**
- AC1. The control is a single switch labeled "Private profile" (off by default = `Public`).
- AC2. Toggling triggers `FR-PROFILE-005` or `FR-PROFILE-006` accordingly.
- AC3. The current mode is reflected immediately on the user's profile screens.

**Related.** Screens: 5.1.

---

## FR-SETTINGS-004 — Privacy section: follow-requests entry

**Description.**
A row entry leading to the Follow Requests screen, visible only when the profile is `Private`.

**Source.**
- PRD: `03_Core_Features.md` §3.5, `05_Screen_UI_Mapping.md` §5.4.

**Acceptance Criteria.**
- AC1. Row label: "Follow requests (X)" with X being the current pending count.
- AC2. Tapping navigates to `FR-FOLLOW-007` (screen 5.4).
- AC3. The row is hidden when `User.privacy_mode = Public`.
- AC4. The My Profile card `⋮` overflow omits the same entry when `User.privacy_mode = Public` (parity with the Settings list).

**Related.** Screens: 5.4.

---

## FR-SETTINGS-005 — Privacy section: blocked users entry — **DEPRECATED (post-MVP)**

**Status.** ⚠️ Out of MVP scope per `EXEC-9` (2026-05-11). No row is rendered in Settings → Privacy because `FR-MOD-004` (Unblock a user) is deferred post-MVP.

**Description.**
A row entry leading to the Blocked Users screen.

**Source.**
- PRD: `03_Core_Features.md` §3.5, `05_Screen_UI_Mapping.md` §5.3.

**Acceptance Criteria.**
- AC1. Row label: "Blocked users".
- AC2. Tapping navigates to a list (`FR-MOD-004` — deferred).
- AC3. The row is always shown regardless of privacy mode.

**Related.** Screens: 5.3.

---

## FR-SETTINGS-006 — Notifications section

**Description.**
Two toggles for Critical and Social notifications.

**Source.**
- PRD: `03_Core_Features.md` §3.5.
- Decisions: `D-5`.

**Acceptance Criteria.**
- AC1. Toggles: `Critical` (on by default) and `Social` (on by default).
- AC2. Tapping a toggle calls `FR-NOTIF-014` and persists preferences.
- AC3. A short caption beneath each toggle explains what is included (per the lists in [`09_notifications.md`](./09_notifications.md)).

**Related.** Screens: 5.1.

---

## FR-SETTINGS-007 — My stats shortcut

**Description.**
A row that opens the personal stats screen.

**Source.**
- PRD: `03_Core_Features.md` §3.5.

**Acceptance Criteria.**
- AC1. Label: "My stats".
- AC2. Tapping navigates to `FR-STATS-001`.

**Related.** Screens: 5.2.

---

## FR-SETTINGS-008 — Support: report an issue

**Description.**
The Settings entry into the Super Admin support thread.

**Source.**
- PRD: `03_Core_Features.md` §3.5, `04_User_Flows.md` Flow 9.B.
- Constraints: `R-MVP-Privacy-4a`.

**Acceptance Criteria.**
- AC1. Label: "Report an issue".
- AC2. Tapping opens the Report Issue modal (`FR-MOD-002`).
- AC3. After modal submission, the user lands on the conversation screen (`FR-CHAT-007`).

**Related.** Screens: 5.1, 6.1b.

---

## FR-SETTINGS-009 — Support: backup contact email

**Description.**
A non-actionable line offering an out-of-app contact for emergencies.

**Source.**
- PRD: `03_Core_Features.md` §3.5.

**Acceptance Criteria.**
- AC1. Displays a `mailto:karmacommunity2.0@gmail.com` link as a fallback (the `support@karma.community` domain is not owned/operated — see `DECISIONS.md` D-59).
- AC2. The link opens the user's default mail composer with no subject.

---

## FR-SETTINGS-010 — Legal section

**Status.** ✅ Implemented (P2.18, migration `0108_legal_documents_and_consent.sql`).

**Description.**
Two settings rows ("תנאי שימוש", "מדיניות פרטיות") open dedicated screens that render server-driven Markdown content natively (no WebView). Document content is editable from Supabase Studio via the `publish_legal_document` RPC; no app deploy required. Material changes trigger a re-acknowledgement flow per `docs/SSOT/archive/superpowers/specs/2026-05-24-server-driven-legal-documents-design.md`.

**Source.**
- PRD: `03_Core_Features.md` §3.5.
- Design: `docs/SSOT/archive/superpowers/specs/2026-05-24-server-driven-legal-documents-design.md`.

**Acceptance Criteria.**
- AC1. Two settings rows ("תנאי שימוש", "מדיניות פרטיות") open dedicated screens rendering server-driven Markdown content natively (no WebView). RTL-correct on iOS, Android, and web.
- AC2. Document content is editable via the `publish_legal_document` RPC. No remote-config URL configuration is involved.
- AC3. Re-acknowledgement is required when a published version has `severity ∈ ('standard','critical')`. `critical` blocks on next foreground; `standard` shows a 7-day soft banner that escalates to blocking on day 7. The banner→modal promotion is computed server-side (`needs_legal_reacknowledgement` SQL function) from the database clock, not the client.
- AC4. Post-OAuth consent screen presents both documents as cards; the user must check both before proceeding. Skipping is only possible via sign-out (with confirmation).
- AC5. Documents support `effective_date` in the future; until the date arrives, the document is visible in Settings with a "ייכנס לתוקף ב-DATE" banner but does not trigger the gate.
- AC6. Network failure during the gate check falls open (allows the user through) and logs the bypass via `console.warn`. Next online foreground re-checks. (A future server-side `legal_events` log will replace `console.warn`.)

---

## FR-SETTINGS-011 — Logout

**Description.**
Triggers `FR-AUTH-017`.

**Acceptance Criteria.**
- AC1. Single tap with a confirmation modal: *"Sign out of Karma Community?"*.
- AC2. On confirm, the device is signed out and routed to Splash.

---

## FR-SETTINGS-012 — Delete account

**Description.**
The user deletes their own account: it is deactivated for 30 days, restorable, then purged.

**Source.**
- PRD: `03_Core_Features.md` §3.5.
- Constraints: `R-MVP-Privacy-6`.
- Decisions: `D-12`, `D-14`.

**Acceptance Criteria.**
- AC1. The action requires a two-step confirmation: a warning modal listing consequences (including that the account is kept for 30 days and can be restored by signing in), followed by typing the user's display name to confirm.
- AC2. On confirm the account is **deactivated**, not deleted (`D108`): `account_status` becomes `pending_deletion` and a purge date 30 days ahead is stored. Immediately:
   - The profile, posts, listings and chats of the user disappear for everyone else (feeds, search, map, profile, chat lists); counterparts see the "Deleted user" placeholder per `D-14`.
   - All push tokens are unregistered. The device that deleted the account signs out; another signed-in device is sent to the restore screen on its next account check (within a minute).
   - Nothing is deleted yet: posts, media, follows, blocks and chats stay as they were so a restore is complete.
- AC3. **Restore:** signing in within the 30 days shows the restore screen (`FR-AUTH-016` AC2); restoring returns the account to `active` with everything visible again. The screen (`/restore-account`) shows the purge date with two actions, restore or sign out; an account whose period has ended is shown that it was deleted.
- AC4. **Purge:** a daily job finds accounts whose purge date has passed and deletes them for good: all `Post`s with their image assets, every Storage object under `<user_id>/…` (`purgeUserFolders`, #1065), follow edges, requests, blocks, reports, and finally the auth identity. Chats and messages are kept on the counterpart side per `D-14`. A failing bucket is reported and the others still run.
- AC5. Audit events are recorded for the deactivation, a restore and the purge.

**Related.** Domain: `User`, `Post`, `Chat`, `FollowEdge`, `DeletedIdentifier`.

---

## FR-SETTINGS-014 — Appearance (light / dark / system)

**Status.** ✅ Complete (2026-05-22). Infrastructure, toggle screen, and full mobile screen/container migration shipped.

**Description.**
A user-facing toggle, in Settings → Appearance, that switches the app between three theme modes: `System` (follows the OS), `Light`, and `Dark`. Dark mode uses a warm-tinted palette (deep warm browns instead of pure black) so the community/karma identity carries through.

**Source.**
- New (2026-05-19) — added on user request; no PRD precedent.

**Acceptance Criteria.**
- AC1. Settings list shows an `Appearance` row above `Notifications`. Tapping opens the Appearance sub-screen.
- AC2. The sub-screen exposes three options: `Automatic` (system), `Light`, `Dark`. Exactly one is selected at a time; the selected option is visually distinct (filled icon bubble + filled radio + tinted row background).
- AC3. The choice is persisted per device in AsyncStorage (`kc-theme-mode`) and survives sign-out.
- AC4. `Automatic` resolves at runtime against `useColorScheme()` and re-resolves when the OS scheme changes.
- AC5. The sub-screen renders a live side-by-side preview card showing the Light and Dark palettes (background / surface / text / brand chips) so the user can compare before choosing.
- AC6. The native StatusBar style flips with the scheme (`light-content` on dark, `dark-content` on light); on web, the html/body background flips so iOS rubber-band overscroll does not flash the opposite color.
- AC7. Dark palette preserves brand identity: orange primary stays dominant (slightly lifted for AA contrast on dark surfaces); neutral surfaces are warm-tinted (`#15110D` background, `#1F1A14` surface) rather than pure slate/black.

**Related.** Domain: none. Files: `packages/ui/src/theme/colors.ts`, `packages/ui/src/theme/ThemeContext.tsx`, `apps/mobile/src/store/themeStore.ts`, `apps/mobile/src/components/AppThemeProvider.tsx`, `apps/mobile/app/settings/appearance.tsx`.

---

## FR-SETTINGS-013 — Read-only contact change

**Description.**
The MVP does not allow self-service phone/email changes; the Settings screen explains how to request a change.

**Source.**
- PRD: `03_Core_Features.md` §3.2.5.

**Acceptance Criteria.**
- AC1. Tapping the masked phone/email row reveals a friendly modal: *"Need to change your phone or email? Please contact Support."*
- AC2. The modal contains a CTA that opens the Report Issue flow (`FR-MOD-002`) pre-categorized as `Account`.

---

## FR-SETTINGS-015 — Surveys & feedback hub

**Status.** ⏳ Planned

**Description.** Settings section "סקרים וחוות דעת" listing active server-driven surveys and a free-feedback entry.

**Acceptance Criteria.**
- AC1. Section appears between My Stats and Support (adjust FR-SETTINGS-001 order note).
- AC2. Each active survey row shows title, status chip (not started / in progress / completed for current version), navigates to FR-SETTINGS-016.
- AC3. Row "חוות דעת חופשית" navigates to FR-SETTINGS-017 (not FR-MOD-002).
- AC4. List data comes from server (`list_active_surveys`); empty state copy when no surveys active.

---

## FR-SETTINGS-016 — Server-driven survey runner

**Status.** ⏳ Planned

**Acceptance Criteria.**
- AC1. One question visible; compact top map: number + short label (≤2 words) + completion dot; non-linear jump.
- AC2. Each question: required rating 1–7 + optional text (max 500 chars); per-question anchor labels (low/high) loaded from server; Hebrew RTL placeholders.
- AC3. Floating prev/next controls above tab bar; never hidden behind shell chrome.
- AC4. Answers upserted per `(user_id, survey_id, version, question_id)`; user may edit while current version unchanged.
- AC5. New published version resets completion for that survey; banner may reappear per FR-SETTINGS-016 AC6.
- AC6. Prompt banner when milestones met and survey incomplete: CTA + "אחר כך" snoozes 7 days (AsyncStorage key `kc-survey-snooze-{slug}`).
- AC7. Question copy editable in Supabase without app deploy (`publish_survey_version` RPC).
- AC8. In-progress answers persist across reloads. Every answer change is mirrored to `localStorage` (key `kc-survey-draft-{slug}`, version-tagged) in addition to the debounced server upsert (AC4); on remount the local draft is overlaid over the server snapshot, so a refresh mid-survey never reverts to the last saved answers — including text typed before a rating or choice is set, which the server cannot store (an answer row needs a rating or a choice key). The draft is ignored on version change or after a 14-day TTL. Shared `surveyDraftStorage` helper with the public research form (FR-RESEARCH-001 AC7).
- AC9. *(KC#1058, 2026-10-30)* A question may be **single choice** (`single_choice_with_optional_text`): the user picks exactly one of the question's `choice_options` (2–6, published with the version) instead of a rating, plus the same optional text. An answer row holds a rating **or** a choice key, never both; the server rejects a key that is not an option (migrations `0455`–`0456`).
- AC10. *(KC#1058)* **Sean Ellis PMF survey** (`pmf-sean-ellis`, seeded in `0457`): the standard question "How would you feel if you could no longer use Karma Community?" with exactly 3 options — very disappointed / somewhat disappointed / not disappointed (it isn't really useful) — and an optional "main benefit" text. The prompt rule `min_active_days_14d: 2` shows it only to users who opened the app while signed in on ≥ 2 distinct Israel days in the last 14 (server-side `user_active_days`, recorded once per day on app open and foreground via `rpc_record_active_day`). The banner offers it before `ux-experience`; each survey has its own 7-day snooze.

---

## FR-SETTINGS-017 — Free feedback form

**Status.** ⏳ Planned

**Acceptance Criteria.**
- AC1. Optional 1–7 rating + required text (min 10 chars, max 500).
- AC2. Submits to `user_feedback` table; success toast; no chat thread.
- AC3. Does not replace FR-SETTINGS-008.

---

## FR-SETTINGS-018 — App language (Hebrew / English)

**Status.** ✅ Done (2026-07-05). English bundle is machine-translated pending human polish (`TD-176`).

**Description.**
A Settings row opening a language picker that switches the app UI locale between Hebrew (default) and English. Distinct from `FR-TRANSLATE-003` (target language for auto-translated user *content*); this controls the *interface* strings and reading direction.

**Source.**
- PM request 2026-07-05 (urgent). Delivers the UI-locale-switch slice of `D-24` (bilingual MVP `he`+`en`).
- Decisions: `D-167`.

**Acceptance Criteria.**
- AC1. Settings shows an "App language" row (icon `globe-outline`), above "Translation language", opening `/settings/language`.
- AC2. The picker lists Hebrew ("עברית") and English ("English"), each labelled in its own script, with the active language selected.
- AC3. Selecting a language persists the choice locally (web `localStorage`, native `AsyncStorage`), switches the react-i18next locale, sets the reading direction (Hebrew = RTL, English = LTR), and reloads the app to apply it.
- AC4. Hebrew is the default for first-time / anonymous users; English is opt-in. `fallbackLng` is Hebrew, so any not-yet-translated key renders its Hebrew source rather than a raw key.
- AC5. The choice is device-local (no account/DB dependency), so it works for signed-out web visitors at `/settings`.
- AC6. Translated interface text follows the active reading direction. Content that exists only in Hebrew (legal document bodies and their change summaries until multi-language legal documents ship, #1733; server-authored survey copy) stays RTL and aligned to the visual right in both languages. No app source hardcodes `writingDirection: 'rtl'` outside the direction helpers (`apps/mobile/src/lib/{rtlLayout,hebrewContentDirection}.ts`); a source-scan test enforces it. On web the HTML template applies the stored language's direction before the app bundle runs, so styles resolved at module load already see it (#1749).
- AC7. Signed-out visitors can switch language before signing in: the welcome screen and the auth form screens show a compact pill labelled with the other language in its own script ("English" / "עברית"), which runs the AC3 flow (#1939).

**Related.** `apps/mobile/src/i18n/language.ts`, `apps/mobile/app/settings/language.tsx`, `apps/mobile/src/i18n/locales/en/**`, direction-aware helpers in `apps/mobile/src/lib/{rtlLayout,rtlTextAlignStart,webRtlStyle,hebrewContentDirection}.ts`.

**Known gaps.** Machine-translated copy pending human polish (`TD-176`); native production reload needs `expo-updates` (`TD-178`).

---

| Version | Date | Summary |
| ------- | ---- | ------- |
| 0.1 | 2026-05-05 | Initial draft from PRD §3.5 and Decisions D-5, D-12, D-14. |
| 0.2 | 2026-05-19 | Added FR-SETTINGS-014 (Appearance — light / dark / system) per PM request. |
| 0.3 | 2026-05-26 | Added FR-SETTINGS-015..017 (Surveys & feedback hub, server-driven survey runner, free feedback form). Updated status header with ⏳ note. |
| 0.4 | 2026-07-05 | Added FR-SETTINGS-018 (App language — opt-in Hebrew/English UI switch; machine-translated English). |
| 0.5 | 2026-10-30 | FR-SETTINGS-016 AC9–AC10 (KC#1058): single-choice questions and the Sean Ellis PMF survey gated by server-side active days (`0455`–`0457`). |
| 0.6 | 2026-11-07 | FR-SETTINGS-018 AC6 (KC#1749): interface text follows the reading direction; Hebrew-only content stays RTL; hardcoded RTL guarded by a test. |
| 0.7 | 2026-11-07 | FR-SETTINGS-018 AC7 (KC#1939): language switch on the sign-in screens. |
