/**
 * Mapped to docs/superpowers/specs/2026-05-25-app-performance-overhaul-design.md § Wave 0.
 *
 * Single entry point for Sentry SDK init. Other code MUST NOT call Sentry.init
 * directly.
 *
 * The SDK module (`@sentry/react-native`, ~250 KB minified) is loaded LAZILY
 * via `import()` only when a DSN is actually configured. Without a DSN the
 * SDK never enters the bundle on first paint — important because:
 *   1. Dev builds currently ship without a DSN.
 *   2. Even in prod, deferring the SDK past first paint shaves cold-start time.
 *
 * `expo-constants` is loaded lazily too: this module sits behind every error
 * boundary (KC#1410), so its import graph must stay free of native modules
 * that cannot load outside the app runtime (jsdom tests, web SSR).
 */

type Env = 'dev' | 'prod';

/** Shape of `Constants.expoConfig` fields read here (kept local to avoid the eager import). */
type ExpoConfigLike = {
  extra?: { sentryDsn?: string };
  updates?: { requestHeaders?: Record<string, string> };
};

/**
 * DSN from the build-time env var, else from `app.config` extra.
 * `||` (not `??`) on purpose: CI exports an unset repo variable as an EMPTY
 * string, which must fall through to the config default instead of silently
 * disabling Sentry for the whole build.
 */
export function resolveDsn(config: ExpoConfigLike | undefined): string | undefined {
  const fromEnv = (process.env.EXPO_PUBLIC_SENTRY_DSN as string | undefined)?.trim();
  return fromEnv || config?.extra?.sentryDsn?.trim() || undefined;
}

/**
 * Environment comes from the EAS build profile (eas.json sets
 * EXPO_PUBLIC_ENVIRONMENT=production only on the `production` profile),
 * falling back to the EAS Update channel. Everything else reports as `dev`.
 */
function detectEnv(config: ExpoConfigLike | undefined): Env {
  const profileEnv = process.env.EXPO_PUBLIC_ENVIRONMENT;
  if (profileEnv) return profileEnv === 'production' ? 'prod' : 'dev';
  const channel = config?.updates?.requestHeaders?.['expo-channel-name'];
  return channel === 'production' ? 'prod' : 'dev';
}

let initialised = false;
let sentryModule: typeof import('@sentry/react-native') | null = null;

export async function initSentry(): Promise<void> {
  if (initialised) return;
  try {
    const { default: Constants } = await import('expo-constants');
    const config = Constants.expoConfig as ExpoConfigLike | undefined;
    const dsn = resolveDsn(config);
    if (!dsn) {
      if (__DEV__) console.warn('[observability] Sentry DSN missing — skipping init');
      return;
    }
    const mod = await import('@sentry/react-native');
    const env = detectEnv(config);
    mod.init({
      dsn,
      environment: env,
      enableAutoSessionTracking: true,
      // Free-tier Sentry quota: keep prod tracing <= 0.1 (shared-dev conventions).
      tracesSampleRate: env === 'prod' ? 0.1 : 1.0,
      enableNativeFramesTracking: true,
    });
    sentryModule = mod;
    initialised = true;
  } catch (err) {
    if (__DEV__) console.warn('[observability] Sentry init failed', err);
  }
}

export function isInitialised(): boolean {
  return initialised;
}

export function getSentryIfInit(): typeof import('@sentry/react-native') | null {
  return initialised ? sentryModule : null;
}
