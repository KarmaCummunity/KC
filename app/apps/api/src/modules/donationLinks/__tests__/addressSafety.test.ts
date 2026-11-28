import { describe, expect, it } from 'vitest';
import { ipv4FromMappedIPv6, isPrivateIPv4, isPrivateIPv6Literal, isSafeHost, parseUrl } from '../addressSafety';

describe('address safety', () => {
  it.each(['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '198.18.0.1', '0.1.2.3', '224.0.0.1', '300.1.1.1'])(
    'refuses the private, loopback, link-local, reserved or malformed IPv4 literal %s',
    (host) => {
      expect(isPrivateIPv4(host)).toBe(true);
    },
  );

  it.each(['93.184.215.14', '172.32.0.1', '8.8.8.8', 'example.org'])('lets %s through the IPv4 check', (host) => {
    expect(isPrivateIPv4(host)).toBe(false);
  });

  it.each(['[::1]', '::', '[fe80::1]', '[fd12::1]', '[ff02::1]', '[::ffff:127.0.0.1]', '[::ffff:a00:1]'])(
    'refuses the private IPv6 literal %s, including v4-mapped ones',
    (host) => {
      expect(isPrivateIPv6Literal(host)).toBe(true);
    },
  );

  it('lets a public IPv6 literal through', () => {
    expect(isPrivateIPv6Literal('[2606:2800::1]')).toBe(false);
  });

  it('decodes an IPv4-mapped IPv6 address in dotted and hex form', () => {
    expect(ipv4FromMappedIPv6('::ffff:127.0.0.1')).toBe('127.0.0.1');
    // `new URL()` rewrites the dotted form to hex, so the hex form is what a URL carries.
    expect(new URL('http://[::ffff:127.0.0.1]/').hostname).toBe('[::ffff:7f00:1]');
    expect(ipv4FromMappedIPv6('[::ffff:7f00:1]')).toBe('127.0.0.1');
    expect(ipv4FromMappedIPv6('::ffff:a9fe:a9fe')).toBe('169.254.169.254');
    expect(ipv4FromMappedIPv6('0:0:0:0:0:ffff:808:808')).toBe('8.8.8.8');
  });

  it('returns null for an address that is not IPv4-mapped', () => {
    expect(ipv4FromMappedIPv6('2001:4860:4860::8888')).toBeNull();
    expect(ipv4FromMappedIPv6('::1')).toBeNull();
    expect(ipv4FromMappedIPv6('::ffff:zzzz:1')).toBeNull();
  });

  it('accepts a public host on the default or standard ports', () => {
    expect(isSafeHost(new URL('https://example.org/x')).ok).toBe(true);
    expect(isSafeHost(new URL('https://example.org:443/x')).ok).toBe(true);
  });

  it.each([
    'https://example.org:8443/',
    'http://localhost/',
    'http://metadata.google.internal/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
  ])('refuses %s on its port, metadata name or private literal', (url) => {
    expect(isSafeHost(new URL(url)).ok).toBe(false);
  });

  it('accepts http(s) addresses only', () => {
    expect(parseUrl('  https://example.org/a ')?.hostname).toBe('example.org');
    for (const raw of ['ftp://example.org', 'javascript:alert(1)', 'example.org', '', 'https://', null, 42]) {
      expect(parseUrl(raw)).toBeNull();
    }
  });
});
