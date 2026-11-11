// Shared Supabase client factory for integration suites (Node < 22 needs ws transport).

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../database.legacy.types';

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

export function createIntegrationClient(url: string, key: string) {
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: realtimeOptions(),
  });
}
