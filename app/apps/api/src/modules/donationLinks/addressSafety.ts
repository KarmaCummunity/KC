// Which addresses the server may fetch on a member's behalf.
//
// A member types the address of a donation page and the server checks that it
// answers. A server that fetches what a member typed must never become a way
// to reach its own network: cloud metadata, loopback, private ranges. These
// checks need no network; `reachability.ts` adds the DNS and redirect checks.
// Ported from `supabase/functions/validate-donation-link/ssrf.ts` and
// `dnsGuard.ts` (TD-79 / TD-82) with the same rules and the same tests.

const ALLOWED_PORTS = new Set(['', '80', '443']);

/** Names (lower case, exact) of loopback and cloud-metadata endpoints. */
const FORBIDDEN_HOSTNAMES = new Set([
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
  // Dotted quad of four decimal octets only; octal and hex spellings are not addresses here.
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const [a, b, c, d] = match.slice(1).map(Number) as [number, number, number, number];
  if (a > 255 || b > 255 || c > 255 || d > 255) return true;
  if (a === 0) return true; // 0.0.0.0/8, "this network"
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT (RFC 6598)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  return a >= 224; // multicast and reserved
}

/**
 * The IPv4 address inside an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`), or null.
 * `new URL()` rewrites the dotted form to hex (`[::ffff:127.0.0.1]` becomes
 * `[::ffff:7f00:1]`) and a resolver may answer in either form, so both are decoded.
 * Accepts the address with or without brackets.
 */
export function ipv4FromMappedIPv6(address: string): string | null {
  const bare = (address.replace(/^\[|\]$/g, '').split('%')[0] ?? '').toLowerCase();
  const mapped = /^(?:::|0:0:0:0:0:)ffff:(.+)$/.exec(bare)?.[1];
  if (mapped === undefined) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(mapped)) return mapped;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped);
  if (!hex) return null;
  const high = parseInt(hex[1] as string, 16);
  const low = parseInt(hex[2] as string, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** True for an IPv6 literal (bracketed or not) in a loopback, link-local, unique-local, multicast or v4-mapped-private range. */
export function isPrivateIPv6Literal(host: string): boolean {
  // `URL.hostname` wraps IPv6 in brackets; a zone id (`%eth0`) is not part of the address.
  const bare = (host.replace(/^\[|\]$/g, '').split('%')[0] ?? '').toLowerCase();
  if (bare === '::' || bare === '::1') return true;
  if (/^fe[89ab]/.test(bare)) return true; // fe80::/10 link-local
  if (bare.startsWith('fc') || bare.startsWith('fd')) return true; // fc00::/7 unique-local
  if (bare.startsWith('ff')) return true; // multicast
  const mapped = ipv4FromMappedIPv6(bare);
  return mapped !== null && isPrivateIPv4(mapped);
}

/** Port and host-name checks that need no network: the first gate, and the gate of every redirect hop. */
export function isSafeHost(url: URL): { ok: true } | { ok: false; reason: string } {
  if (!ALLOWED_PORTS.has(url.port)) return { ok: false, reason: `port_not_allowed:${url.port}` };
  const host = url.hostname.toLowerCase();
  if (!host || host.length > 253) return { ok: false, reason: 'hostname_invalid' };
  if (FORBIDDEN_HOSTNAMES.has(host)) return { ok: false, reason: 'hostname_forbidden' };
  if (isPrivateIPv4(host)) return { ok: false, reason: 'ipv4_private' };
  if (isPrivateIPv6Literal(host)) return { ok: false, reason: 'ipv6_private' };
  return { ok: true };
}

/** The URL when `raw` is an http(s) address string, else null. */
export function parseUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return URL.canParse(trimmed) ? new URL(trimmed) : null;
}
