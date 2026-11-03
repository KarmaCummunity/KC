// supabase/functions/delete-account/index.ts
// Edge Function for FR-SETTINGS-012 — "delete my account".
//
// Deleting an account deactivates it for 30 days and can be undone by signing in again
// (ACCOUNT-RESTORE). This function only verifies the caller's JWT and calls
// `rpc_request_account_deletion()` with the caller's own client, so `auth.uid()` identifies
// the user. The hard delete after the grace period is `purge-deleted-accounts`.
//
// POST (no body) → 200 { ok: true, purge_at }
//                → 401 { ok: false, error: 'unauthenticated' }
//                → 403 { ok: false, error: 'suspended' }
//                → 500 { ok: false, error: 'db_failed' }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { CORS_HEADERS, jsonResponse } from './cors.ts';
import { getAuthedUser } from './auth.ts';
import { type Handler, reportError, withObservability } from '../_shared/observability/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const handler: Handler = async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'invalid_method' }, 405);

  const user = await getAuthedUser(req);
  if (!user) return jsonResponse({ ok: false, error: 'unauthenticated' }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: user.authHeader } },
    auth: { persistSession: false },
  });
  const { data: purgeAt, error } = await userClient.rpc('rpc_request_account_deletion');
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('suspended')) return jsonResponse({ ok: false, error: 'suspended' }, 403);
    if (msg.includes('unauthenticated')) return jsonResponse({ ok: false, error: 'unauthenticated' }, 401);
    await reportError(error, { fn: 'delete-account', req, tags: { stage: 'request_deletion' } });
    return jsonResponse({ ok: false, error: 'db_failed' }, 500);
  }

  return jsonResponse({ ok: true, purge_at: purgeAt }, 200);
};

serve(withObservability('delete-account', handler));
