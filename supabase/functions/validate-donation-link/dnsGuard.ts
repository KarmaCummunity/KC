// validate-donation-link/dnsGuard.ts
//
// Address check for hostnames: every A / AAAA record a host resolves to must
// be a public address before the function fetches it. Complements the
// literal-address checks in index.ts, which only see what the URL spells.

/** Resolves one record type; returns [] when the name has no such record. */
export type ResolveRecords = (host: string, type: 'A' | 'AAAA') => Promise<string[]>;

export interface AddressPredicates {
  isPrivateIPv4: (address: string) => boolean;
  isPrivateIPv6: (address: string) => boolean;
}

/** Thrown when the runtime offers no DNS API, so the check cannot run at all. */
export class DnsUnavailableError extends Error {}

/** Deno's resolver, treating "no records of this type" as an empty answer. */
export const denoResolve: ResolveRecords = async (host, type) => {
  if (typeof Deno.resolveDns !== 'function') throw new DnsUnavailableError('Deno.resolveDns unavailable');
  try {
    return await Deno.resolveDns(host, type);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    if (err instanceof Deno.errors.PermissionDenied || err instanceof Deno.errors.NotSupported) {
      throw new DnsUnavailableError(String(err));
    }
    throw err;
  }
};

/**
 * True when `host` resolves to at least one address and every address is
 * public. Resolution failures and empty answers return false (fail closed).
 * If the runtime has no usable DNS API the check is skipped (returns true,
 * with a warning) so the literal-address checks still apply and valid links
 * keep working.
 */
export async function resolvesOnlyToPublic(
  host: string,
  resolve: ResolveRecords,
  predicates: AddressPredicates,
): Promise<boolean> {
  try {
    const [v4, v6] = await Promise.all([resolve(host, 'A'), resolve(host, 'AAAA')]);
    if (v4.length + v6.length === 0) return false;
    return !v4.some(predicates.isPrivateIPv4) && !v6.some(predicates.isPrivateIPv6);
  } catch (err) {
    if (err instanceof DnsUnavailableError) {
      console.warn('[validate-donation-link] DNS address check skipped:', err.message);
      return true;
    }
    return false;
  }
}

/**
 * The IPv4 address embedded in an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`), or null.
 * `new URL()` rewrites the dotted form to hex (`[::ffff:127.0.0.1]` becomes
 * `[::ffff:7f00:1]`) and a resolver may answer in either form, so both are decoded.
 * Accepts the address with or without brackets.
 */
export function ipv4FromMappedIPv6(address: string): string | null {
  const h = address.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const m = h.match(/^(?:::|0:0:0:0:0:)ffff:(.+)$/);
  if (!m) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(m[1])) return m[1];
  const hex = m[1].match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}
