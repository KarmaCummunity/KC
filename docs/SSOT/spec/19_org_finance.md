# 2.19 Organization Finance & Transparency

> **Status:** ⏳ Planned — spec v0.1 (2026-10-30, PM-approved scope). No `FR-FIN-*` code shipped yet. **Phase 1** `FR-FIN-001..011` (org-scoped ledger, roles, accounts, categories, attachments, Section 46(a) tracking, receipt tracking, payment mirroring, exports, portal sub-tree). **Phase 2** `FR-FIN-012..017` (CSV import, bank reconciliation, reports, budgets, smart alerts, overview dashboard). **Phase 3** `FR-FIN-018..021` (documents vault, transparency snapshots, public transparency section, donor-side receipt view). Supersedes the minimal `V2-ADMIN-MONEY-9` ledger at `/admin/money` (migration `0170_finance_ledger.sql`), which is the migration baseline for Phase 1.

Prefix: `FR-FIN-*` · Migration range claimed: `0470–0489` (see `docs/agents/MIGRATION_RANGES.md`) · Product decisions: `D76–D82` + fills `S48`/`S49` in `docs/spec/90_decisions_log.md` / `91_kc_fills_pending.md` · Engineering decision: `D-196` in `docs/SSOT/DECISIONS.md`.

---

## Scope

A **per-organization finance sub-tree inside the Admin Portal** that lets an organization's treasurer keep the books of the organization (income, expenses, accounts, categories, budgets), track **Section 46(a)** status and donation receipts, mirror the donations that already flow through the in-app payment stack, import bank/Bit/Paybox statements, reconcile them, produce the reports the organization's external accountant and the Registrar of Associations (רשם העמותות) need, and (Phase 3) publish a curated **transparency** view on the organization's public profile.

Karma Community itself is the **platform organization** (`organizations.is_platform = true`) and keeps its books in the same tool. Every other verified nonprofit gets the same sub-tree scoped to its own `org_id`.

### What already exists (baseline, do not re-build)

| Asset | Where | Reuse in this spec |
| ----- | ----- | ------------------ |
| Minimal ledger (`finance_ledger_entries`, `finance_ledger_list/create/update/delete` RPCs, `money.manage` permission, `/admin/money` screen) | migration `0170`, `(admin)/money/index.tsx`, `components/admin/money/*` | Extended in place (FR-FIN-001). Screen moves under `/admin/finance/ledger`; `/admin/money` redirects. |
| Payment stack: `donation_intents`, `payments`, `standing_orders`, `payment_refunds`, `payment_payouts`, `payment_ledger_entries`, `donation_receipts` (`section46_serial`) | migrations `0267–0270` | Read-only source for FR-FIN-009 mirroring and FR-FIN-008 receipts. Never written by finance code. |
| `organizations` (`is_verified_nonprofit`, `verified_at`, `public_tagline_*`, `public_about_*`) | migrations `0203`, `0264`, `0360` | Extended with Section 46(a) + finance settings columns (FR-FIN-007). |
| Org-scoped RBAC (`admin_role_grants.scope_org_id`, `can_grant_role`, `has_admin_role(uid, role, scope)`) | migrations `0143`, `0173`, `0203`, `0264` | Two new org-scoped roles (FR-FIN-002). |
| `org_applications` + `(admin)/org-approvals` | migration `0168` | Unchanged. Approval creates the org that finance scopes to. |
| Public nonprofit page `/(tabs)/donations/money/nonprofit/[slug]` | money world (`0360–0369`) | Hosts the Phase 3 transparency section until the general organization profile (`spec/20_organizations.md`, future) exists. |

### Glossary

- **Section 46(a)** — §46(a) of the Israeli Income Tax Ordinance. Donations to a "public institution" approved under this section entitle the donor to a tax credit. The approval is granted by the Tax Authority, is time-limited, and must be renewed. Only the approved organization may issue receipts that carry the statutory 46(a) notice. The platform **records** this status; it never decides eligibility itself.
- **Proper-management certificate (אישור ניהול תקין)** — annual certificate from the Registrar of Associations. Tracked as an organization document (FR-FIN-018) with an expiry reminder.
- **Fiscal year** — calendar year (Israeli amutot default). Stored per entry as `fiscal_year int` derived from `occurred_at`.
- **Agorot / minor units** — all amounts are `bigint` in agorot. The UI formats with `Intl.NumberFormat('he-IL')`. Existing `payments.amount_ils numeric(12,2)` is converted at mirroring time (`round(amount_ils * 100)`).
- **Reconciled** — an entry matched to a bank/provider statement line. Reconciled entries are frozen (FR-FIN-013).

### Non-goals (explicit, PM 2026-10-30)

- Double-entry bookkeeping, chart of accounts, trial balance. The ledger stays **single-entry** (D78).
- Generating official receipts or invoices. Receipt documents come from the organization's accounting software / payment provider and are **attached**, not produced (D77).
- Payroll, VAT reporting, tax filings, National Insurance.
- Direct integration with a specific accounting package (Hashavshevet, Rivhit, iCount, Green Invoice). Deferred to `TD-207`; Phase 1 ships a universal CSV/XLSX export instead (S48).
- Multi-currency. `currency` stays in the schema (`0170`) but every write is `'ILS'` and the UI never offers a currency picker (D78).
- Valuing in-kind donations (items, time, rides) in money. They stay in their own worlds and never enter the books (D78).
- Public exposure of donor identities. Never, under any setting (`FR-FIN-019 AC6`).

---

## Product decisions recorded for this spec

| # | Question (2026-10-30) | Decision | Log |
| - | --------------------- | -------- | --- |
| 1 | Whose finances? | Multi-tenant from day one: every finance row carries `org_id`; Karma Community is the platform org. | D76 |
| 2 | Who accesses? | New org-scoped roles `org_treasurer` (read/write) and `org_accountant` (read + export only). `org_admin` inherits treasurer rights for its org. `moderator` loses finance write access. | D76 |
| 3 | Section 46(a) depth | Record the organization's approval (number, validity, certificate, expiry reminders) and track receipts per donation (number, date, 46(a)-eligible flag, file). No receipt generation. | D77 |
| 4 | Does KC hold a 46(a) approval? | **Not today.** The platform org starts with `sec46_status = 'none'`; no public 46(a) claim is rendered anywhere for KC until the status is `active`. | D77 |
| 5 | Accounting depth | Single-entry ledger upgraded with financial accounts, category tree, fiscal year, budget vs. actual, reconciliation. | D78 |
| 6 | Data sources | Manual entry + CSV import (bank, Bit, Paybox, generic) + automatic mirroring of in-app payments. | D79 |
| 7 | Accountant deliverable | PM has no preference → universal CSV + XLSX export of the ledger with attachments index, plus PDF period summary. Software-specific formats deferred (`TD-207`). | S48 |
| 8 | Must-have reports | PM has no preference → income vs. expense (monthly / annual), by category, by project tag, donors summary, annual summary for the Registrar. | S49 |
| 9 | "Smart tracking" | Reminders and queues (missing receipt, unreconciled, failed standing order, 46(a) / proper-management expiry, annual report deadline, budget overrun) + counterparty-based auto-categorization. | D80 |
| 10 | Transparency | Fully optional per organization; organization publishes a frozen yearly **snapshot**, never live books; donor names never public. | D81 |
| 11 | Where does the organization profile live? | Organization profile is its own future domain (`spec/20_organizations.md`): an extended profile with its own email identity, posts, followers, and an Admin Portal whose **finance sub-tree is this spec**. This spec only defines the finance/transparency contract that profile consumes (§ Dependencies). | D82 |
| 12 | Phasing | Three phases as in the status header. Each phase is its own PR train to `dev`. | D-196 |

---

## Roles & permissions

### New org-scoped roles (`admin_role_grants.role`)

| Role | Scope | Intent |
| ---- | ----- | ------ |
| `org_treasurer` | `scope_org_id` required | Keeps the books of one organization. Full finance write access for that org. |
| `org_accountant` | `scope_org_id` required | External accountant / auditor. Read + export only. Never writes. |

`can_grant_role` is widened so that `org_admin` (scope X) and `org_treasurer` (scope X) may grant `org_treasurer` / `org_accountant` within X; `super_admin` and `admin` may grant them for any org. Both roles are visible in the existing `(admin)/admins` list and tree with their own `RoleBadge` colour.

### Permissions (`@kc/domain` `ADMIN_PERMISSIONS`)

| Permission | `super_admin` | `admin` | `org_admin` (own org) | `org_treasurer` (own org) | `org_accountant` (own org) | `moderator` |
| ---------- | :-: | :-: | :-: | :-: | :-: | :-: |
| `finance.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (platform org only, read) |
| `finance.manage` (entries, receipts, attachments) | ✓ | ✓ | ✓ | ✓ | — | — |
| `finance.import` | ✓ | ✓ | ✓ | ✓ | — | — |
| `finance.reconcile` | ✓ | ✓ | ✓ | ✓ | — | — |
| `finance.export` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `finance.settings` (accounts, categories, budgets, 46(a), fiscal settings) | ✓ | ✓ | ✓ | ✓ | — | — |
| `finance.documents` (org documents vault write) | ✓ | ✓ | ✓ | ✓ | — | — |
| `transparency.manage` (publish / unpublish snapshots, toggles) | ✓ | ✓ | ✓ | — | — | — |

- `money.manage` is kept as a deprecated alias of `finance.manage` for one release and removed in Phase 2 (`TD-208`).
- Client-side `hasPermission()` is UX gating only. Every RPC calls `finance_assert(p_org_id uuid, p_permission text)`, a `SECURITY DEFINER` helper that resolves the caller's active grants (`has_admin_role` 3-arg overload) against the matrix above and raises `forbidden` (SQLSTATE `42501`) otherwise. Platform-wide roles resolve for any `org_id`; org-scoped roles only when `scope_org_id = p_org_id`.
- RLS on every finance table: `SELECT` allowed when `finance_can_view(org_id)`; `INSERT/UPDATE/DELETE` revoked from `anon, authenticated` (RPC-only writes, per `D-194` / ADR-002).

---

## Data model (summary)

All tables live in `public`, carry `org_id uuid not null references organizations(org_id) on delete restrict`, `created_at / updated_at / created_by`, RLS enabled, writes via `admin_finance_*` RPCs. Exact DDL lands with each phase inside the claimed range.

| Table | Phase | Key columns / rules |
| ----- | ----- | ------------------- |
| `finance_ledger_entries` (extend `0170`) | 1 | `+ org_id` (backfilled to the platform org), `+ account_id`, `+ category_id`, `+ fiscal_year int` (generated from `occurred_at`), `+ source text check in ('manual','import','payment_sync')`, `+ source_ref text` (e.g. `payment:<uuid>`, `import_row:<uuid>`; unique with `source` when not null), `+ project_tag text`, `+ donor_user_id uuid null`, `+ receipt_status text check in ('not_required','pending','issued')`, `+ receipt_number text`, `+ receipt_issued_at date`, `+ receipt_sec46_eligible boolean not null default false`, `+ reconciled_at timestamptz`, `+ reconciled_by uuid`, `+ voided_at timestamptz`, `+ void_reason text`. `kind` gains `'other_in'`, `'other_out'`. `(org_id, receipt_number)` unique where not null. |
| `finance_accounts` | 1 | `account_id`, `name` (1..80), `kind check in ('bank','cash','bit','paybox','payment_provider','other')`, `last4 text`, `opening_balance_cents bigint default 0`, `opening_balance_at date`, `is_active`, `sort_order`. Unique `(org_id, name)`. |
| `finance_categories` | 1 | `category_id`, `parent_id` (max depth 2), `name` (1..60), `direction check in ('in','out')`, `is_program boolean` (counts toward "program spend" in transparency ratio), `is_system boolean` (seeded defaults, rename-only), `sort_order`. Unique `(org_id, parent_id, name)`. |
| `finance_counterparty_rules` | 1 | `rule_id`, `pattern text` (case-insensitive substring, 2..120), `category_id`, `kind`, `hit_count int`. Evaluated longest-pattern-first. |
| `finance_attachments` | 1 | `attachment_id`, `entry_id` (cascade on void? no: attachments survive void), `storage_path` (bucket `finance-attachments`, private), `file_name`, `mime check in (pdf, jpeg, png, webp, csv, xlsx)`, `size_bytes ≤ 15 MB`, `kind check in ('receipt','invoice','bank_statement','contract','other')`, `share_with_donor boolean default false`. |
| `finance_imports` | 2 | `import_id`, `account_id`, `source check in ('csv_bank','csv_bit','csv_paybox','csv_generic')`, `storage_path`, `column_map jsonb`, `status check in ('uploaded','previewed','committed','failed')`, `row_count`, `created_count`, `matched_count`, `skipped_count`, `error text`. |
| `finance_import_rows` | 2 | `row_id`, `import_id`, `line_no`, `raw jsonb`, `occurred_at`, `amount_cents` (signed), `counterparty`, `fingerprint text` (`sha256(org_id|account_id|occurred_at::date|amount|counterparty)`, unique per org), `status check in ('pending','created','matched','ignored','duplicate')`, `entry_id`. |
| `finance_budgets` | 2 | `budget_id`, `fiscal_year int`, `category_id`, `amount_cents`. Unique `(org_id, fiscal_year, category_id)`. |
| `finance_alert_dismissals` | 2 | `(org_id, alert_key text, dismissed_by, dismissed_until date)`. Alerts themselves are computed, not stored. |
| `org_documents` | 3 (46(a) certificate kind used from Phase 1) | `document_id`, `kind check in ('sec46_certificate','proper_management_certificate','annual_financial_report','bylaws','registrar_extract','other')`, `title` (1..120), `storage_path` (bucket `org-documents`, private; public copies served via signed URL when `is_public`), `fiscal_year int null`, `valid_from date`, `valid_until date`, `is_public boolean default false`. |
| `org_transparency_snapshots` | 3 | `snapshot_id`, `fiscal_year`, `total_in_cents`, `total_out_cents`, `program_out_cents`, `overhead_out_cents`, `donations_count`, `recurring_donors_count`, `by_category jsonb` (category name → cents, no counterparties), `published_at`, `published_by`, `unpublished_at`. Unique active per `(org_id, fiscal_year)`. |
| `organizations` (extend) | 1 | `+ sec46_status text check in ('none','pending','active','expired','revoked') default 'none'`, `+ sec46_approval_number text`, `+ sec46_valid_from date`, `+ sec46_valid_until date`, `+ sec46_certificate_document_id uuid`, `+ fiscal_year_start_month smallint default 1` (read-only `1` in MVP), `+ transparency_settings jsonb default '{}'` (Phase 3: `show_totals`, `show_program_ratio`, `show_documents`, `show_sec46_badge`). |

Audit: every write RPC inserts an `audit_events` row with `action` in `finance_entry_create | finance_entry_update | finance_entry_void | finance_account_upsert | finance_category_upsert | finance_rule_upsert | finance_attachment_add | finance_attachment_remove | finance_receipt_set | finance_sec46_set | finance_import_commit | finance_reconcile | finance_budget_upsert | org_document_upsert | org_document_remove | transparency_publish | transparency_unpublish`, `target_type = 'organization'`, `target_id = org_id`, `metadata` with the row id and changed fields.

---

## Admin Portal — finance sub-tree

Route group `(admin)/finance/*`. Nav entry **"כספים"** (icon `wallet-outline`) replaces the current "money" entry; `/admin/money` → `router.replace('/admin/finance/ledger')`.

| Route | Screen | Phase | Gate |
| ----- | ------ | ----- | ---- |
| `/admin/finance` | Overview dashboard (KPIs + alerts) | 1 (tiles) / 2 (alerts) | `finance.view` |
| `/admin/finance/ledger` | Ledger list + entry form modal | 1 | `finance.view` / `finance.manage` |
| `/admin/finance/ledger/[entryId]` | Entry detail: fields, attachments, receipt, audit trail | 1 | `finance.view` |
| `/admin/finance/receipts` | Receipt queue (pending → issued) | 1 | `finance.manage` |
| `/admin/finance/accounts` | Financial accounts CRUD | 1 | `finance.settings` |
| `/admin/finance/categories` | Category tree + counterparty rules | 1 | `finance.settings` |
| `/admin/finance/sec46` | Section 46(a) status card + certificate | 1 | `finance.settings` |
| `/admin/finance/export` | Export wizard (period, format) | 1 | `finance.export` |
| `/admin/finance/imports` + `/imports/[importId]` | CSV import wizard + preview | 2 | `finance.import` |
| `/admin/finance/reconcile` | Unmatched statement rows ↔ entries | 2 | `finance.reconcile` |
| `/admin/finance/reports` + `/reports/[reportKey]` | Reports hub + one report | 2 | `finance.view` |
| `/admin/finance/budgets` | Budget vs. actual per fiscal year | 2 | `finance.settings` |
| `/admin/finance/documents` | Organization documents vault | 3 | `finance.documents` |
| `/admin/finance/transparency` | Snapshot builder + publish toggles + preview | 3 | `transparency.manage` |

Shared behaviour:
- **Org context.** `super_admin` / `admin` see the existing `OrgSwitcher` (from `FR-ADMIN-025`) in the header; scoped roles are pinned to their org. The selected `org_id` is part of every query key.
- Layout, tokens and responsiveness follow `spec/14_responsive_desktop.md` and `FR-ADMIN-022 AC5` (centered max-width column ≥ tablet, `makeUseStyles`, RTL helpers). Lists use `KcFlashList`; filters use `AdminFilterChip`.
- All strings in `apps/mobile/src/i18n/locales/he/modules/admin.json` under `admin.finance.*`. No inline Hebrew.
- Clean Architecture: `@kc/domain` (`FinanceEntry`, `FinanceAccount`, `FinanceCategory`, `FinanceReceipt`, `Sec46Status`, `FinanceAlert`, `TransparencySnapshot`, `FinanceError` with stable codes), `@kc/application` (`IFinanceRepository`, `IFinanceAttachmentStorage`, `IOrgDocumentsRepository`, `ITransparencyRepository`, one use case per operation), `@kc/infrastructure-supabase` adapters (`SupabaseFinanceRepository`, …) with pure `map*Row` functions and tests. Files ≤ 300 lines.

---

## Phase 1 — Books, Section 46(a), exports

## FR-FIN-001 — Org-scoped ledger (multi-tenant upgrade of `0170`)

**Description.** Every ledger entry belongs to exactly one organization. Existing rows are backfilled to the platform org. All list/read RPCs take `p_org_id`.

**Acceptance Criteria.**
- AC1. Migration adds `org_id` to `finance_ledger_entries`, backfills all existing rows with the platform org id (`organizations.is_platform = true`), then sets `NOT NULL` + FK. Zero rows are lost; `deleted_at` rows are preserved.
- AC2. `admin_finance_ledger_list(p_org_id, p_filters…)` replaces `finance_ledger_list`; it returns only rows of `p_org_id` and raises `forbidden` for callers without `finance.view` on that org. The legacy function is dropped in the same migration (no client calls it after this PR).
- AC3. Filters: direction, kind, status, account, category, fiscal year, date range, free text over `counterparty` / `description` / `receipt_number` (ILIKE), `receipt_status`, `reconciled` (yes/no), `source`. Server pagination 100 rows, `total_count` in every row (same pattern as `admin_search_users`).
- AC4. A `super_admin` switching org in the header sees that org's books only; query keys include `org_id` so no cross-org cache leak is possible.
- AC5. Unit tests: `mapFinanceEntryRow`, filter serialization, and an RLS persona test (treasurer of org A cannot read org B) in `tests/rls/`.

**Related.** D76, `D-196`. Baseline `0170_finance_ledger.sql`.

---

## FR-FIN-002 — Finance roles & permission matrix

**Acceptance Criteria.**
- AC1. `admin_role_grants.role` CHECK gains `org_treasurer`, `org_accountant` (both require non-null `scope_org_id`; `invalid_scope` otherwise, per `FR-ADMIN-016 AC2`).
- AC2. `can_grant_role` extended as in § Roles. `GrantRoleModal` lists both roles with the org picker; `RoleBadge` renders them (treasurer: `wallet-outline`, accountant: `calculator-outline`).
- AC3. `@kc/domain` `ADMIN_PERMISSIONS` gains the eight `finance.*` / `transparency.manage` permissions; `PERMISSION_MATRIX` matches the table in § Roles. `money.manage` remains and maps to `['super_admin','admin','org_admin','org_treasurer']` until `TD-208` removes it.
- AC4. SQL helpers `finance_can_view(p_org_id) returns boolean` and `finance_assert(p_org_id, p_permission) returns void` exist, are `SECURITY DEFINER`, `set search_path = public`, and are unit-tested in SQL (`supabase/tests/`) for: platform role on any org, scoped role on own org, scoped role on other org (forbidden), accountant write (forbidden).
- AC5. `moderator` keeps read access (`finance.view`) to the **platform org only** so the existing moderation team does not lose visibility; it cannot write. Documented in D76 / `D-196`.

---

## FR-FIN-003 — Financial accounts

**Description.** Where the money physically sits: bank account(s), cash box, Bit, Paybox, in-app payment provider.

**Acceptance Criteria.**
- AC1. `/admin/finance/accounts` lists active accounts with computed balance = `opening_balance_cents + Σ(in) − Σ(out)` over cleared, non-voided entries; inactive accounts in a collapsed section.
- AC2. Create/edit modal: name, kind, last 4 digits (optional, bank only), opening balance + date. Deactivate instead of delete when the account has entries (`account_has_entries` error on delete).
- AC3. Every org gets a seeded default account **"מזומן"** (`kind='cash'`) on first finance access (idempotent RPC `admin_finance_bootstrap(p_org_id)`), so the entry form is never blocked on setup. The platform org additionally gets **"Bit"** and **"Paybox"** (existing support-card destinations) and **"ספק סליקה"** (`payment_provider`) used by FR-FIN-009.
- AC4. Ledger entries require `account_id`; the form defaults to the most recently used account.

---

## FR-FIN-004 — Category tree + auto-categorization rules

**Acceptance Criteria.**
- AC1. Two-level tree per direction. Seeded system categories (rename-only) per org: **in** — תרומות מיחידים, תרומות מתאגידים, הוראות קבע, מענקים, הכנסות אחרות; **out** — פעילות ותוכניות (`is_program=true`), שכר ונלוות, שכירות ותפעול, שיווק וגיוס משאבים, הנהלה וכלליות, עמלות סליקה ובנק, החזרים לתורמים, אחר.
- AC2. Custom categories: add / rename / reorder / move under a parent / archive (archive blocked while entries reference it → `category_in_use`; user is offered "move entries to…").
- AC3. Counterparty rules: `pattern → category (+ kind)`. On entry create (manual or import), when `category_id` is empty the longest matching pattern pre-fills category and kind; the user can override. Rules are managed inline on the categories screen and auto-suggested: after the user manually categorizes the same counterparty 3 times, a one-tap "צור חוק" chip appears.
- AC4. `is_program` flag is editable on custom **out** categories and feeds the transparency ratio (FR-FIN-019).

---

## FR-FIN-005 — Ledger entry lifecycle (create / edit / void)

**Acceptance Criteria.**
- AC1. Form fields: direction, kind, amount (₪, two decimals, stored agorot), occurred date (default today, not in the future by more than 1 day), account, category, counterparty (≤200), description (≤2000), project tag (≤40, autocomplete from existing tags of the org), status (`pending` / `cleared`), receipt section (FR-FIN-008), attachments (FR-FIN-006), donor link (optional user picker, `donor_user_id`; only for `direction='in'`).
- AC2. **Void replaces delete.** `admin_finance_entry_void(p_entry_id, p_reason)` sets `voided_at` / `void_reason`; voided rows stay listed under a filter, excluded from every total. The `0170` soft `deleted_at` path is removed. Reason is required (≥ 3 chars).
- AC3. Edits of a **reconciled** entry are rejected with `entry_reconciled` unless the caller first un-reconciles (FR-FIN-013). Edits of a `payment_sync` entry may change only category, project tag, description, receipt fields and attachments; amount / date / account / counterparty are locked (`entry_locked_by_source`).
- AC4. Entry detail screen shows an **audit trail** (filtered `admin_audit_search` on `target_id = org_id` + `metadata.entry_id`), attachments gallery, receipt card, and "duplicate entry" action.
- AC5. Error codes mapped to Hebrew: `forbidden`, `invalid_amount`, `invalid_date`, `account_inactive`, `category_direction_mismatch`, `entry_reconciled`, `entry_locked_by_source`, `entry_voided`, `receipt_number_taken`, `unknown`.

---

## FR-FIN-006 — Attachments

**Acceptance Criteria.**
- AC1. Private bucket `finance-attachments`; object path `{org_id}/{entry_id}/{attachment_id}.{ext}`. `storage.objects` policies: read when `finance_can_view(org_id from path)`; insert/delete only via the `admin_finance_attachment_add/remove` RPC flow (client uploads to a signed upload URL issued by the RPC, then confirms).
- AC2. Allowed types: PDF, JPEG, PNG, WebP, CSV, XLSX; ≤ 15 MB; ≤ 10 attachments per entry. Images get a thumbnail via the existing `-thumb` convention (PERF-4) for the gallery.
- AC3. Attachments are never hard-deleted while the entry exists; "remove" marks `removed_at` and hides them. Retention floor 7 years (Israeli bookkeeping retention) is a documented operator rule in `OPERATOR_RUNBOOK.md`; no automatic purge.
- AC4. Mobile: camera / photo library / file picker; Web: file picker + drag-and-drop on the entry detail screen.
- AC5. `share_with_donor` (receipt kind only) makes the file downloadable from the donor's own donation history (FR-FIN-021).

---

## FR-FIN-007 — Section 46(a) status per organization

**Acceptance Criteria.**
- AC1. `/admin/finance/sec46` shows a status card: status chip (`none` / `pending` / `active` / `expired` / `revoked`), approval number, validity dates, certificate document (upload / replace / view), last updated by.
- AC2. `admin_finance_sec46_set(p_org_id, p_status, p_approval_number, p_valid_from, p_valid_until, p_document_id)` validates: `active` requires number + both dates + document; `valid_until ≥ valid_from`; `pending` / `none` clear the dates. Writes `organizations.sec46_*` and audit `finance_sec46_set`.
- AC3. Derived status: a nightly job (`pg_cron`, existing scheduler) flips `active → expired` when `valid_until < current_date`; the UI also computes `isExpired` client-side so the card never shows a stale "active".
- AC4. `receipt_sec46_eligible` on an entry can be `true` only if the org status is `active` and `occurred_at::date` is within `[valid_from, valid_until]`; otherwise the RPC raises `sec46_not_active_on_date` and the form explains why.
- AC5. The existing `organizations.is_verified_nonprofit` column is **not** overloaded: verification (blue check) and 46(a) status are independent facts. The public nonprofit page shows the 46(a) badge only when `sec46_status='active'` **and** `transparency_settings.show_sec46_badge = true` (Phase 3 default `true` once active).
- AC6. Reminders (Phase 2, FR-FIN-016) fire at 90 / 30 / 7 days before `valid_until` and on expiry.
- AC7. KC platform org: seeded `sec46_status='none'`. The "donate to KC" surfaces (`FR-DONATE-010` Bit/Paybox card, `FR-DONATE-011`) render **no** tax-credit wording while status ≠ `active`.

---

## FR-FIN-008 — Receipt tracking per donation

**Description.** Every incoming donation entry tracks whether a receipt was issued to the donor, which number, when, whether it carries the 46(a) notice, and the file.

**Acceptance Criteria.**
- AC1. `receipt_status` defaults: `pending` for `kind in ('donation_in','grant_in')`, `not_required` for every other kind. The treasurer can override to `not_required` with a reason (e.g. anonymous cash box).
- AC2. Marking `issued` requires `receipt_number` (1..40, unique per org among non-voided entries → `receipt_number_taken`) and `receipt_issued_at`; attaching a `kind='receipt'` file is recommended and surfaced as a soft warning when missing.
- AC3. For `payment_sync` entries whose source payment has a `donation_receipts` row, the receipt fields are pre-filled from `donation_receipts.section46_serial` / `issued_at` and locked (`receipt_locked_by_provider`), with a link to the provider record.
- AC4. `/admin/finance/receipts` lists `pending` receipts oldest-first with donor, amount, date, days waiting; bulk "mark issued" opens a sequential form (number auto-increments from the last numeric receipt number of the org, editable).
- AC5. Donor link: when `donor_user_id` is set, the receipt card shows the donor's display name and share handle (admin-only), and FR-FIN-021 can expose the file to that donor.

---

## FR-FIN-009 — Automatic mirroring of in-app payments

**Description.** Donations collected through the in-app payment stack become ledger entries without manual work; the payment tables remain the source of truth and are never written by finance code.

**Acceptance Criteria.**
- AC1. Trigger `AFTER INSERT OR UPDATE OF status ON payments`: when `status` becomes `succeeded`, insert a `finance_ledger_entries` row for `payments.org_id` with `kind='donation_in'`, `direction='in'`, `amount_cents = round(amount_ils*100)`, `occurred_at = payments.created_at`, `account_id` = the org's `payment_provider` account (auto-created if missing via `admin_finance_bootstrap`), `category` = "הוראות קבע" when the intent belongs to a `standing_orders` row else "תרומות מיחידים", `counterparty` = provider display name, `donor_user_id = payments.user_id`, `source='payment_sync'`, `source_ref='payment:'||payment_id`, `status='cleared'`. Idempotent via the unique `(source, source_ref)` index.
- AC2. `payment_refunds.status → succeeded` inserts a `refund_out` entry (`source_ref='refund:'||refund_id`) referencing the original via `description`.
- AC3. `payment_payouts` (provider → bank) insert a `transfer` entry pair (out of `payment_provider` account, into the bank account chosen in finance settings; if none is configured the transfer stays `pending` with an alert).
- AC4. Backfill migration mirrors all historical `succeeded` payments / refunds once; re-running is a no-op.
- AC5. The ledger row shows a "מסונכרן מתשלומים" chip and a deep-link to the payment record (admin-only read).
- AC6. If the trigger fails (e.g. org has no finance bootstrap yet) it must **not** fail the payment transaction: the trigger function catches, logs to `audit_events` (`finance_sync_failed`), and a nightly repair job retries unmirrored payments.

---

## FR-FIN-010 — Exports

**Acceptance Criteria.**
- AC1. Export wizard: period (fiscal year / quarter / month / custom), scope (all / in / out), format **CSV** (UTF-8 with BOM, Hebrew-safe for Excel), **XLSX** (sheets: Entries, Accounts, Categories, Receipts, Attachments index), **PDF summary** (totals by category, by account, by month; org name, period, generated-at footer).
- AC2. CSV / XLSX columns (fixed order, English headers + Hebrew second header row): `entry_id, occurred_at, fiscal_year, direction, kind, amount_ils, account, category, parent_category, counterparty, description, project_tag, status, receipt_status, receipt_number, receipt_issued_at, sec46_eligible, source, reconciled_at, attachments_count, created_by, created_at`.
- AC3. Generation runs in an Edge Function `finance-export` (service role, re-checks `finance.export` via `finance_assert`) that writes the file to `finance-attachments/{org_id}/exports/` and returns a 10-minute signed URL. Files older than 30 days are purged by the nightly job.
- AC4. Each export is audit-logged (`finance_export`, with period + format) so accountant downloads are traceable.
- AC5. Voided entries are excluded by default; a checkbox includes them in a separate sheet.

---

## FR-FIN-011 — Portal sub-tree, navigation & migration of `/admin/money`

**Acceptance Criteria.**
- AC1. `AdminNav` replaces the "money" entry with "כספים" → `/admin/finance`; visible when `finance.view` resolves for at least one org the caller can see.
- AC2. `/admin/money` route stays for one release and `router.replace`s to `/admin/finance/ledger`; removed in Phase 2 (`TD-208`).
- AC3. Overview (`/admin/finance`) Phase 1 tiles: balance per account, income / expense MTD and YTD, pending receipts count, last 5 entries. Phase 2 adds the alerts list (FR-FIN-016).
- AC4. Finance sub-tree is a nested navigator inside `(admin)`: on web ≥ md a secondary left rail lists the finance routes; on mobile a horizontal chip row under the header. Deep links to any finance route go through `AdminGate` + `finance.view`.
- AC5. E2E (Playwright, `tests/e2e/`): treasurer creates an entry with attachment, marks receipt issued, exports CSV; accountant sees the entry but gets no write affordances; moderator sees platform org read-only.

---

## Phase 2 — Imports, reconciliation, reports, alerts

## FR-FIN-012 — CSV import (bank / Bit / Paybox / generic)

**Acceptance Criteria.**
- AC1. Wizard: pick account → upload CSV (≤ 5 MB, ≤ 5,000 rows) → auto-detect preset (`csv_bank` for the common Israeli bank export shapes: date, description, debit, credit, balance; `csv_bit`, `csv_paybox` for their transaction exports; `csv_generic` with manual column mapping saved per account) → preview → commit.
- AC2. Preview marks each row: **new** (will create a `pending` entry pre-categorized by FR-FIN-004 rules), **matched** (an existing entry with same date ±2 days, same amount, same account → will reconcile it, FR-FIN-013), **duplicate** (fingerprint already imported → skipped), **ignored** (user toggle).
- AC3. Commit is one transaction (`admin_finance_import_commit`); partial failure rolls back and surfaces the line number. Result card shows created / matched / skipped counts.
- AC4. Import rows keep `raw jsonb` for 7 years alongside the uploaded file (`finance-attachments/{org_id}/imports/`).
- AC5. Encoding: UTF-8 and Windows-1255 are both accepted (auto-detect by BOM / byte heuristics); dates `dd/mm/yyyy` and ISO.

---

## FR-FIN-013 — Bank reconciliation

**Acceptance Criteria.**
- AC1. `/admin/finance/reconcile` has two columns (stacked on mobile): unreconciled ledger entries of the selected account, and unmatched import rows. Suggested pairs (same amount, date within ±3 days) are highlighted; one tap confirms.
- AC2. Confirm sets `reconciled_at / reconciled_by` on the entry and `status='matched'` + `entry_id` on the import row. Un-reconcile is allowed for `finance.reconcile` holders and is audit-logged.
- AC3. Reconciled entries are locked for amount / date / account edits (FR-FIN-005 AC3).
- AC4. Account header shows **book balance** vs **statement balance** (last imported row's running balance when present) and the difference.

---

## FR-FIN-014 — Reports

**Acceptance Criteria.**
- AC1. Reports hub lists: **הכנסות מול הוצאות** (monthly bars for a fiscal year + annual totals), **לפי קטגוריה** (tree with amounts and % of direction total), **לפי פרויקט** (project tags), **תורמים** (count of donors, recurring vs one-time, top 10 by amount — admin-only, never exported to the public), **סיכום שנתי לרשם העמותות** (income by source, expenses by the five statutory buckets mapped from `is_program` + system categories, year-end balances per account, receipts issued count, 46(a) status at year end).
- AC2. Every report is a `SECURITY DEFINER` RPC returning aggregates only (no row ids), gated by `finance.view`; results are cached client-side 60 s per `(org_id, report, params)`.
- AC3. Each report has "ייצוא" (CSV + PDF via FR-FIN-010's Edge Function with `report_key`).
- AC4. Charts follow the `dataviz` guidance already used in `/admin/surveys`; colours from `@kc/ui` tokens; RTL axis labels.

---

## FR-FIN-015 — Budget vs. actual

**Acceptance Criteria.**
- AC1. `/admin/finance/budgets`: per fiscal year, one row per **out** category (and optionally **in**), editable `amount_cents`; "copy from previous year" action.
- AC2. Actual = Σ cleared, non-voided entries of that category in that fiscal year; the row shows amount, %, and a progress bar turning warning at ≥ 90 % and danger at > 100 %.
- AC3. Budget overruns feed FR-FIN-016 alerts.

---

## FR-FIN-016 — Smart alerts & reminders

**Acceptance Criteria.**
- AC1. `admin_finance_alerts(p_org_id)` computes (no storage) and returns alerts with `key`, `severity`, `count`, `deep_link`:
  - `receipts_pending` — donations with `receipt_status='pending'` older than 14 days.
  - `unreconciled` — cleared entries not reconciled > 30 days (only when the org has at least one import).
  - `standing_order_failed` — `standing_orders` of the org with a failed last charge (from payment tables) in the last 30 days.
  - `sec46_expiring` / `sec46_expired` — 90 / 30 / 7 days before `sec46_valid_until`, and after.
  - `proper_management_expiring` — same thresholds for the newest `proper_management_certificate` document (Phase 3 data; alert ships now, empty until then).
  - `annual_report_due` — from 1 April until 30 June of each year while no `annual_financial_report` document exists for the previous fiscal year.
  - `budget_overrun` — categories ≥ 90 % of budget.
  - `payout_unassigned` — pending transfer entries from FR-FIN-009 AC3.
- AC2. Alerts render on the overview as a prioritized list; each has "הצג", and "השתק ל-30 יום" which writes `finance_alert_dismissals`.
- AC3. Push: once a day (existing `notifications_outbox` + `dispatch-notification`), a digest notification `finance_alerts_digest` is enqueued to every active `org_treasurer` / `org_admin` of the org when at least one non-dismissed alert of severity ≥ warning exists; dedupe key `finance_alerts_digest:<org_id>:<yyyy-mm-dd>`. Opt-out via the per-kind notification settings (`FR-NOTIF-*` kinds opt-out, migration `0460`).
- AC4. Auto-categorization suggestions (FR-FIN-004 AC3) surface as an alert `uncategorized_entries` when > 5 entries have no category.

---

## FR-FIN-017 — Overview dashboard (complete)

**Acceptance Criteria.**
- AC1. Tiles: total balance (Σ accounts), income / expense for current month and fiscal YTD with delta vs. same period last year, pending receipts, open alerts count, recurring donors count (from mirrored standing orders).
- AC2. Mini chart: last 12 months income vs. expense.
- AC3. Quick actions: new entry, import CSV, export, mark receipts.
- AC4. All numbers come from one RPC `admin_finance_overview(p_org_id)`; p95 < 500 ms on 50k entries (index on `(org_id, fiscal_year, direction)` and `(org_id, occurred_at)`).

---

## Phase 3 — Documents, transparency, donor view

## FR-FIN-018 — Organization documents vault

**Acceptance Criteria.**
- AC1. `/admin/finance/documents` lists `org_documents` grouped by kind; each row: title, fiscal year, validity, public toggle, uploader, date.
- AC2. Upload / replace / remove via `admin_org_document_*` RPCs + signed upload URL (same pattern as FR-FIN-006); bucket `org-documents`, private; ≤ 25 MB; PDF / JPEG / PNG.
- AC3. `is_public = true` requires `transparency.manage`; public files are served through a short-lived signed URL minted by `api_org_public_document_url(document_id)` (service role, verifies `is_public`) so the bucket never becomes public-read (lesson of `TD-11`).
- AC4. The 46(a) certificate uploaded in FR-FIN-007 is an `org_documents` row of kind `sec46_certificate`; the status card links here.
- AC5. Validity dates feed FR-FIN-016 expiry alerts.

---

## FR-FIN-019 — Transparency snapshots & settings

**Description.** The organization publishes a frozen, reviewed yearly summary. Live books are never exposed.

**Acceptance Criteria.**
- AC1. `/admin/finance/transparency` → pick fiscal year → "בנה טיוטה" computes the snapshot from cleared, non-voided entries (totals in/out, program vs. overhead from `is_program`, donations count, recurring donors count, by-category totals). The treasurer reviews the numbers and the org admin publishes.
- AC2. Publishing (`admin_transparency_publish`) requires `transparency.manage`, stores the snapshot immutably with `published_at / published_by`, and audit-logs. Re-publishing a year supersedes the previous snapshot (`unpublished_at` set on the old one); history is kept.
- AC3. Settings toggles (`organizations.transparency_settings`): `show_totals`, `show_program_ratio`, `show_documents`, `show_sec46_badge`. All default `false` except `show_sec46_badge`, which defaults `true` and only matters while `sec46_status='active'`.
- AC4. Public read RPC `rpc_org_transparency(p_slug)` (anon + authenticated) returns: published snapshots filtered by toggles, public documents list (title, kind, year, signed-URL endpoint), 46(a) badge boolean, and `last_published_at`. It never returns counterparties, donor ids, entry ids, account names or pending data.
- AC5. Preview mode in the admin screen renders exactly the public component with the draft data.
- AC6. **Donor identities are never public** under any toggle. Enforced by the RPC shape (no donor fields exist in the return type) and a unit test that asserts the type.

---

## FR-FIN-020 — Public transparency section on the organization profile

**Acceptance Criteria.**
- AC1. Component `OrgTransparencySection` renders, in this order: 46(a) badge (when enabled: *"תרומות לארגון מזכות בזיכוי ממס לפי סעיף 46א"* with validity year), yearly totals cards (income, expense, program share %), a small year selector when more than one snapshot is published, public documents list with download, and *"עודכן לאחרונה"* with `last_published_at`.
- AC2. Hosted today on `/(tabs)/donations/money/nonprofit/[slug]` below the campaigns block; when `FR-ORG-003` ships the organization profile at `/org/[slug]`, the same component mounts in its "שקיפות" tab (`FR-ORG-020`) unchanged (component is presentational; data via `rpc_org_transparency`).
- AC3. Empty state when nothing is published: *"הארגון עדיין לא פרסם נתוני שקיפות"*; the whole section is hidden when the org disabled every toggle and has no 46(a) badge.
- AC4. Guest-accessible (anon RPC), responsive per `spec/14_responsive_desktop.md`, strings under `org.transparency.*`.
- AC5. The KC platform org uses the same path: the About screen (`FR-DONATE-010` placements) links to KC's transparency section once at least one snapshot is published.

---

## FR-FIN-021 — Donor-side receipt view

**Acceptance Criteria.**
- AC1. In the donor's existing donation history (money world "התרומות שלי"), each donation shows receipt state: *"קבלה הופקה"* (+ number, date, 46(a) note when eligible) / *"בהמתנה לקבלה"* / nothing for `not_required`.
- AC2. When a `kind='receipt'` attachment has `share_with_donor = true`, a download button mints a signed URL via `rpc_my_donation_receipt_url(entry_id)` which verifies `donor_user_id = auth.uid()`.
- AC3. Donors never see any other finance data (RLS: no `SELECT` on finance tables for non-admin users; the two donor RPCs return only the donor's own rows).
- AC4. When the treasurer flips a receipt to `issued` for an entry with `donor_user_id`, a `donation_receipt_ready` notification is enqueued (category `social`, dedupe `donation_receipt_ready:<entry_id>`), opt-out capable.

---

## Dependencies & contract with the organization profile (`spec/20_organizations.md`)

Specified in `spec/20_organizations.md` (FR-ORG-001..020, D87–D91). The PM's definition (2026-10-30): an **organization profile is an extended user profile** — it has its own email identity, posts, followers and a public page like a user, plus an **Admin Portal** for running the organization in which **this spec is the finance sub-tree**. That domain is not specified here. What this spec assumes from it, so the two can ship independently:

1. `organizations.org_id` stays the tenant key; the profile domain must not introduce a second organization identity.
2. Membership/roles keep flowing through `admin_role_grants` (+ `org_memberships`); finance never reads anything else for authorization.
3. The public profile exposes a slot for `OrgTransparencySection` (FR-FIN-020) and reads `rpc_org_transparency(slug)` only.
4. Org-level Admin Portal entry point: `/admin` with the org pre-selected for org-scoped roles (already how `OrgSwitcher` pins scoped admins). Finance adds nothing to that contract.

Tracked in `BACKLOG.md` as `ORG-P1..P3`. The transparency tab mounts via `FR-ORG-020`.

---

## Non-functional requirements

- **Security.** RLS on every table; writes RPC-only; `finance_assert` on every write and every org-scoped read; buckets private with signed URLs; no stack traces to UI (adapters map SQLSTATE / `raise exception` codes to `FinanceError`). Export URLs expire in 10 minutes.
- **Integrity.** Amounts `bigint` agorot; `(source, source_ref)` unique; `(org_id, receipt_number)` unique; voided and reconciled invariants enforced in SQL, not only in the client.
- **Auditability.** Every write → `audit_events`; entry detail shows its trail; exports logged.
- **Performance.** List p95 < 400 ms at 50k entries per org; overview RPC p95 < 500 ms; imports ≤ 5,000 rows commit < 10 s.
- **Accessibility / RTL.** Every control ≥ 44×44, `accessibilityRole`, Hebrew-first RTL layouts, numbers LTR inside RTL text (`⁦…⁩` isolates in the formatter).
- **Testing.** Domain + application unit tests beside the code; `map*Row` tests; SQL tests for `finance_assert`, trigger idempotency (FR-FIN-009), and snapshot shape (FR-FIN-019 AC6); RLS persona suite rows for treasurer / accountant / moderator / donor; Playwright E2E per FR-FIN-011 AC5.
- **i18n.** Hebrew bundle only (`R-MVP-Core-4`); keys under `admin.finance.*`, `org.transparency.*`, `notifications.financeAlertsDigest*`, `notifications.donationReceiptReady*`.

---

## Open items for the PM (non-blocking; defaults apply until answered)

| # | Question | Default applied |
| - | -------- | --------------- |
| O1 | Which accounting software does the external accountant use? | Universal CSV/XLSX + PDF (S48); integration is `TD-207`. |
| O2 | Should `moderator` keep read access to the platform org's books? | Yes, read-only (`FR-FIN-002 AC5`). |
| O3 | Legal review of the public 46(a) wording and of the Registrar annual-summary bucket mapping before Phase 3 goes live. | Phase 3 PR must include a PM sign-off line in its body. |
| O4 | Statement export shapes of the specific bank(s) KC uses, to pin the `csv_bank` preset. | Generic mapping until a sample file is provided. |

---

| Version | Date | Summary |
| ------- | ---- | ------- |
| 0.1 | 2026-10-30 | Initial end-to-end spec from PM Q&A. Defines `FR-FIN-001..021` in three phases, roles `org_treasurer` / `org_accountant`, data model, portal sub-tree, Section 46(a) tracking, payment mirroring, exports, imports, reconciliation, reports, alerts, documents vault, transparency snapshots, donor receipt view. Claims migrations `0470–0489`. Records product decisions D76–D82 (+ S48/S49) and engineering decision `D-196`. |
