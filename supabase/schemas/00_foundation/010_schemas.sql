-- Foundation · schemas
--
-- `public` is the API contract: only tables a client reads or writes under RLS and the RPCs a
-- client calls by name live there. Every other object lives in a schema PostgREST does not
-- expose, so it cannot be addressed from a device at all (docs/db/target-design.md §2.1).

-- Internal objects: trigger functions, policy helpers, sweeps, queues, FSM kernel.
create schema kc_private;
comment on schema kc_private is 'Internal objects. Not exposed through the API.';

-- Money: payments, ledger, KYC, receipts, provider webhooks.
create schema billing;
comment on schema billing is 'Payments and ledger. Reached only through public RPCs and service-role functions.';

-- Append-only audit trail and account-deletion tombstones.
create schema audit;
comment on schema audit is 'Append-only audit trail. No role may update or delete its rows.';

-- External channels (WhatsApp bot, ingestion). Reserved: tables arrive with that module.
create schema integrations;
comment on schema integrations is 'External channel integrations. Service role only.';

-- Health checks and job telemetry.
create schema ops;
comment on schema ops is 'Operational telemetry. Service role only.';
