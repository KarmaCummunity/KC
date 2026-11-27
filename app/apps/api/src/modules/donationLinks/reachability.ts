import { resolve4, resolve6 } from 'node:dns/promises';
import { isPrivateIPv4, isPrivateIPv6Literal, isSafeHost } from './addressSafety';

const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECT_HOPS = 3;

/** Resolves one record type; returns [] when the name has no such record. */
export type ResolveRecords = (host: string, type: 'A' | 'AAAA') => Promise<string[]>;

/** DNS answers that mean "this name has no record of this type", as opposed to "the lookup failed". */
const NO_RECORD = new Set(['ENOTFOUND', 'ENODATA']);

/** The system resolver. A lookup that fails for any other reason rejects, and the caller fails closed. */
export const systemResolve: ResolveRecords = async (host, type) => {
  try {
    return await (type === 'A' ? resolve4(host) : resolve6(host));
  } catch (error) {
    if (NO_RECORD.has((error as { code?: string }).code ?? '')) return [];
    throw error;
  }
};

/**
 * True when `host` resolves to at least one address and every address is
 * public. A failed lookup and an empty answer are both false (fail closed).
 */
export async function resolvesOnlyToPublic(host: string, resolve: ResolveRecords): Promise<boolean> {
  try {
    const [v4, v6] = await Promise.all([resolve(host, 'A'), resolve(host, 'AAAA')]);
    if (v4.length + v6.length === 0) return false;
    return !v4.some(isPrivateIPv4) && !v6.some(isPrivateIPv6Literal);
  } catch {
    return false;
  }
}

/** IP literals were already checked by `isSafeHost`; names must resolve to public addresses only. */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');
}

function hostResolvesToPublic(hostname: string, resolve: ResolveRecords): Promise<boolean> {
  const host = hostname.toLowerCase();
  return isIpLiteral(host) ? Promise.resolve(true) : resolvesOnlyToPublic(host, resolve);
}

/** What one request to an address showed. */
type Probe = { kind: 'redirect'; next: URL } | { kind: 'status'; status: number } | { kind: 'failed' };

/** Sends one request without following redirects; a redirect is reported with its resolved target. */
async function probe(url: URL, method: 'HEAD' | 'GET', fetchFn: typeof fetch): Promise<Probe> {
  try {
    const response = await fetchFn(url.toString(), {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // A browser-like request: many donation pages refuse an unknown client outright.
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    if (response.status < 300 || response.status >= 400) return { kind: 'status', status: response.status };
    // `Location` may be relative; a missing or non-http(s) target is a failed probe.
    const location = response.headers.get('location');
    const next = location ? new URL(location, url) : null;
    return next && /^https?:$/i.test(next.protocol) ? { kind: 'redirect', next } : { kind: 'failed' };
  } catch {
    // Network error, DNS failure, timeout or an unparsable Location.
    return { kind: 'failed' };
  }
}

/**
 * True when the address answers. Redirects are followed by hand and the
 * destination is validated again at every hop: `redirect: 'follow'` would let
 * a 302 to `http://169.254.169.254/latest/meta-data/` escape the first check.
 * Any status but a redirect or 404 counts as reachable: anti-bot walls often
 * answer 401, 403 or 503 for a legitimate site. HEAD is tried first, then GET.
 */
export async function checkReachable(initial: URL, fetchFn: typeof fetch = fetch, resolve: ResolveRecords = systemResolve): Promise<boolean> {
  let url = initial;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    if (!isSafeHost(url).ok) return false;
    if (!(await hostResolvesToPublic(url.hostname, resolve))) return false;
    let result = await probe(url, 'HEAD', fetchFn);
    // A HEAD that failed or found nothing is retried as GET, which some servers answer differently.
    if (result.kind === 'failed' || (result.kind === 'status' && result.status === 404)) {
      result = await probe(url, 'GET', fetchFn);
    }
    if (result.kind === 'status') return result.status !== 404;
    if (result.kind === 'failed') return false;
    url = result.next;
  }
  return false;
}
