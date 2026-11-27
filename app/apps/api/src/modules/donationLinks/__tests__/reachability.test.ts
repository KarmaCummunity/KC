import { describe, expect, it } from 'vitest';
import { checkReachable, type ResolveRecords, resolvesOnlyToPublic } from '../reachability';

const PUBLIC_DNS: ResolveRecords = (_host, type) => Promise.resolve(type === 'A' ? ['93.184.215.14'] : []);
const resolver =
  (records: { A?: string[]; AAAA?: string[] }): ResolveRecords =>
  (_host, type) =>
    Promise.resolve(records[type] ?? []);

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

const reachable = (url: string, routes: Record<string, [number, string?]>, dns = PUBLIC_DNS, log?: string[]) =>
  checkReachable(new URL(url), scripted(routes, log), dns);

describe('resolvesOnlyToPublic', () => {
  it('accepts a host whose addresses are all public', async () => {
    expect(await resolvesOnlyToPublic('example.org', resolver({ A: ['93.184.215.14'], AAAA: ['2606:2800::1'] }))).toBe(true);
  });

  it('rejects a host with any private answer, IPv4 or IPv6', async () => {
    expect(await resolvesOnlyToPublic('x.test', resolver({ A: ['93.184.215.14', '169.254.169.254'] }))).toBe(false);
    expect(await resolvesOnlyToPublic('x.test', resolver({ A: ['93.184.215.14'], AAAA: ['::1'] }))).toBe(false);
    expect(await resolvesOnlyToPublic('x.test', resolver({ AAAA: ['::ffff:10.0.0.1'] }))).toBe(false);
  });

  it('fails closed when the name has no records or the lookup fails', async () => {
    expect(await resolvesOnlyToPublic('nothing.test', resolver({}))).toBe(false);
    expect(await resolvesOnlyToPublic('x.test', () => Promise.reject(new Error('SERVFAIL')))).toBe(false);
  });
});

describe('checkReachable', () => {
  it.each([200, 401, 403, 503])('counts an address that answers %i as reachable (auth walls and anti-bot pages included)', async (status) => {
    expect(await reachable('https://example.org/', { 'https://example.org/': [status] })).toBe(true);
  });

  it('falls back to GET when HEAD is refused or 404; a 404 on both is unreachable', async () => {
    const log: string[] = [];

    expect(await reachable('https://example.org/', { 'HEAD https://example.org/': [404], 'GET https://example.org/': [200] }, PUBLIC_DNS, log)).toBe(true);
    expect(log).toEqual(['HEAD https://example.org/', 'GET https://example.org/']);
    expect(await reachable('https://example.org/', { 'https://example.org/': [404] })).toBe(false);
    expect(await reachable('https://example.org/', {})).toBe(false);
  });

  it('follows a relative redirect and validates the next hop again', async () => {
    expect(await reachable('https://example.org/a', { 'https://example.org/a': [302, '/b'], 'https://example.org/b': [200] })).toBe(true);
  });

  it('refuses a redirect into private space before fetching it', async () => {
    const log: string[] = [];

    expect(await reachable('https://example.org/', { 'https://example.org/': [302, 'http://169.254.169.254/latest/meta-data/'] }, PUBLIC_DNS, log)).toBe(false);
    expect(log.some((line) => line.includes('169.254'))).toBe(false);
  });

  it('never fetches a name that resolves to a private address', async () => {
    const log: string[] = [];
    const privateDns = resolver({ A: ['10.0.0.5'] });

    expect(await reachable('https://internal.example/', { 'https://internal.example/': [200] }, privateDns, log)).toBe(false);
    expect(log).toEqual([]);
  });

  it('never fetches a forbidden host, a private literal or an odd port', async () => {
    const log: string[] = [];

    for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'https://example.org:8443/']) {
      expect(await reachable(url, { [url]: [200] }, PUBLIC_DNS, log)).toBe(false);
    }
    expect(log).toEqual([]);
  });

  it('stops a redirect loop at the hop limit and fails a redirect to another scheme', async () => {
    expect(await reachable('https://example.org/', { 'https://example.org/': [302, 'https://example.org/'] })).toBe(false);
    expect(await reachable('https://example.org/', { 'https://example.org/': [302, 'ftp://example.org/'] })).toBe(false);
    expect(await reachable('https://example.org/', { 'https://example.org/': [302] })).toBe(false);
  });
});
