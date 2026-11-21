import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Global, Module } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { DonationLinkError, type IDonationLinksRepository, type ILegalDocumentRepository } from '@kc/application';
import { createPortTransport, createRemotePort } from '@kc/infrastructure-api';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../createApp';
import { HOSTED_PORTS } from '../../modules/hostedAdapters/hostedPorts';
import { ApiConfigModule } from '../../platform/config/apiConfig.module';
import { DatabaseModule } from '../../platform/database/database.module';
import { ACCESS_TOKEN_VERIFIER } from '../../platform/identity/accessTokenVerifier';
import { loadSchemaCache, type SchemaCache } from '../../platform/postgrest/schemaCache';
import { PortGatewayModule } from '../../platform/ports/portGateway.module';
import { VisitorCache } from '../../platform/ports/visitorCache';
import { RateLimiter } from '../../platform/rateLimit/rateLimiter';
import { KC_DATABASE_URL, KcTestDatabase } from '../support/kcDatabase';
import { testConfig } from '../support/testConfig';
import { createTestIssuer, type TestIssuer } from '../support/testTokens';

const ADAPTERS_DIR = fileURLToPath(new URL('../../../../../packages/infrastructure-supabase/src', import.meta.url));

/** Functions of the dev-only seeds (demo data, production copy): present on kc-dev, never in the migrations. */
const DEV_SEED_FUNCTIONS = new Set([
  'admin_delete_prod_copy',
  'admin_demo_data_status',
  'admin_prod_copy_status',
  'admin_seed_demo_data_step',
  'admin_wipe_demo_data_step',
]);

/** Functions the database opens to visitors that no app port calls (served by the web edge instead). */
const PUBLIC_OUTSIDE_PORTS = new Set(['post_share_card']);

/** Every adapter source file, tests and generated types left out. */
function adapterSources(dir = ADAPTERS_DIR): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : adapterSources(path);
    return /\.ts$/.test(entry) && !/\.types\.ts$/.test(entry) ? [readFileSync(path, 'utf8')] : [];
  });
}

function namesIn(sources: readonly string[], pattern: RegExp): string[] {
  const names = new Set<string>();
  for (const source of sources) for (const match of source.matchAll(pattern)) names.add(match[1] as string);
  return [...names].sort();
}

/**
 * What the hosted adapters ask of the database, checked against the real KC
 * schema: every function and table they name must exist in a shape the
 * engine can serve, and the gateway's public surface must be the database's.
 */
describe.skipIf(!KC_DATABASE_URL)('Hosted ports on the KC schema', () => {
  const database = new KcTestDatabase();
  const sources = adapterSources();
  let cache: SchemaCache;
  let app: NestFastifyApplication;
  let issuer: TestIssuer;
  /** Stands in for the outbound reachability check: no test reaches the network. */
  const reachableHosts = new Set(['give.example.org']);
  const checkReachable = (url: URL) => Promise.resolve(reachableHosts.has(url.hostname));

  beforeAll(async () => {
    cache = await loadSchemaCache(((text: string) => database.admin.query(text)) as never);
    // A published legal document, as the admin tool would leave it.
    await database.admin.query(`
      insert into public.legal_documents (doc_type, current_version, current_effective_date)
      values ('terms', 1, '2026-01-01T00:00:00Z')
      on conflict (doc_type) do update set current_version = 1, current_effective_date = excluded.current_effective_date`);
    await database.admin.query(`
      insert into public.legal_document_versions (doc_type, version, language, effective_date, body_md, content_hash, severity, change_summary, published_at)
      values ('terms', 1, 'he', '2026-01-01T00:00:00Z', 'The terms.', 'hash-1', 'standard', 'First version', '2025-12-25T08:00:00Z')
      on conflict (doc_type, version) do nothing`);
    issuer = await createTestIssuer();

    @Global()
    @Module({
      providers: [
        { provide: ACCESS_TOKEN_VERIFIER, useValue: issuer.verifier },
        { provide: RateLimiter, useValue: { check: () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }) } },
        // Always a miss: these suites check what the database answers, not the cache.
        { provide: VisitorCache, useValue: { read: () => Promise.resolve({ found: false }), write: () => Promise.resolve() } },
      ],
      exports: [ACCESS_TOKEN_VERIFIER, RateLimiter, VisitorCache],
    })
    class LocalIdentityModule {}

    const config = testConfig({ databaseUrl: KC_DATABASE_URL ?? '' });
    @Module({ imports: [ApiConfigModule.forRoot(config), DatabaseModule, LocalIdentityModule, PortGatewayModule.forRoot(HOSTED_PORTS, { checkReachable })] })
    class GatewayModule {}
    app = await createApp(GatewayModule, config);
  });

  afterAll(async () => {
    await app?.close();
    await database.close();
  });

  it('every function an adapter calls exists', () => {
    const called = namesIn(sources, /\.rpc\(\s*'([a-z_0-9]+)'/g);
    const missing = called.filter((name) => !cache.functions.has(name) && !DEV_SEED_FUNCTIONS.has(name));

    expect(called.length).toBeGreaterThan(200);
    expect(missing).toEqual([]);
  });

  it('every such function can be called by argument name: one overload, every argument named', () => {
    const unsupported = namesIn(sources, /\.rpc\(\s*'([a-z_0-9]+)'/g).filter((name) => {
      const overloads = cache.functions.get(name);
      if (!overloads) return false;
      return overloads.length !== 1 || overloads.some((signature) => signature.args.some((arg) => arg.name === ''));
    });

    expect(unsupported).toEqual([]);
  });

  it('every table an adapter reads or writes exists', () => {
    const used = namesIn(sources, /\.from\(\s*'([a-z_0-9]+)'/g);
    const missing = used.filter((name) => !cache.relations.has(name));

    expect(used.length).toBeGreaterThan(40);
    // Storage buckets are also addressed with `.from('<bucket>')`; they are not relations.
    expect(missing.filter((name) => !sources.some((source) => source.includes(`storage.from('${name}')`) || source.includes(`_BUCKET = '${name}'`)))).toEqual([]);
  });

  it('every function the database opens to visitors is behind a public port method', async () => {
    const granted = await database.admin.query<{ name: string }>(`
      select p.proname as name from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')`);
    const publicPortCount = HOSTED_PORTS.filter((port) => Object.values(port.methods).includes('public')).length;
    const uncalled = granted.rows
      .map((row) => row.name)
      .filter((name) => !PUBLIC_OUTSIDE_PORTS.has(name) && !sources.some((source) => source.includes(`.rpc('${name}'`)));

    expect(uncalled).toEqual([]);
    expect(publicPortCount).toBeGreaterThan(0);
  });

  const publicCalls: ReadonlyArray<[string, unknown[]]> = [
    ['stats/getCommunityStatsSnapshot', []],
    ['stats/getActivePublicPostsCount', []],
    ['guestPosts/list', []],
    ['guestPosts/get', ['11111111-1111-4111-8111-111111111111']],
    ['kcSupportChannels/listActiveChannels', []],
    ['payments/listVerifiedNonprofits', [5]],
    ['payments/getNonprofitPublicPage', ['no-such-org']],
    ['orgTransparency/getPublic', []],
    ['worldContent/getWorldContent', ['food']],
    ['publicResearch/loadBundle', ['no-such-survey']],
    ['legalDocument/getCurrentContent', ['terms']],
  ];

  it.each(publicCalls)('a signed-out visitor may call %s: the database lets the anon role in', async (path, args) => {
    const response = await app.inject({ method: 'POST', url: `/v1/ports/${path}`, payload: { args } });

    // 200 with data, or a typed refusal such as "not found": never a permission or server error.
    expect([200, 422]).toContain(response.statusCode);
    if (response.statusCode === 422) expect(JSON.stringify(response.json())).not.toMatch(/permission denied|unauthenticated/);
  });

  it('serves the ports that replaced direct reads in the app: feature flags, karma history, Pro status', async () => {
    const member = await database.newMember();
    const authorization = `Bearer ${await issuer.sign(member.userId)}`;
    const call = (path: string, args: unknown[]) =>
      app.inject({ method: 'POST', url: `/v1/ports/${path}`, payload: { args }, headers: { authorization } });

    const flags = await call('featureFlags/listFlags', []);
    const history = await call('karmaHistory/listHistory', [member.userId, 10]);
    const pro = await call('proEntitlement/isPro', []);

    expect(flags.statusCode).toBe(200);
    // The reference seed sets the launch flags.
    expect(Object.keys(flags.json().result).length).toBeGreaterThan(5);
    expect(history.statusCode).toBe(200);
    expect(Array.isArray(history.json().result)).toBe(true);
    expect(pro.json()).toEqual({ result: false });
  });

  it("does not show a member another member's karma history: row-level security filters it", async () => {
    const alice = await database.newMember();
    const bob = await database.newMember();
    await database.admin.query("insert into public.karma_ledger (user_id, event_type, points) values ($1, 'registration', 5)", [alice.userId]).catch(() => undefined);
    const asBob = `Bearer ${await issuer.sign(bob.userId)}`;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ports/karmaHistory/listHistory',
      payload: { args: [alice.userId, 10] },
      headers: { authorization: asBob },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: [] });
  });

  it('carries dates end to end: a visitor reads the terms through the remote port and gets real dates', async () => {
    await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const asVisitor = createPortTransport({ baseUrl, getAccessToken: () => Promise.resolve(null) });
    const legal = createRemotePort<ILegalDocumentRepository>(asVisitor, 'legalDocument');

    const terms = await legal.getCurrentContent('terms');

    expect(terms).toMatchObject({ docType: 'terms', version: 1, bodyMd: 'The terms.', severity: 'standard' });
    expect(terms.effectiveDate).toBeInstanceOf(Date);
    expect(terms.effectiveDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(terms.publishedAt.toISOString()).toBe('2025-12-25T08:00:00.000Z');
    // A member-only method of the same port is still closed to the visitor.
    await expect(legal.getPendingForCurrentUser()).rejects.toMatchObject({ reason: 'unauthenticated' });
  });

  it('a member adds and edits a donation link through the ported function; the rules hold end to end', async () => {
    await database.admin.query(
      "insert into public.donation_link_categories (slug, icon_name, sort_order) values ('food', 'restaurant', 1) on conflict do nothing",
    );
    const alice = await database.newMember();
    const bob = await database.newMember();
    const address = app.getHttpServer().address() as AddressInfo | null;
    if (!address) await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const linksOf = (userId: string) =>
      createRemotePort<IDonationLinksRepository>(createPortTransport({ baseUrl, getAccessToken: () => issuer.sign(userId) }), 'donationLinks');
    const input = { categorySlug: 'food' as const, url: 'https://give.example.org/donate', displayName: 'Food Bank' };

    const added = await linksOf(alice.userId).addViaEdgeFunction(input);
    const edited = await linksOf(alice.userId).updateViaEdgeFunction({ ...input, linkId: added.id, displayName: 'Food Bank TLV' });
    const stored = await database.admin.query<{ display_name: string; submitted_by: string; review_status: string }>(
      'select display_name, submitted_by, review_status from public.donation_links where id = $1',
      [added.id],
    );

    expect(added).toMatchObject({ categorySlug: 'food', url: 'https://give.example.org/donate', displayName: 'Food Bank' });
    expect(edited.displayName).toBe('Food Bank TLV');
    // Written by the server as the service role, attributed to the member, and sent to review.
    expect(stored.rows[0]).toEqual({ display_name: 'Food Bank TLV', submitted_by: alice.userId, review_status: 'pending' });

    // Another member may not edit it; a private address and an unreachable one are refused; so is an unknown world.
    const refusal = (attempt: Promise<unknown>) => attempt.then(() => 'accepted', (error: unknown) => (error instanceof DonationLinkError ? error.code : error));
    expect(await refusal(linksOf(bob.userId).updateViaEdgeFunction({ ...input, linkId: added.id }))).toBe('forbidden');
    expect(await refusal(linksOf(alice.userId).addViaEdgeFunction({ ...input, url: 'http://169.254.169.254/latest/meta-data/' }))).toBe('invalid_url');
    expect(await refusal(linksOf(alice.userId).addViaEdgeFunction({ ...input, url: 'https://down.example.org/' }))).toBe('unreachable');
    // A real giving world with no links category: the table's foreign key refuses it.
    expect(await refusal(linksOf(alice.userId).addViaEdgeFunction({ ...input, categorySlug: 'housing' }))).toBe('invalid_input');
    // A value that is not a giving world at all never reaches the function: the gateway's argument check stops it.
    expect(await refusal(linksOf(alice.userId).addViaEdgeFunction({ ...input, categorySlug: 'no-such-world' as never }))).toMatchObject({
      code: 'invalid_arguments',
      status: 400,
    });
  });

  it('a signed-out visitor is turned away from every member method before the database is touched', async () => {
    const memberMethods = HOSTED_PORTS.flatMap((port) =>
      Object.entries(port.methods)
        .filter(([, access]) => access === 'member')
        .map(([method]) => `${port.name}/${method}`),
    );

    const statuses = await Promise.all(
      memberMethods.map((path) => app.inject({ method: 'POST', url: `/v1/ports/${path}`, payload: { args: [] } }).then((r) => r.statusCode)),
    );

    expect(memberMethods.length).toBeGreaterThan(300);
    expect(new Set(statuses)).toEqual(new Set([401]));
  });
});
