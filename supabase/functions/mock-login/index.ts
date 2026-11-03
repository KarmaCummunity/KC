// mock-login — LOCAL DEV / E2E ONLY.
//
// POST /functions/v1/mock-login
// Mint a real Supabase session (same shape as signInWithPassword / OAuth completion)
// without Google OAuth. Returns 404 on any hosted Supabase project.
//
// Body: { userId?: string, email?: string, role?: "user" | "admin" }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';
import { isMockAuthEnvironment } from '../_shared/mockAuthGuard.ts';
import { ensureMockUser, MOCK_DEV_PASSWORD, type MockLoginInput } from './ensureUser.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function localDevCorsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...localDevCorsHeaders(origin),
    },
  });
}

function notFound(origin: string | null): Response {
  // Hide existence on non-local stacks (requirement §1).
  return json({ error: 'not_found' }, 404, origin);
}

serve(withObservability('mock-login', async (req) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: localDevCorsHeaders(origin) });
  }

  if (!isMockAuthEnvironment(SUPABASE_URL)) {
    return notFound(origin);
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, origin);
  }

  // Local stack only — reflect any browser origin (localhost, 127.0.0.1, ::1, LAN IP).

  let body: MockLoginInput = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400, origin);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let ensured;
  try {
    ensured = await ensureMockUser(admin, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ensure_user_failed';
    return json({ error: 'ensure_user_failed', message }, 500, origin);
  }

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email: ensured.email,
    password: MOCK_DEV_PASSWORD,
  });

  if (error || !data.session) {
    return json({ error: 'sign_in_failed', message: error?.message ?? 'no_session' }, 500, origin);
  }

  const session = data.session;
  const user = {
    id: session.user.id,
    name: ensured.displayName,
    email: session.user.email ?? ensured.email,
    type: body.role === 'admin' ? 'admin' : 'member',
    avatarUrl: '',
  };

  return json({ session, user }, 200, origin);
}));
