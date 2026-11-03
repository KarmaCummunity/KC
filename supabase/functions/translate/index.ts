// supabase/functions/translate/index.ts — FR-TRANSLATE-002 + KC batch (FR-TRANSLATE-006 port).
//
// POST single (legacy KC mobile):
//   { contentType, contentId, field, targetLanguage, sourceText } — JWT required.
// POST batch:
//   { targetLanguage, items:[{ contentType, contentId, field }] } — JWT required;
//   source rows read under caller RLS; cache writes via service role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { isSupportedTarget } from '../_shared/translation/supportedLanguages.ts';
import { getAuthedUser } from './auth.ts';
import { isValidSingle, translateSingle, type SingleBody } from './single.ts';
import { resolveBatch, type TranslateItem } from './resolveBatch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function json(body: unknown, status: number, h: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...h },
  });
}

function isItem(v: unknown): v is TranslateItem {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.contentType === 'string' && typeof o.contentId === 'string'
    && typeof o.field === 'string' && !!o.contentType && !!o.contentId && !!o.field;
}

function toBatch(raw: unknown): { targetLanguage: string; items: TranslateItem[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.targetLanguage !== 'string' || !o.targetLanguage) return null;
  if (Array.isArray(o.items)) {
    const items = o.items.filter(isItem);
    return items.length ? { targetLanguage: o.targetLanguage, items } : null;
  }
  return null;
}

function isLegacySingle(raw: unknown): raw is SingleBody {
  return isValidSingle(raw) && !Array.isArray((raw as unknown as Record<string, unknown>).items);
}

Deno.serve(withObservability('translate', async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return isAllowedOrigin(origin)
      ? new Response('ok', { status: 200, headers: corsHeaders(origin) })
      : json({ error: 'origin_not_allowed' }, 403);
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const hdrs = isAllowedOrigin(origin) ? corsHeaders(origin) : {};

  const authed = await getAuthedUser(req);
  if (!authed) return json({ error: 'unauthorized' }, 401, hdrs);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: 'invalid_body' }, 400, hdrs);
  }

  const batch = toBatch(raw);
  if (batch) {
    if (!isSupportedTarget(batch.targetLanguage)) {
      return json({ error: 'unsupported_language' }, 400, hdrs);
    }
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    try {
      const results = await resolveBatch(authed.userClient, svc, batch.targetLanguage, batch.items);
      return json({ results }, 200, hdrs);
    } catch (e) {
      await reportError(e, { fn: 'translate', req, tags: { mode: 'batch' } });
      return json({ error: 'internal' }, 500, hdrs);
    }
  }

  if (!isLegacySingle(raw)) return json({ error: 'invalid_body' }, 400, hdrs);
  if (!isSupportedTarget(raw.targetLanguage)) {
    return json({ error: 'unsupported_language' }, 400, hdrs);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  try {
    const out = await translateSingle(authed.userClient, svc, raw);
    return json(out, 200, hdrs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'forbidden') return json({ error: 'forbidden' }, 403, hdrs);
    if (msg === 'provider_failed') return json({ error: 'provider_failed' }, 502, hdrs);
    await reportError(e, { fn: 'translate', req, tags: { mode: 'single' } });
    return json({ error: 'internal' }, 500, hdrs);
  }
}));
