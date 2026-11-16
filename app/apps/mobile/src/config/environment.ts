// Single source for app-wide environment detection.
//
// Read lazily (per call) instead of caching at module load: keeps the
// helper trivially testable (no module-cache resets needed) and the cost
// of one process.env lookup per render is negligible.
//
// Fail-safe to "production": if the env var is missing or has an unknown
// value we treat it as prod. Better to under-warn than to over-warn a
// real production user.

export type AppEnvironment = 'development' | 'production';

export function getAppEnvironment(): AppEnvironment {
  const raw =
    typeof process !== 'undefined'
      ? process.env['EXPO_PUBLIC_ENVIRONMENT']
      : undefined;
  return raw === 'development' ? 'development' : 'production';
}

export function isDevEnvironment(): boolean {
  return getAppEnvironment() === 'development';
}

/**
 * True for any binary meant for a store track (TestFlight, Play internal or
 * the App Store / Play production), whatever its backend. Set by the eas.json
 * `nightly` and `production` profiles and re-pinned by
 * scripts/mobile-store-config.mjs on the store runners. Only the exact string
 * "true" counts; local Metro, the `development` / `preview` internal builds and
 * the web bundles leave it unset.
 */
export function isStoreBuild(): boolean {
  const raw =
    typeof process !== 'undefined'
      ? process.env['EXPO_PUBLIC_STORE_BUILD']
      : undefined;
  return raw === 'true';
}

/**
 * Whether the red DEV strip may render. Strict: never in a store build (App
 * Review and store users must not see it, even on the kc-dev nightly), and
 * otherwise only for an explicit development env or a Metro dev bundle.
 */
export function shouldShowDevBanner(input: {
  envDev: boolean;
  metroDev: boolean;
  storeBuild: boolean;
}): boolean {
  if (input.storeBuild) return false;
  return input.envDev || input.metroDev;
}

/**
 * Gates the dev preview route at `/dev/shell-preview`. Defaults ON in dev
 * (set EXPO_PUBLIC_SHELL_V2=0 to disable), always OFF in production.
 */
export const SHELL_V2_ENABLED: boolean =
  typeof __DEV__ !== 'undefined' &&
  __DEV__ &&
  !(typeof process !== 'undefined' && process.env['EXPO_PUBLIC_SHELL_V2'] === '0');
