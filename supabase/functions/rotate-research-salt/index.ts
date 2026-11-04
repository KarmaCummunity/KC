// rotate-research-salt — FR-RESEARCH-002 AC3 (salt rotation)
//
// Replaces the daily_research_salt in research_secrets with 32 fresh random bytes.
// Intended to be invoked daily at 00:00 UTC via a Supabase scheduled function
// (Dashboard → Edge Functions → Schedule). No migration wires this automatically;
// the operator must set up the cron trigger manually per OPERATOR_RUNBOOK.md.
//
// See docs/SSOT/OPERATOR_RUNBOOK.md §"Daily salt rotation" for setup instructions.
//
// POST (no body required)
//   Auth: Bearer <service_role_jwt>  OR  X-Rotation-Secret: <RESEARCH_SALT_ROTATION_SECRET>
//   → 200 { rotated_at: ISO-timestamp }
//   → 401 { error: 'unauthorized' }
//   → 405 { error: 'method_not_allowed' }
//   → 500 { error: 'internal' }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('EXPO_PUBLIC_SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ROTATION_SECRET = Deno.env.get('RESEARCH_SALT_ROTATION_SECRET') ?? '';
const SALT_KEY = 'daily_research_salt';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function generateSaltHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Auth check
// ---------------------------------------------------------------------------

function isAuthorized(req: Request): boolean {
  // Option 1: shared rotation secret header (for scheduler / cron invocations)
  if (ROTATION_SECRET) {
    const headerSecret = req.headers.get('x-rotation-secret') ?? '';
    if (headerSecret === ROTATION_SECRET) return true;
  }

  // Option 2: service_role JWT in Authorization header
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return false;

  const token = authHeader.slice('Bearer '.length).trim();
  // service_role key itself is accepted as a bearer (Supabase convention)
  if (token === SERVICE_ROLE_KEY) return true;

  // Validate as a Supabase JWT — check role claim
  try {
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return false;
    const payload = JSON.parse(atob(payloadB64));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(withObservability('rotate-research-salt', async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (!isAuthorized(req)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const newSalt = generateSaltHex();
  const rotatedAt = new Date().toISOString();

  const { error } = await supa
    .from('research_secrets')
    .update({ value: newSalt, rotated_at: rotatedAt })
    .eq('key', SALT_KEY);

  if (error) {
    await reportError(error, { fn: 'rotate-research-salt', req });
    return json({ error: 'internal' }, 500);
  }

  console.log('[rotate-research-salt] salt rotated at', rotatedAt);
  return json({ rotated_at: rotatedAt }, 200);
}));
