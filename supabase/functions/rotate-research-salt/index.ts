// rotate-research-salt — service role only; started daily by the database job
// `research_salt_rotate` (supabase/schemas/95_platform/900_job_registry.sql). Wiring only:
// the logic is in handler.ts.
//
// POST → 200 { ok: true, rotated_at }   (401 for any caller but the service role)
// Secrets (names): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { createRotateSaltHandler } from './handler.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } });

Deno.serve(withObservability('rotate-research-salt', createRotateSaltHandler({
  serviceRoleKey: SERVICE_KEY,
  async rotate() {
    const { data, error } = await admin.rpc('rotate_research_salt');
    if (error) throw error;
    return String(data);
  },
  report: (error) => reportError(error, { fn: 'rotate-research-salt' }),
})));
