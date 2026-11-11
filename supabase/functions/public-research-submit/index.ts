// public-research-submit — anonymous gateway for the public research survey (FR-RESEARCH-002).
// Wiring only: the logic is in handler.ts. The questions, the salt and the response go through
// the service-role RPCs get_public_research_questions(), get_research_salt() and
// submit_public_research_response().
//
// POST { action: 'questions', slug }
//   → 200 { slug, title_he, description_he, version, questions } · 400 { error: 'survey_not_found' }
// POST { slug, version, source?, answers, honeypot, contactEmail?, contactWindowHe? }
//   → 200 { responseId }
//   → 400 { error: 'invalid_body' | 'survey_not_found' }   → 403 { error: 'origin_not_allowed' }
//   → 405 { error: 'method_not_allowed' }                   → 429 { error: 'rate_limited', period }
//   → 500 { error: 'salt_missing' | 'internal' }            → 503 { error: 'circuit_open' }
// Secrets (names): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Config: PUBLIC_RESEARCH_ALLOWED_ORIGINS.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { createResearchHandler } from './handler.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false },
});

Deno.serve(withObservability('public-research-submit', createResearchHandler({
  async loadQuestions(slug) {
    const { data, error } = await admin.rpc('get_public_research_questions', { p_slug: slug });
    if (error) throw error;
    return data;
  },
  async getSalt() {
    const { data, error } = await admin.rpc('get_research_salt');
    if (error || typeof data !== 'string') throw error ?? new Error('salt_missing');
    return data;
  },
  async submit(args) {
    const { data, error } = await admin.rpc('submit_public_research_response', args);
    if (error) throw new Error(error.message);
    return String(data);
  },
  report: (error) => reportError(error, { fn: 'public-research-submit' }),
})));
