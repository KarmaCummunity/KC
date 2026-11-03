// Chat images live in the private `chat-media` bucket (#1064): only people who can see
// the chat may read them, so each image is shown through a short-lived signed URL.
// URLs are cached per object path until shortly before they expire, and concurrent
// requests for the same path share one Storage call (a chat renders many bubbles).
import { getSupabaseClient } from '@kc/infrastructure-supabase';

const BUCKET = 'chat-media';
/** Lifetime requested for each signed URL. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;
/** A cached URL is renewed this long before it expires, so a rendered image never 403s. */
const RENEW_BEFORE_MS = 5 * 60 * 1000;

/** Creates a signed URL for `path` that lives `ttlSeconds`; null when Storage refuses. */
export type SignChatMediaPath = (path: string, ttlSeconds: number) => Promise<string | null>;

const signWithSupabase: SignChatMediaPath = async (path, ttlSeconds) => {
  const { data, error } = await getSupabaseClient().storage.from(BUCKET).createSignedUrl(path, ttlSeconds);
  return error ? null : (data?.signedUrl ?? null);
};

interface CachedUrl {
  readonly url: string;
  readonly expiresAt: number;
}

/** Builds a resolver with its own cache; the app uses the default instance below. */
export function createChatMediaUrlResolver(sign: SignChatMediaPath = signWithSupabase, now: () => number = Date.now) {
  const cache = new Map<string, CachedUrl>();
  const inFlight = new Map<string, Promise<string | null>>();

  const request = async (path: string): Promise<string | null> => {
    try {
      const url = await sign(path, SIGNED_URL_TTL_SECONDS);
      if (url) cache.set(path, { url, expiresAt: now() + SIGNED_URL_TTL_SECONDS * 1000 });
      return url;
    } catch {
      // A network or Storage failure shows the image placeholder; the next render retries.
      return null;
    } finally {
      inFlight.delete(path);
    }
  };

  /** Returns a signed URL for a chat image path, or null when it cannot be read. */
  return function resolveChatMediaUrl(path: string): Promise<string | null> {
    const cached = cache.get(path);
    if (cached && cached.expiresAt - now() > RENEW_BEFORE_MS) return Promise.resolve(cached.url);
    const pending = inFlight.get(path) ?? request(path);
    inFlight.set(path, pending);
    return pending;
  };
}

export const resolveChatMediaUrl = createChatMediaUrlResolver();

/** The Storage path of an image message's payload, or null for any other media payload. */
export function chatImagePath(payload: Record<string, unknown> | null): string | null {
  if (payload?.type !== 'image') return null;
  return typeof payload.path === 'string' && payload.path.length > 0 ? payload.path : null;
}
