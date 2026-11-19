// identity-verification-webhook — provider callbacks. Not behind a Supabase JWT (the provider
// cannot send one); the handler verifies the provider signature and fails closed. Wiring only:
// the logic is in handler.ts.
//
// Secrets (names): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, IDV_IDENTITY_HASH_KEY, and the
// provider settings of _shared/identity/providerFromEnv.ts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { providerFromEnv } from '../_shared/identity/providerFromEnv.ts';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { readEnv } from '../_shared/readEnv.ts';
import { createWebhookHandler } from './handler.ts';

const service = createClient(readEnv('SUPABASE_URL'), readEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

Deno.serve(withObservability('identity-verification-webhook', createWebhookHandler({
  provider: providerFromEnv(),
  identityHashKey: readEnv('IDV_IDENTITY_HASH_KEY'),
  async profileNameForAttempt(attemptId) {
    // Only a well-formed attempt id reaches the query; anything else has no profile name.
    if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return null;
    const { data } = await service.from('identity_verifications')
      .select('users(display_name)').eq('id', attemptId).maybeSingle();
    const user = (data as { users: { display_name: string | null } | null } | null)?.users;
    return user?.display_name ?? null;
  },
  async apply(providerSlug, eventId, payload) {
    const { data, error } = await service.rpc('identity_verification_apply', {
      p_provider_slug: providerSlug,
      p_event_id: eventId,
      p_payload: payload,
    });
    if (error) throw new Error(error.message);
    // A set-returning function arrives as an array with one row.
    const row = (Array.isArray(data) ? data[0] : data) as {
      webhook_event_id: string; event_status: 'processed' | 'failed'; event_error_code: string | null;
    };
    return { id: row.webhook_event_id, status: row.event_status, errorCode: row.event_error_code };
  },
  nowSeconds: () => Math.floor(Date.now() / 1000),
  report: (error) => reportError(error, { fn: 'identity-verification-webhook' }),
})));
