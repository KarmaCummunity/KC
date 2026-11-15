/**
 * PostHog product analytics — lazy init, no-op without EXPO_PUBLIC_POSTHOG_KEY.
 * Never identify with email/phone; only opaque user ids when already authenticated.
 */
import Constants from 'expo-constants';
import { getAppEnvironment } from '../../config/environment';

const KEY: string | undefined =
  (process.env.EXPO_PUBLIC_POSTHOG_KEY as string | undefined)?.trim() ||
  (Constants.expoConfig?.extra as { posthogKey?: string } | undefined)?.posthogKey?.trim();

const HOST: string =
  (process.env.EXPO_PUBLIC_POSTHOG_HOST as string | undefined)?.trim() ||
  'https://us.i.posthog.com';

type PostHogClient = {
  capture: (event: string, properties?: Record<string, unknown>) => void;
  screen: (name: string, properties?: Record<string, unknown>) => Promise<void>;
  identify: (distinctId: string, properties?: Record<string, unknown>) => void;
  register: (properties: Record<string, unknown>) => void;
  reset: () => void;
};

let client: PostHogClient | null = null;
let initialised = false;

export function hasPosthogKey(): boolean {
  return Boolean(KEY);
}

export async function initPosthog(): Promise<void> {
  if (initialised) return;
  if (!KEY) {
    if (__DEV__) console.warn('[observability] PostHog key missing — skipping init');
    return;
  }
  try {
    const { PostHog } = await import('posthog-react-native');
    client = new PostHog(KEY, {
      host: HOST,
      // Capture app lifecycle; screen tracking is opt-in via captureScreen().
      captureAppLifecycleEvents: true,
    }) as unknown as PostHogClient;
    // Super property so preview/nightly and production events can be
    // filtered in the single KC PostHog project (free plan = 1 project).
    // register() overwrites the key on every init, so a device that later
    // installs a production build does not keep a persisted 'development'.
    client.register({ environment: getAppEnvironment() });
    initialised = true;
  } catch (err) {
    if (__DEV__) console.warn('[observability] PostHog init failed', err);
  }
}

export function isPosthogInitialised(): boolean {
  return initialised && client != null;
}

export function getPosthogIfInit(): PostHogClient | null {
  return initialised ? client : null;
}

export function capturePosthog(
  event: string,
  properties?: Record<string, unknown>,
): void {
  const ph = getPosthogIfInit();
  if (!ph) return;
  try {
    ph.capture(event, properties);
  } catch {
    /* never break product flows */
  }
}

export async function captureScreen(
  name: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  const ph = getPosthogIfInit();
  if (!ph) return;
  try {
    await ph.screen(name, properties);
  } catch {
    /* ignore */
  }
}
