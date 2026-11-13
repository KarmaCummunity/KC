// Shared Supabase client factory for integration suites (Node < 22 needs ws transport).

import { createClient } from '@supabase/supabase-js';

function realtimeOptions(): Record<string, unknown> {
  if (typeof globalThis.WebSocket !== 'undefined') return {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require('ws');
    return { transport: ws };
  } catch {
    return {};
  }
}

/**
 * A client that is not tied to one schema's generated types: the integration suites of every
 * package share it while they move from the old schema to the baseline one at a time.
 */
export function createIntegrationClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: realtimeOptions(),
  });
}
