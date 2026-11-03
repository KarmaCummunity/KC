// embed-worker — Issue #827
// Drains embedding_jobs (service-role/cron). Placeholder embedder until provider wired.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { withObservability } from '../_shared/observability/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isServiceRoleJwt(bearer: string): boolean {
  if (!bearer.startsWith('Bearer ')) return false;
  const token = bearer.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

/** Deterministic stub vector from text (not for production ranking quality). */
function stubEmbed(text: string, dims = 1536): number[] {
  const out = new Array<number>(dims).fill(0);
  for (let i = 0; i < text.length; i++) {
    out[i % dims] += text.charCodeAt(i) / 1000;
  }
  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
  return out.map((v) => v / norm);
}

serve(withObservability('embed-worker', async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  if (!isServiceRoleJwt(auth)) {
    return json({ ok: false, error: 'unauthenticated' }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const limit = Math.min(Number((await req.json().catch(() => ({}))).limit) || 20, 50);

  const { data: jobs, error: fetchErr } = await supabase
    .from('embedding_jobs')
    .select('job_id, listing_id, model, listings(title, summary, details)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (fetchErr) return json({ ok: false, error: fetchErr.message }, 500);
  if (!jobs?.length) return json({ ok: true, processed: 0 });

  let processed = 0;
  for (const job of jobs) {
    const listing = (job as unknown as { listings: { title: string; summary: string | null; details: unknown } })
      .listings;
    const text = [listing.title, listing.summary ?? '', JSON.stringify(listing.details ?? {})]
      .join('\n')
      .slice(0, 8000);
    const vector = stubEmbed(text);

    await supabase.from('embedding_jobs').update({ status: 'processing' }).eq('job_id', job.job_id);

    const { error: upErr } = await supabase
      .from('listings')
      .update({ embedding: vector, embedding_model: job.model ?? 'stub-v1' })
      .eq('listing_id', job.listing_id);

    if (upErr) {
      await supabase
        .from('embedding_jobs')
        .update({ status: 'failed', error_message: upErr.message, attempts: 1 })
        .eq('job_id', job.job_id);
      continue;
    }

    await supabase
      .from('embedding_jobs')
      .update({ status: 'done', error_message: null })
      .eq('job_id', job.job_id);
    processed += 1;
  }

  return json({ ok: true, processed });
}));
