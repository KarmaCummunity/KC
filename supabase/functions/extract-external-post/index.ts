// supabase/functions/extract-external-post/index.ts
// Wiring only: the logic and its tests are in handler.ts and _shared/post-extraction/.
// Edge secrets, by name: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
// GEMINI_API_KEY (EXTRACTION_PROVIDER, EXTRACTION_MODEL and EXTRACTION_DAILY_BUDGET are optional).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { reportError, withObservability } from '../_shared/observability/mod.ts';
import { rpcPlaceResolver } from '../_shared/post-extraction/catalog.ts';
import { DEFAULT_LIMITS } from '../_shared/post-extraction/limits.ts';
import { cachedLists, loadExtractionLists } from '../_shared/post-extraction/lists.ts';
import { providerFromEnv } from '../_shared/post-extraction/provider.ts';
import { supabaseExtractionCache, supabaseImportStore } from '../_shared/post-extraction/store.ts';
import { readEnv } from '../_shared/readEnv.ts';
import { authenticate } from './auth.ts';
import { createHandler } from './handler.ts';

const FLAG_KEY = 'external_post_import_enabled';

const service = createClient(readEnv('SUPABASE_URL'), readEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const dailyBudget = Number.parseInt(readEnv('EXTRACTION_DAILY_BUDGET', ''), 10);

Deno.serve(withObservability('extract-external-post', createHandler({
  authenticate,
  // A missing flag row means off: the feature is opt-in.
  isEnabled: async () => {
    const { data } = await service.from('app_flags').select('enabled').eq('key', FLAG_KEY).maybeSingle();
    return (data as { enabled: boolean } | null)?.enabled === true;
  },
  store: supabaseImportStore(service),
  cache: supabaseExtractionCache(service),
  loadLists: cachedLists(() => loadExtractionLists(service)),
  provider: providerFromEnv(),
  resolvePlace: rpcPlaceResolver(service),
  now: () => new Date(),
  report: (error, req) => reportError(error, { fn: 'extract-external-post', req }),
  limits: { ...DEFAULT_LIMITS, ...(Number.isFinite(dailyBudget) ? { dailyBudget } : {}) },
})));
