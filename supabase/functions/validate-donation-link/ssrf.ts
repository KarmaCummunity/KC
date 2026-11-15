// validate-donation-link/ssrf.ts
//
// The server-side reachability check of a member-supplied address, hardened against SSRF
// (TD-79 / TD-82): the function fetches a URL a member typed, so it must never become a
// port scanner over the Edge network or follow a redirect into cloud-metadata or private
// address space. Defense in depth, three layers:
//   1. Port allow-list (80 / 443 / default) before any DNS work.
//   2. Hostname allow-list rejecting cloud-metadata names and IP-literal
//      private / loopback / link-local ranges (IPv4 + IPv6).
//   3. Redirects are followed by hand, and the destination is re-validated at every hop
//      instead of trusting `redirect: 'follow'`.
import { denoResolve, ipv4FromMappedIPv6, type ResolveRecords, resolvesOnlyToPublic } from './dnsGuard.ts';

const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECT_HOPS = 3;

const ALLOWED_PORTS = new Set(['', '80', '443']);

// Forbidden hostnames (lowercase exact match). The metadata names cover the
// well-known cloud IMDS / metadata endpoints that an SSRF would target.
const FORBIDDEN_HOSTNAMES = new Set<string>([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.azure.com',
  'instance-data',
  'instance-data.ec2.internal',
]);

/** True for a dotted-quad address in a private, loopback, link-local, reserved or malformed range. */
export function isPrivateIPv4(host: string): boolean {
  // Accept dotted-quad only; ignore octal/hex tricks by requiring 4 decimal octets.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return true;
  // 0.0.0.0/8 — "this network".
  if (a === 0) return true;
  // 10/8
  if (a === 10) return true;
  // 127/8 loopback
  if (a === 127) return true;
  // 169.254/16 link-local + AWS / GCP metadata
  if (a === 169 && b === 254) return true;
  // 172.16/12 — 172.16..172.31
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168/16
  if (a === 192 && b === 168) return true;
  // 100.64/10 carrier-grade NAT (RFC6598)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 198.18/15 benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0/4 multicast, 240.0/4 reserved
  if (a >= 224) return true;
  return false;
}

/** True for an IPv6 literal (bracketed or not) in a loopback, link-local, unique-local, multicast or v4-mapped-private range. */
export function isPrivateIPv6Literal(host: string): boolean {
  // URL.hostname returns IPv6 wrapped in brackets — strip them.
  let h = host;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  // Normalize: remove zone id (`%eth0`), lowercase.
  h = h.split('%')[0].toLowerCase();
  if (h === '::' || h === '::1') return true;
  // fe80::/10 link-local
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true;
  // fc00::/7 unique-local (fc00..fdff)
  if (h.startsWith('fc') || h.startsWith('fd')) return true;
  // ff00::/8 multicast
  if (h.startsWith('ff')) return true;
  // IPv4-mapped IPv6 (dotted or the hex form `new URL()` produces) — check the embedded IPv4.
  const mapped = ipv4FromMappedIPv6(h);
  return mapped !== null && isPrivateIPv4(mapped);
}

/** Port and host-name checks that need no network: the first gate, and the gate of every redirect hop. */
export function isSafeHost(url: URL): { ok: true } | { ok: false; reason: string } {
  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: `port_not_allowed:${url.port}` };
  }
  const host = url.hostname.toLowerCase();
  if (!host || host.length > 253) return { ok: false, reason: 'hostname_invalid' };
  if (FORBIDDEN_HOSTNAMES.has(host)) return { ok: false, reason: 'hostname_forbidden' };
  if (isPrivateIPv4(host)) return { ok: false, reason: 'ipv4_private' };
  if (isPrivateIPv6Literal(host)) return { ok: false, reason: 'ipv6_private' };
  return { ok: true };
}

/** IP literals were already checked by isSafeHost; names must resolve to public addresses only. */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');
}

/** True when the host is an IP literal already cleared by isSafeHost, or a name resolving only to public addresses. */
function hostResolvesToPublic(hostname: string, resolve: ResolveRecords): Promise<boolean> {
  const host = hostname.toLowerCase();
  if (isIpLiteral(host)) return Promise.resolve(true);
  return resolvesOnlyToPublic(host, resolve, {
    isPrivateIPv4,
    isPrivateIPv6: isPrivateIPv6Literal,
  });
}

/** The URL when `raw` is an http(s) address string, else null. */
export function parseUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

/** What one request to an address showed. */
type Probe = { kind: 'redirect'; next: URL } | { kind: 'status'; status: number } | { kind: 'failed' };

/** Sends one request without following redirects; a redirect is reported with its resolved target. */
async function probe(url: URL, method: 'HEAD' | 'GET', fetchFn: typeof fetch): Promise<Probe> {
  try {
    const resp = await fetchFn(url.toString(), {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    if (resp.status < 300 || resp.status >= 400) return { kind: 'status', status: resp.status };
    // `Location` may be relative; a missing or non-http(s) target is a failed probe.
    const location = resp.headers.get('location');
    const next = location ? new URL(location, url) : null;
    return next && /^https?:$/i.test(next.protocol) ? { kind: 'redirect', next } : { kind: 'failed' };
  } catch {
    // Network error, DNS failure, timeout or an unparsable Location.
    return { kind: 'failed' };
  }
}

/**
 * True when the address answers. Redirects are followed by hand and the destination is
 * re-validated at every hop: `redirect: 'follow'` would let a 302 to
 * `http://169.254.169.254/latest/meta-data/` escape the first isSafeHost check.
 * Any non-redirect, non-404 status counts as reachable: Cloudflare and anti-bot walls
 * often answer 401 / 403 / 503 for legitimate sites. HEAD is tried first, then GET.
 */
export async function checkReachable(
  initial: URL,
  fetchFn: typeof fetch = fetch,
  resolve: ResolveRecords = denoResolve,
): Promise<boolean> {
  let url = initial;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
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
  // Exceeded MAX_REDIRECT_HOPS.
  return false;
}
