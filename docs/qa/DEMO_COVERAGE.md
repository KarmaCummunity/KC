# Demo Coverage Catalog (DCC)

**Issue:** #1964 / FR-ADMIN-031  
**Principle:** Test data follows **equivalence-class + pairwise** coverage (IEC 29119 / ISTQB), not a full Cartesian product of FSM × roles × orgs.

## Why not “every combination”?

Rough order of magnitude for a naive product across P0 dimensions alone:

| Dimension | Cardinality (P0) |
|-----------|------------------|
| Post S1 states | 7 |
| Handoff statuses (items) | 5 |
| Account status | 7 |
| Admin / org roles | 11 |
| Org type × status | 5 × 5 |
| Verification level | 6 |

A full product is millions of rows and does not improve defect detection versus **one fixture per equivalence class** plus a **curated pairwise grid** for high-risk interactions (RBAC × org scope, suspended account × handoff, etc.).

## Naming convention (deterministic fixtures)

| Pattern | Example | `raw_app_meta_data` |
|---------|---------|---------------------|
| FSM post state | `dcc-post-paused@seed.kc.test` | `seed: true`, `dcc: "wave1"`, `fixture: "post:paused"` |
| Shared helper | `dcc-shared-recipient@seed.kc.test` | same `dcc` marker |
| Admin task | title `[DCC] admin_task — blocked` | — |
| Report | `note` prefix `dcc_wave1:open` | — |

All DCC users use `@seed.kc.test` and `seed: true` so `admin_wipe_demo_data` and `is_demo_seed_user` stay correct.

## Waves

| Wave | Scope | Deliverable | Status |
|------|--------|-------------|--------|
| **0** | Bulk load / feed density | ~200 `userN@seed.kc.test`, random posts, worlds, social (existing seed) | ✅ |
| **1** | Kernel-backed P0 FSM **states** | Post S1 (7), `admin_task` (5), `report` (3); `admin_demo_coverage_report()` | 🚧 this doc + migration `0694` |
| **2** | Handoffs + people | `post_handoffs` per world (reserved…no_show / waitlisted), `users.account_status` (7), `onboarding_state` (3) | planned |
| **3** | RBAC | One deterministic user per `AdminRole` + permission smoke posts | planned |
| **4** | Organizations | Pairwise grid: `org_type` × `status` × `verification_level` (curated, not full 5×5×6) | planned |
| **5** | P2 lifecycles | Volunteering, timesheets, payments sandbox, WhatsApp outbound | planned |

## Wave 1 acceptance (P0 checklist)

### Post S1 (`posts.status`)

- [ ] `open`
- [ ] `paused`
- [ ] `expired`
- [ ] `closed_delivered` (with `recipients` row)
- [ ] `deleted_no_recipient`
- [ ] `hidden_pending_review`
- [ ] `removed_admin` (with `status_before_admin_removal`)

### Admin task (`admin_tasks.status`, FSM wave 0)

- [ ] `open`, `in_progress`, `blocked`, `done`, `archived`

### Report (`reports.status`)

- [ ] `open`, `confirmed_violation`, `dismissed_no_violation` (terminal rows inserted with `resolved_*`, no illegal `UPDATE`)

## Auditing

After seed on kc-dev, super admin or platform org admin:

```sql
select public.admin_demo_coverage_report();
```

`complete: true` means wave 1 equivalence classes are populated; `gaps` lists missing states.

## References

- FSM inventory: [`docs/architecture/state-machines.md`](../architecture/state-machines.md)
- Domain Post S1: `app/packages/domain/src/fsm/machines/post.ts`
- Seed entrypoints: `kc_dev_seed_demo_data` / `admin_seed_demo_data` (FR-ADMIN-031)
