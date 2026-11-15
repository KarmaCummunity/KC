// dispatch-notification — push worker of the notification queue (FR-NOTIF-001..018).
// Wiring only: Postgres + the Expo push service behind the ports of handler.ts.
import postgres from 'npm:postgres@3.4.5';
import { withObservability } from '../_shared/observability/mod.ts';
import { createExpoTransport } from './expoTransport.ts';
import { createDispatchHandler } from './handler.ts';
import { createPostgresDatabase } from './postgresDatabase.ts';

// `prepare: false`: the transaction pooler does not keep prepared statements.
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2 });

Deno.serve(withObservability('dispatch-notification', createDispatchHandler({
  db: createPostgresDatabase((text, params) => sql.unsafe(text, params as never[])),
  transport: createExpoTransport(Deno.env.get('EXPO_ACCESS_TOKEN')),
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
})));
