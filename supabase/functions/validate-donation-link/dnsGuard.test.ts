// validate-donation-link/dnsGuard.test.ts — run: deno test supabase/functions/validate-donation-link
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { DnsUnavailableError, ipv4FromMappedIPv6, resolvesOnlyToPublic, type ResolveRecords } from './dnsGuard.ts';

const predicates = {
  isPrivateIPv4: (a: string) => /^(10\.|127\.|169\.254\.|192\.168\.)/.test(a),
  isPrivateIPv6: (a: string) => a === '::1' || a.toLowerCase().startsWith('fd'),
};

function resolver(records: { A?: string[]; AAAA?: string[] }): ResolveRecords {
  return (_host, type) => Promise.resolve(records[type] ?? []);
}

Deno.test('accepts a host whose addresses are all public', async () => {
  assertEquals(await resolvesOnlyToPublic('example.org', resolver({ A: ['93.184.215.14'], AAAA: ['2606:2800::1'] }), predicates), true);
});

Deno.test('rejects a host with any private IPv4 answer', async () => {
  assertEquals(await resolvesOnlyToPublic('x.test', resolver({ A: ['93.184.215.14', '169.254.169.254'] }), predicates), false);
});

Deno.test('rejects a host with a private IPv6 answer', async () => {
  assertEquals(await resolvesOnlyToPublic('x.test', resolver({ A: ['93.184.215.14'], AAAA: ['::1'] }), predicates), false);
});

Deno.test('fails closed when the name has no records', async () => {
  assertEquals(await resolvesOnlyToPublic('nothing.test', resolver({}), predicates), false);
});

Deno.test('fails closed when resolution throws', async () => {
  const failing: ResolveRecords = () => Promise.reject(new Error('SERVFAIL'));
  assertEquals(await resolvesOnlyToPublic('x.test', failing, predicates), false);
});

Deno.test('skips the check when the runtime has no DNS API', async () => {
  const unavailable: ResolveRecords = () => Promise.reject(new DnsUnavailableError('no dns'));
  assertEquals(await resolvesOnlyToPublic('example.org', unavailable, predicates), true);
});

Deno.test('decodes an IPv4-mapped IPv6 address in dotted and hex form', () => {
  assertEquals(ipv4FromMappedIPv6('::ffff:127.0.0.1'), '127.0.0.1');
  // `new URL('http://[::ffff:127.0.0.1]/').hostname` is `[::ffff:7f00:1]`.
  assertEquals(new URL('http://[::ffff:127.0.0.1]/').hostname, '[::ffff:7f00:1]');
  assertEquals(ipv4FromMappedIPv6('[::ffff:7f00:1]'), '127.0.0.1');
  assertEquals(ipv4FromMappedIPv6('::ffff:a9fe:a9fe'), '169.254.169.254');
  assertEquals(ipv4FromMappedIPv6('0:0:0:0:0:ffff:808:808'), '8.8.8.8');
});

Deno.test('returns null for an address that is not IPv4-mapped', () => {
  assertEquals(ipv4FromMappedIPv6('2001:4860:4860::8888'), null);
  assertEquals(ipv4FromMappedIPv6('::1'), null);
  assertEquals(ipv4FromMappedIPv6('::ffff:zzzz:1'), null);
});
