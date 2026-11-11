// validate-donation-link/ssrf.ts — run: deno test supabase/functions/validate-donation-link
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { ResolveRecords } from './dnsGuard.ts';
import { checkReachable, isPrivateIPv4, isPrivateIPv6Literal, isSafeHost, parseUrl } from './ssrf.ts';

const PUBLIC_DNS: ResolveRecords = (_host, type) => Promise.resolve(type === 'A' ? ['93.184.215.14'] : []);

/** A fetch that answers from a script of `url → [status, location?]`; unknown URLs fail like a network error. */
function scripted(routes: Record<string, [number, string?]>, log: string[] = []): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    log.push(`${init?.method} ${url}`);
    const route = routes[`${init?.method} ${url}`] ?? routes[url];
    if (!route) return Promise.reject(new Error('network'));
    return Promise.resolve(new Response(null, { status: route[0], headers: route[1] ? { location: route[1] } : {} }));
  }) as typeof fetch;
}

Deno.test('private, loopback, link-local, reserved and malformed IPv4 literals are refused', () => {
  for (const host of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '198.18.0.1', '0.1.2.3', '224.0.0.1', '300.1.1.1']) {
    assertEquals(isPrivateIPv4(host), true, host);
  }
  for (const host of ['93.184.215.14', '172.32.0.1', '8.8.8.8', 'example.org']) assertEquals(isPrivateIPv4(host), false, host);
});

Deno.test('private IPv6 literals, including v4-mapped ones, are refused', () => {
  for (const host of ['[::1]', '::', '[fe80::1]', '[fd12::1]', '[ff02::1]', '[::ffff:127.0.0.1]', '[::ffff:a00:1]']) {
    assertEquals(isPrivateIPv6Literal(host), true, host);
  }
  assertEquals(isPrivateIPv6Literal('[2606:2800::1]'), false);
});

Deno.test('hosts are refused on port, metadata name and private literal', () => {
  assertEquals(isSafeHost(new URL('https://example.org/x')).ok, true);
  assertEquals(isSafeHost(new URL('https://example.org:443/x')).ok, true);
  for (const url of ['https://example.org:8443/', 'http://localhost/', 'http://metadata.google.internal/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/']) {
    assertEquals(isSafeHost(new URL(url)).ok, false, url);
  }
});

Deno.test('parseUrl accepts http(s) addresses only', () => {
  assertEquals(parseUrl('  https://example.org/a ')?.hostname, 'example.org');
  for (const raw of ['ftp://example.org', 'javascript:alert(1)', 'example.org', '', null, 42]) assertEquals(parseUrl(raw), null);
});

Deno.test('an address that answers is reachable, including auth walls and anti-bot statuses', async () => {
  for (const status of [200, 401, 403, 503]) {
    assertEquals(await checkReachable(new URL('https://example.org/'), scripted({ 'https://example.org/': [status] }), PUBLIC_DNS), true, String(status));
  }
});

Deno.test('a HEAD that is refused or 404 falls back to GET; a 404 on both is unreachable', async () => {
  const log: string[] = [];
  const ok = scripted({ 'HEAD https://example.org/': [404], 'GET https://example.org/': [200] }, log);
  assertEquals(await checkReachable(new URL('https://example.org/'), ok, PUBLIC_DNS), true);
  assertEquals(log, ['HEAD https://example.org/', 'GET https://example.org/']);
  assertEquals(await checkReachable(new URL('https://example.org/'), scripted({ 'https://example.org/': [404] }), PUBLIC_DNS), false);
  assertEquals(await checkReachable(new URL('https://example.org/'), scripted({}), PUBLIC_DNS), false);
});

Deno.test('a relative redirect is followed and the next hop is validated again', async () => {
  const fetchFn = scripted({ 'https://example.org/a': [302, '/b'], 'https://example.org/b': [200] });
  assertEquals(await checkReachable(new URL('https://example.org/a'), fetchFn, PUBLIC_DNS), true);
});

Deno.test('a redirect into private space is refused before it is fetched', async () => {
  const log: string[] = [];
  const fetchFn = scripted({ 'https://example.org/': [302, 'http://169.254.169.254/latest/meta-data/'] }, log);
  assertEquals(await checkReachable(new URL('https://example.org/'), fetchFn, PUBLIC_DNS), false);
  assertEquals(log.some((line) => line.includes('169.254')), false);
});

Deno.test('a name that resolves to a private address is unreachable without any fetch', async () => {
  const log: string[] = [];
  const privateDns: ResolveRecords = (_host, type) => Promise.resolve(type === 'A' ? ['10.0.0.5'] : []);
  assertEquals(await checkReachable(new URL('https://internal.example/'), scripted({ 'https://internal.example/': [200] }, log), privateDns), false);
  assertEquals(log, []);
});

Deno.test('redirect loops stop after the hop limit, and non-http redirect targets fail', async () => {
  const loop = scripted({ 'https://example.org/': [302, 'https://example.org/'] });
  assertEquals(await checkReachable(new URL('https://example.org/'), loop, PUBLIC_DNS), false);
  const ftp = scripted({ 'https://example.org/': [302, 'ftp://example.org/'] });
  assertEquals(await checkReachable(new URL('https://example.org/'), ftp, PUBLIC_DNS), false);
});
