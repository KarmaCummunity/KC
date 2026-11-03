// _shared/ssrfGuard.ts — outbound-fetch guard for Edge Functions that fetch user-supplied URLs.
// Pure (no Deno / network imports) so it is unit-testable; the DNS resolver is injected.
//
// Layers, applied by `checkUrlSafe` before every fetch (and on every redirect hop):
//   1. Port allow-list.
//   2. Hostname deny-list + IP-literal check (IPv4 and IPv6, including IPv4-mapped IPv6).
//   3. DNS resolution check: a public-looking name that resolves to a private, loopback
//      or link-local address (DNS pointing at cloud metadata, rebinding setups) is rejected.
//
// Residual risk: the fetch performs its own lookup, so a name that answers differently
// between our lookup and the fetch can still slip through (TOCTOU). Closing that needs
// connecting to the pinned IP, which the Deno `fetch` API does not expose.

export type SafetyResult = { ok: true } | { ok: false; reason: string };

/** Resolves a hostname to its A and AAAA addresses. Must throw / return [] when it cannot. */
export type ResolveAddresses = (host: string) => Promise<string[]>;

const ALLOWED_PORTS = new Set(['', '80', '443']);

// Well-known metadata / loopback names (lowercase, exact match).
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

/** True for a dotted-quad IPv4 in a private, loopback, link-local, CGNAT, multicast or reserved range. */
export function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if (a > 255 || b > 255 || c > 255 || d > 255) return true; // malformed: fail closed
  if (a === 0 || a === 10 || a === 127) return true; // this-network, 10/8, loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  return a >= 224; // multicast + reserved
}

/** Parses the tail of an IPv4-mapped IPv6 address (`::ffff:`) into a dotted quad, or null. */
function mappedIPv4(h: string): string | null {
  const m = h.match(/^(?:::|0:0:0:0:0:)ffff:(.+)$/);
  if (!m) return null;
  const tail = m[1];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return tail;
  // `new URL()` normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1 — decode the two hex groups.
  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True for an IPv6 literal (brackets optional) that is loopback, link-local, ULA, multicast or maps to a private IPv4. */
export function isPrivateIPv6(host: string): boolean {
  let h = host;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  h = h.split('%')[0].toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (/^fe[89ab]/.test(h)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(h)) return true; // fc00::/7 unique-local
  if (h.startsWith('ff')) return true; // multicast
  const v4 = mappedIPv4(h);
  return v4 !== null && isPrivateIPv4(v4);
}

/** Synchronous checks: port, hostname deny-list and IP literals. */
export function isSafeHost(url: URL): SafetyResult {
  if (!ALLOWED_PORTS.has(url.port)) return { ok: false, reason: `port_not_allowed:${url.port}` };
  const host = url.hostname.toLowerCase();
  if (!host || host.length > 253) return { ok: false, reason: 'hostname_invalid' };
  if (FORBIDDEN_HOSTNAMES.has(host)) return { ok: false, reason: 'hostname_forbidden' };
  if (isPrivateIPv4(host)) return { ok: false, reason: 'ipv4_private' };
  if (isPrivateIPv6(host)) return { ok: false, reason: 'ipv6_private' };
  return { ok: true };
}

/** True when `host` is an IP literal (v4 or bracketed v6), so DNS resolution is not needed. */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
}

/**
 * Full check: `isSafeHost` plus DNS resolution. Fails closed — a name that does not resolve,
 * or any of whose addresses is private, is rejected. When the runtime offers no resolver
 * (`resolve` undefined) only the synchronous checks apply.
 */
export async function checkUrlSafe(url: URL, resolve?: ResolveAddresses): Promise<SafetyResult> {
  const sync = isSafeHost(url);
  if (!sync.ok) return sync;
  const host = url.hostname.toLowerCase();
  if (!resolve || isIpLiteral(host)) return { ok: true };
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, reason: 'dns_failed' };
  }
  if (addresses.length === 0) return { ok: false, reason: 'dns_empty' };
  for (const address of addresses) {
    if (isPrivateIPv4(address) || isPrivateIPv6(address)) {
      return { ok: false, reason: 'resolves_to_private' };
    }
  }
  return { ok: true };
}
