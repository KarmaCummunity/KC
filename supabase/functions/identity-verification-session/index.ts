// identity-verification-session — wiring only: the logic and its tests are in handler.ts.
// Behind a Supabase JWT; the caller is verified again with auth.getUser.
// Secrets (names): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, and the provider
// settings of _shared/identity/providerFromEnv.ts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { providerFromEnv } from '../_shared/identity/providerFromEnv.ts';
import { RefusalError } from '../_shared/identity/provider.ts';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { readEnv } from '../_shared/readEnv.ts';
import { createSessionHandler } from './handler.ts';

const SUPABASE_URL = readEnv('SUPABASE_URL');
const service = createClient(SUPABASE_URL, readEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

/** Throws RefusalError for a business refusal (P0001), a plain Error for anything else. */
function throwRpcError(error: { code?: string; message: string }): never {
  if (error.code === 'P0001') throw new RefusalError(error.message);
  throw new Error(error.message);
}

Deno.serve(withObservability('identity-verification-session', createSessionHandler({
  async authenticate(req) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return null;
    const client = createClient(SUPABASE_URL, readEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data, error } = await client.auth.getUser();
    return error || !data?.user ? null : data.user.id;
  },
  async begin(userId, providerSlug) {
    const { data, error } = await service.rpc('api_identity_verification_begin', { p_user_id: userId, p_provider: providerSlug });
    if (error) throwRpcError(error);
    return data as string;
  },
  async latestConsent(userId) {
    const { data, error } = await service.from('identity_verification_consents')
      .select('version, accepted_at').eq('user_id', userId)
      .order('accepted_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as { version: string; accepted_at: string } | null;
    return row ? { version: row.version, acceptedAt: row.accepted_at } : null;
  },
  async setSession(attemptId, providerSessionId) {
    const { error } = await service.rpc('api_identity_verification_set_session', {
      p_attempt_id: attemptId,
      p_provider_session_id: providerSessionId,
    });
    if (error) throwRpcError(error);
  },
  provider: providerFromEnv(),
  report: (error, req) => reportError(error, { fn: 'identity-verification-session', req }),
})));
