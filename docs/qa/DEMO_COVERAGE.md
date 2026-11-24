# Demo Coverage Catalog (DCC)

**Spec:** FR-ADMIN-031 AC13 (`docs/spec/requirements/12_super_admin.md`) · **Issue:** #1964

**Principle:** demo data covers each **equivalence class** once (one fixture per lifecycle state) and adds a **curated pairwise grid** only where two dimensions interact with real risk. It never builds the full product of every dimension: that is millions of rows and finds no more defects than one fixture per class.

## Why not every combination

| Dimension | Cardinality |
|---|---|
| Post states | 8 |
| Handoff statuses (items) | 5 |
| Account status | 7 |
| Admin and organization roles | 11 |
| Organization type × status | 5 × 5 |
| Verification level | 6 |

## Fixtures and naming

| Fixture | Where | Marker |
|---|---|---|
| A post per state | owned by `demo-dcc-owner@seed.kc.test` | title `[DCC] Post S1 — <state>` |
| The counterpart (recipient, reporter) | `demo-dcc-guest@seed.kc.test` | demo member |
| An admin task per state | `kc_private.admin_tasks` | label `demo_coverage` |
| A report per state | `public.reports` | note `demo-coverage:<state>` |

Both members are demo members (`demo` flag), so the demo wipe removes them with everything they own; the tasks and reports, which no member owns, are removed by the wipe through their markers. Every fixture is reached through legal moves of its machine, so the kernel guards run as in production.

## Waves

| Wave | Scope | Status |
|---|---|---|
| 0 | Bulk load for feed density: 200 members, posts, worlds, social, chats, nonprofits | ✅ |
| 1 | One fixture per state of the `post`, `admin_task` and `report` machines; `admin_demo_coverage_report` | ✅ |
| 2 | Handoffs per world (reserved … no_show, waitlisted), account status, onboarding state | planned |
| 3 | One deterministic member per admin role, with permission smoke posts | planned |
| 4 | Organizations: a curated grid of type × status × verification level | planned |
| 5 | Later lifecycles: volunteering, timesheets, payments sandbox, WhatsApp outbound | planned |

## Auditing

On kc-dev, as the super admin or the platform organization's admin, after a restore:

```sql
select public.admin_demo_coverage_report();
```

`complete: true` means every state of wave 1 has a fixture; `gaps` names the machines and states that do not. The expected states are read from the kernel (`kc_private.fsm_state`), so a state added to one of these machines appears as a gap until a fixture is written for it.

## References

- Machines: [`docs/architecture/state-machines.md`](../architecture/state-machines.md)
- Seed: `supabase/seed/demo/lib/65_seed_coverage.sql`; test: `supabase/tests/110_demo_data.sql`
