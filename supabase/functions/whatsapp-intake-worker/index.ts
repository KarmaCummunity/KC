// whatsapp-intake-worker — Issue #844 (stub LLM extraction → api_* publish path), #938 LLM budget

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';
import { isServiceRoleRequest, serviceRoleRequiredResponse } from '../_shared/serviceRoleGuard.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type IntakeRequest = {
  record_id?: string;
  wa_id?: string;
  owner_id?: string;
  /** Free-text body (production: LLM output shape) */
  extraction?: {
    world_slug: string;
    kind_slug: string;
    direction: 'give' | 'request';
    title: string;
    summary?: string;
    details?: Record<string, unknown>;
    confidence?: number;
  };
  confirm_publish?: boolean;
};

serve(withObservability('whatsapp-intake-worker', async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!isServiceRoleRequest(req, SERVICE_KEY)) return serviceRoleRequiredResponse();

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = (await req.json().catch(() => ({}))) as IntakeRequest;

  const waId = body.wa_id ?? 'stub-wa-id';
  const recordId = body.record_id;
  if (!recordId) {
    return new Response(JSON.stringify({ ok: false, error: 'record_id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: sessionId, error: sessErr } = await supabase.rpc('api_bot_open_session', {
    p_wa_id: waId,
    p_record_id: recordId,
  });
  if (sessErr) {
    return new Response(JSON.stringify({ ok: false, error: sessErr.message }), { status: 500 });
  }

  // #938: no LLM call beyond the per-phone / global daily budget. A caller-supplied
  // extraction skips the LLM entirely, so only the LLM path is metered.
  if (!body.extraction) {
    const { data: allowed, error: budgetErr } = await supabase.rpc('api_whatsapp_llm_budget_take', {
      p_wa_id: waId,
    });
    if (budgetErr) {
      return new Response(JSON.stringify({ ok: false, error: budgetErr.message }), { status: 500 });
    }
    if (allowed === false) {
      return new Response(JSON.stringify({ ok: false, error: 'llm_budget_exceeded', session_id: sessionId }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const ext = body.extraction ?? {
    world_slug: 'time',
    kind_slug: 'volunteer_shift',
    direction: 'give' as const,
    title: 'WhatsApp intake stub',
    confidence: 0.9,
    details: {},
  };

  const { data: extractionId, error: extErr } = await supabase.rpc('api_bot_apply_extraction', {
    p_session_id: sessionId,
    p_world_slug: ext.world_slug,
    p_kind_slug: ext.kind_slug,
    p_direction: ext.direction,
    p_title: ext.title,
    p_details: ext.details ?? {},
    p_confidence: ext.confidence ?? 0.9,
    p_summary: ext.summary ?? null,
  });
  if (extErr) {
    return new Response(JSON.stringify({ ok: false, error: extErr.message }), { status: 500 });
  }

  let listingId: string | null = null;
  if (body.confirm_publish && body.owner_id) {
    const { data: lid, error: pubErr } = await supabase.rpc('api_bot_publish_listing', {
      p_session_id: sessionId,
      p_owner_id: body.owner_id,
    });
    if (pubErr) {
      return new Response(JSON.stringify({ ok: false, error: pubErr.message }), { status: 500 });
    }
    listingId = lid as string;

    const { error: matchErr } = await supabase.rpc('api_bot_find_matches', {
      p_owner_id: body.owner_id,
      p_listing_id: listingId,
      p_limit: 10,
    });
    if (matchErr) {
      return new Response(JSON.stringify({ ok: false, error: matchErr.message }), { status: 500 });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, session_id: sessionId, extraction_id: extractionId, listing_id: listingId }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}));
