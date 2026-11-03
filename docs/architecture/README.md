# KC Architecture

| File | Contents |
|---|---|
| [current.md](./current.md) | Architecture as it exists in the code today |
| [target.md](./target.md) | Target architecture implied by the product spec (`docs/spec/`) |
| [adr/ADR-001-client-state.md](./adr/ADR-001-client-state.md) | Client state: query cache vs Zustand stores vs persisted prefs vs secrets, with a checklist (`D-200`) |
| [adr/ADR-002-data-layer.md](./adr/ADR-002-data-layer.md) | Data layer contract: RPC vs table, RLS, repositories, errors, generated types, migrations + new-RPC checklist (`D-194`) |
| [adr/ADR-003-realtime.md](./adr/ADR-003-realtime.md) | Realtime: Broadcast vs Presence vs postgres_changes, topics + auth, lifecycle, fallback (`D-201`) |
| [adr/ADR-004-offline-sync.md](./adr/ADR-004-offline-sync.md) | Offline-first and sync strategy: read cache, write outbox, retry/backoff, conflict rules, UX states (Proposed, #1018) |

Environment details (branches, hosting, env vars by name): [`../SSOT/ENVIRONMENTS.md`](../SSOT/ENVIRONMENTS.md). Operational runbooks: [`../SSOT/OPERATOR_RUNBOOK.md`](../SSOT/OPERATOR_RUNBOOK.md). Secrets are referenced **by name only**.
