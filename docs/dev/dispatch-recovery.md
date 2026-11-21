# Dispatch recovery qualification (#856)

This change installs a new, separate per-device native Expo queue. Installation does not open automatic delivery. The 395-event legacy backlog and legacy retry/receipt topics are not adopted or drained.

## Review and release order

1. Keep PR #2567 draft while code, semantic tests and rollout are reviewed. Run the existing feature-branch manual CI route; do not change workflow guards or treat a manual run as merge certification.
2. Deploy only through the existing reviewed DEV route. Database and worker can be installed with no gate row. Empty generic HTTP bodies are closed no-ops. An authenticated automatic request with a closed gate returns zero work, not proof of activation.
3. Qualify a specific existing origin with an approved scope containing event IDs, recipient ID and one owned device ID. All filters intersect. First delivery creates the inbox row and durable jobs in one transaction. Other native devices remain as pending jobs, outside that device-scoped claim. A notification-only filter cannot create an inbox row that does not yet exist; it can select existing jobs.
4. Inspect inbox/read state, current badge, rendered title/body and tap destination. Accepted Expo tickets and provider receipts do not prove physical display. Keep physical iOS/Android evidence separate.
5. Only after review and acceptance, an owner-level database session may call `kc_private.dispatch_activate` with a release note. API service-role callers cannot activate/deactivate. No production activation is implied.
6. Activation uses a new epoch, not an ID cutoff. The outbox insert trigger stamps new roots with the current epoch. The activation table-lock barrier waits for prior outbox writers. The trigger, minute tick, every claim and POST permission resolve the current gate. Existing roots and earlier-epoch jobs stay held. Explicitly decide their disposition separately.
7. `dispatch_deactivate` stops new automatic claims and POST permissions. It cannot recall a request already sent. Those requests may still settle with their existing lease. Reactivation creates another epoch and does not adopt pending work from the previous epoch.

## Delivery semantics

- Inbox delivery, per-device job creation and root completion are one transaction. Enqueue failure rolls them all back. The existing recipient advisory lock/grouping logic is retained.
- Origin ID, notification ID, recipient ID and device ID are separate identifiers. Jobs are unique by origin/device/provider, not by grouped notification ID. Original event arguments/route metadata are retained per job, without token or message preview. Grouping cannot replace an earlier job's message ID with a later actor's message.
- Pushes use current eligibility, token ownership, token fingerprint and badge before POST permission. Read, inactive, blocked or newly muted jobs are skipped without deleting inbox rows, with the registry's mandatory exceptions retained. Existing quiet-hours semantics skip delivery, not a promise to deliver later.
- Each claim has a fresh lease token and scope. Whole-batch validation precedes sending and settlement. Stale/foreign/duplicate entries reject the batch. The provider timeout is 15 seconds, below the two-minute lease with a 30-second minimum remaining at POST permission.
- A network timeout, bad response, unmatched ticket count, unknown provider result, or expired `sending` lease is `send_unknown`. It is held for review and is not automatically resent. A crash between granting POST permission and actually posting can therefore sacrifice a push rather than risk a duplicate. This is not exactly-once delivery.
- Definitive HTTP 429/5xx and `MessageRateExceeded` use bounded per-device backoff, at most five claims. Permanent payload/config errors stop and produce an operational warning.
- An accepted ticket is stored on its immutable lineage row before later receipt polling. Poll after 15 minutes. A missing/unavailable receipt polls the same stored ticket, never resends the push. Receipt errors are terminal; 24-hour expiry is terminal. `provider_accepted` is not a physical-device delivery assertion.
- `DeviceNotRegistered` removes a registration only when its current token fingerprint still matches the token used for that job. A replacement registration is not deleted by an old receipt.
- Terminal metadata uses the existing seven-day processed-outbox retention pass. Unresolved/unknown jobs remain held like unprocessed outbox work. Recipient account deletion cascades even held jobs.

## Tests

- `scripts/run-baseline-tests.sh`: complete baseline, every forward migration, pgTAP suites and seed loaders against a disposable local PostgreSQL 16 database.
- `supabase/tests/130_dispatch_recovery.sql`: scope/ownership isolation, rollback, idempotence, leases, per-device outcomes, receipts, token replacement, grouping, epochs, privileges and retention.
- `DB_URL=<local kc_* scratch database> python3 scripts/test-dispatch-concurrency.py`: requires psycopg; two real connections prove root/job SKIP LOCKED isolation and the preactivation transaction barrier. It refuses non-local/non-scratch databases and cleans its synthetic rows.
- Deno handler/transport/scope/worker tests cover contract behavior, not database isolation.
- `scripts/dispatch-schema-parity.test.mjs` compares the migration to canonical modules byte for byte.

## Still outside this root change

Web push is not implemented by Expo and remains a separate transport gap. Android launcher badges are OS-dependent and have no new payload support here. Detailed per-type settings UI, full platform/event acceptance, and physical-device qualification remain open. Do not claim that installing this change completes them.
