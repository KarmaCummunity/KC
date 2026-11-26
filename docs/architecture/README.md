# KC Architecture

| File | Contents |
|---|---|
| [current.md](./current.md) | Architecture as it exists in the code today |
| [target.md](./target.md) | Target architecture implied by the product spec (`docs/spec/`) |
| [adr/ADR-001-client-state.md](./adr/ADR-001-client-state.md) | Client state: query cache vs Zustand stores vs persisted prefs vs secrets, with a checklist (`D-200`) |
| [adr/ADR-002-data-layer.md](./adr/ADR-002-data-layer.md) | Data layer contract: RPC vs table, RLS, repositories, errors, generated types, migrations + new-RPC checklist (`D-194`) |
| [adr/ADR-003-realtime.md](./adr/ADR-003-realtime.md) | Realtime: Broadcast vs Presence vs postgres_changes, topics + auth, lifecycle, fallback (`D-201`) |
| [adr/ADR-004-offline-sync.md](./adr/ADR-004-offline-sync.md) | Offline-first and sync strategy: read cache, write outbox, retry/backoff, conflict rules, UX states (Proposed, #1018) |
| [adr/ADR-005-library-evaluation-matrix.md](./adr/ADR-005-library-evaluation-matrix.md) | Library evaluation matrix: navigation, forms, maps, media, animation, i18n, lists, dependabot groups (#1024) |
| [adr/ADR-006-one-post-model.md](./adr/ADR-006-one-post-model.md) | One Post model: six-step plan from `listings` to `posts` + `ride_post_details` + `post_handoffs` (G1, D2 / D19; `D-214`) |
| [adr/ADR-007-event-group-audience.md](./adr/ADR-007-event-group-audience.md) | Audience of an event ride group: fail-closed membership (`OnlyMe` + membership clause), reader inventory test, per-group realtime (Proposed, `G62`) |
| [adr/ADR-009-backend-platform.md](./adr/ADR-009-backend-platform.md) | Backend platform: an owned NestJS API on Google Cloud (modular monolith, Cloud SQL, Redis, media pipeline), the phased move off Supabase with exit criteria and rollback (Accepted, KC#1496; `{{ENG:backend-platform-off-supabase}}`) |
| [adr/ADR-010-port-gateway.md](./adr/ADR-010-port-gateway.md) | How the app reaches the API: one gateway route that serves the application ports, a generic remote port on the app, typed errors across the wire, and the SQL engine that lets the existing Supabase adapters run on the server unchanged (Accepted, KC#1496; `{{ENG:port-gateway-compat-engine}}`) |
| [adr/ADR-011-realtime-gateway.md](./adr/ADR-011-realtime-gateway.md) | Realtime after Supabase: one WebSocket endpoint in the API, the topics of ADR-003, subscriptions authorized by the policies already on `realtime.messages`, database events through `NOTIFY`, client-sent events and presence through Redis (Accepted, KC#1496; `{{ENG:realtime-gateway}}`) |
| [adr/ADR-012-media-storage.md](./adr/ADR-012-media-storage.md) | Files after Supabase Storage: KC's own object store behind one interface, `storage.objects` kept as the index, uploads and private reads by signed URLs the API issues, and every right decided by the policies already on `storage.objects` (Accepted, KC#1496; `{{ENG:media-storage}}`) |
| [backend-migration-plan.md](./backend-migration-plan.md) | Backend move off Supabase: inventory (client + kc-dev), review of PR #2576, target shape, rollout gates and first steps (companion to ADR-009/010, epic #1496) |
| [state-machines.md](./state-machines.md) | Every status lifecycle: states, copies, divergences, and the wave order onto the FSM kernel (`fsm_state` / `fsm_edge` / `fsm_assert_transition`; gap `G61`) |

Environment details (branches, hosting, env vars by name): [`../SSOT/ENVIRONMENTS.md`](../SSOT/ENVIRONMENTS.md). Operational runbooks: [`../SSOT/OPERATOR_RUNBOOK.md`](../SSOT/OPERATOR_RUNBOOK.md). Secrets are referenced **by name only**.
