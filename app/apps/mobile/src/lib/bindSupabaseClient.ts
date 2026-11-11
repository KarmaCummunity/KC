import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@kc/infrastructure-supabase';

const MISSING =
  'Supabase configuration missing: both EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set.';

/**
 * Builds the app Supabase client only when public env is present.
 * A missing build-time env must not throw while the root module graph loads —
 * that crash closed the Android process before `ConfigErrorScreen` could paint
 * (#1944). Touching the placeholder still throws, so a misconfigured tree cannot
 * talk to a fake host.
 */
export function bindSupabaseClient<D = Database>(
  configured: boolean,
  create: () => SupabaseClient<D>,
): SupabaseClient<D> {
  if (configured) return create();
  return new Proxy({} as SupabaseClient<D>, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      throw new Error(MISSING);
    },
  });
}
