// _shared/ssrfGuard.test.ts — run: deno test (from supabase/functions)
import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { checkUrlSafe, isPrivateIPv4, isPrivateIPv6, isSafeHost } from './ssrfGuard.ts';

const resolveTo = (...addresses: string[]) => () => Promise.resolve(addresses);

Deno.test('private and reserved IPv4 ranges are rejected, public ones are not', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1']) {
    assert(isPrivateIPv4(ip), ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '100.128.0.1']) assertFalse(isPrivateIPv4(ip), ip);
});

Deno.test('IPv6 loopback, link-local, ULA and multicast are rejected', () => {
  for (const ip of ['::1', '::', '[::1]', 'fe80::1', 'fc00::1', 'fd12::1', 'ff02::1']) assert(isPrivateIPv6(ip), ip);
  assertFalse(isPrivateIPv6('2001:4860:4860::8888'));
});

Deno.test('IPv4-mapped IPv6 is rejected in both the dotted and the URL-normalized hex form', () => {
  assert(isPrivateIPv6('::ffff:127.0.0.1'));
  // `new URL('http://[::ffff:127.0.0.1]/').hostname` is `[::ffff:7f00:1]`.
  assertEquals(new URL('http://[::ffff:127.0.0.1]/').hostname, '[::ffff:7f00:1]');
  assert(isPrivateIPv6('[::ffff:7f00:1]'));
  assert(isPrivateIPv6('[::ffff:a9fe:a9fe]')); // 169.254.169.254
  assertFalse(isPrivateIPv6('[::ffff:808:808]')); // 8.8.8.8
});

Deno.test('isSafeHost rejects non-standard ports, metadata names and IP literals', () => {
  assertFalse(isSafeHost(new URL('http://example.org:8080/')).ok);
  assertFalse(isSafeHost(new URL('http://localhost/')).ok);
  assertFalse(isSafeHost(new URL('http://metadata.google.internal/')).ok);
  assertFalse(isSafeHost(new URL('http://2130706433/')).ok); // decimal 127.0.0.1
  assert(isSafeHost(new URL('https://example.org/')).ok);
});

Deno.test('a public-looking name that resolves to a private address is rejected', async () => {
  const url = new URL('https://rebind.example.org/');
  assertFalse((await checkUrlSafe(url, resolveTo('169.254.169.254'))).ok);
  assertFalse((await checkUrlSafe(url, resolveTo('93.184.216.34', '10.0.0.5'))).ok);
  assertFalse((await checkUrlSafe(url, resolveTo('::1'))).ok);
});

Deno.test('a name that does not resolve is rejected (fail closed)', async () => {
  const url = new URL('https://nx.example.org/');
  assertFalse((await checkUrlSafe(url, resolveTo())).ok);
  assertFalse((await checkUrlSafe(url, () => Promise.reject(new Error('NXDOMAIN')))).ok);
});

Deno.test('a name that resolves to public addresses only is accepted', async () => {
  assert((await checkUrlSafe(new URL('https://example.org/'), resolveTo('93.184.216.34', '2606:2800:220:1::1'))).ok);
});
