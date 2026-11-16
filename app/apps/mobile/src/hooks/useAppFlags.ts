// The one subscription to public.app_flags (feature flags, launch worlds, launch surfaces).
//
// Since the D-228 baseline the table is readable by signed-in members only (`app_flags_select_member`);
// `anon` gets "permission denied". So the read:
//   - waits for a signed-in member: before sign-in it would only fail, and
//   - is keyed by that member: a result read before sign-in (or as another member) must never serve
//     the next one. The old shared key `['app-flags']` kept the welcome screen's failed read as fresh
//     data for five minutes, so a member who had just signed in saw every launch world at its compiled
//     default, and rides (a launch world) showed as a portal.
// While nothing is loaded the hooks that read this return `undefined` and the compiled defaults apply.
import { useQuery } from '@tanstack/react-query';
import type { RemoteFeatureFlags } from '../config/featureFlags';
import { fetchRemoteFeatureFlags } from '../services/featureFlagsComposition';
import { useAuthStore } from '../store/authStore';

/** Root of the app-flags query key; a flag write invalidates it so every gate re-reads. */
export const APP_FLAGS_QUERY_ROOT = 'app-flags';
const APP_FLAGS_STALE_MS = 5 * 60 * 1000;

/** Remote flag values of the signed-in member; `undefined` while signed out, loading or offline. */
export function useAppFlags(): RemoteFeatureFlags | undefined {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const { data } = useQuery({
    queryKey: [APP_FLAGS_QUERY_ROOT, userId],
    queryFn: fetchRemoteFeatureFlags,
    enabled: userId !== null,
    staleTime: APP_FLAGS_STALE_MS,
  });
  return data;
}
