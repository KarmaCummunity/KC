import { assert, assertEquals } from 'jsr:@std/assert@1';
import { createHandler, type AuthedMember, type HandlerDeps } from './handler.ts';
import type { PlaceCandidate } from '../_shared/post-extraction/places.ts';
import { ExtractionProviderError } from '../_shared/post-extraction/providerTypes.ts';
import type { ImportRecord } from '../_shared/post-extraction/store.ts';

const NOW = new Date('2026-11-16T12:00:00Z');
const MEMBER: AuthedMember = { id: 'user-1', createdAt: new Date('2026-10-01T00:00:00Z') };
const TEXT = 'מוסר ספה תלת מושבית בתל אביב, התקשרו 050-1234567';
const lists = { worlds: ['items', 'rides'], subcategories: { items: ['furniture'] }, detailKeys: {} };
const answer = {
  is_post: true, reject_reason: null, direction: 'offer', world_slug: 'items', subcategory: 'furniture',
  title: 'ספה תלת מושבית', description: 'במצב טוב', place: { city_text: 'תל אביב' }, time: { kind: 'none' },
  ride: null, details: {}, language: 'he',
  confidence: { overall: 0.95, per_field: { direction: 0.95, world: 0.95, title: 0.95 } },
};
const city: PlaceCandidate = { level: 'city', placeId: '5000', nameHe: 'x', cityId: '5000', score: 0.9, margin: 0.5 };

interface Spy { records: ImportRecord[]; providerCalls: number; counts: { hour: number; day: number; calls: number }; removals: Date[]; removalsSince: string[] }

function setup(overrides: Partial<HandlerDeps> = {}, spy: Partial<Spy> = {}) {
  const state: Spy = { records: [], providerCalls: 0, counts: { hour: 0, day: 0, calls: 0 }, removals: [], removalsSince: [], ...spy };
  const deps: HandlerDeps = {
    authenticate: () => Promise.resolve(MEMBER),
    isEnabled: () => Promise.resolve(true),
    store: {
      attemptsSince: (_u, since) => Promise.resolve(Date.parse(since) > NOW.getTime() - 2 * 3600_000 ? state.counts.hour : state.counts.day),
      providerCallsSince: () => Promise.resolve(state.counts.calls),
      moderationRemovalsSince: (_u, since) => { state.removalsSince.push(since); return Promise.resolve(state.removals); },
      record: (row) => { state.records.push(row); return Promise.resolve('import-1'); },
    },
    cache: { get: () => Promise.resolve(null), put: () => Promise.resolve() },
    loadLists: () => Promise.resolve(lists),
    provider: { extract: () => { state.providerCalls++; return Promise.resolve({ raw: answer, model: 'm' }); } },
    resolvePlace: () => Promise.resolve([city]),
    now: () => NOW,
    report: () => Promise.resolve(),
    ...overrides,
  };
  return { handler: createHandler(deps), state };
}

const post = (body: unknown, init: RequestInit = {}) =>
  new Request('https://x.test/extract-external-post', {
    method: 'POST', headers: { Authorization: 'Bearer t' }, body: typeof body === 'string' ? body : JSON.stringify(body), ...init,
  });

Deno.test('only POST is served, and an allowed origin gets its preflight answer', async () => {
  const { handler } = setup();
  assertEquals((await handler(new Request('https://x.test/', { method: 'GET' }))).status, 405);
  const pre = await handler(new Request('https://x.test/', { method: 'OPTIONS', headers: { origin: 'http://localhost:3000' } }));
  assertEquals(pre.status, 200);
  assertEquals((await handler(new Request('https://x.test/', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }))).status, 403);
});

Deno.test('an unauthenticated caller is refused before anything else happens', async () => {
  const { handler, state } = setup({ authenticate: () => Promise.resolve(null) });
  assertEquals((await handler(post({ text: TEXT }))).status, 401);
  assertEquals(state.providerCalls, 0);
});

Deno.test('a malformed request is a 400, an enormous text a 413', async () => {
  const { handler } = setup();
  for (const body of ['not json', {}, { text: '   ' }, { text: 5 }, { text: TEXT, channel: 'bot' }, { text: TEXT, sourcePlatform: 'tiktok' }]) {
    assertEquals((await handler(post(body))).status, 400, JSON.stringify(body));
  }
  assertEquals((await handler(post({ text: 'א'.repeat(20_001) }))).status, 413);
});

Deno.test('with the flag off nothing runs and nothing is recorded', async () => {
  const { handler, state } = setup({ isEnabled: () => Promise.resolve(false) });
  const res = await handler(post({ text: TEXT }));
  const body = await res.json();
  assertEquals([res.status, body.routing, body.reason], [200, 'manual', 'disabled']);
  assertEquals([state.providerCalls, state.records.length], [0, 0]);
});

Deno.test('a limit answers manual with its reason and never calls the model', async () => {
  const cases: [string, Partial<AuthedMember>, Partial<Spy['counts']>][] = [
    ['account_too_new', { createdAt: new Date(NOW.getTime() - 3600_000) }, {}],
    ['rate_limited', {}, { hour: 5 }],
    ['rate_limited', {}, { day: 20 }],
    ['budget_exhausted', {}, { calls: 2000 }],
  ];
  for (const [reason, member, counts] of cases) {
    const { handler, state } = setup(
      { authenticate: () => Promise.resolve({ ...MEMBER, ...member }) },
      { counts: { hour: 0, day: 0, calls: 0, ...counts } },
    );
    const body = await (await handler(post({ text: TEXT }))).json();
    assertEquals([body.routing, body.reason], ['manual', reason]);
    assertEquals([state.providerCalls, state.records.length], [0, 0]);
  }
});

// FR-IMPORT-008 AC4 — imports removed by moderation 3 times in 30 days lock the member for 14 days.
Deno.test('a member locked by moderation removals gets the manual route and no model call', async () => {
  const day = 24 * 3600_000;
  const removals = [1, 2, 3].map((n) => new Date(NOW.getTime() - n * day));
  const { handler, state } = setup({}, { removals });
  const body = await (await handler(post({ text: TEXT }))).json();
  assertEquals([body.routing, body.reason], ['manual', 'import_locked']);
  assertEquals([state.providerCalls, state.records.length], [0, 0]);
  // The removals are read back over a 30-day window plus the 14-day lock.
  assertEquals(state.removalsSince, [new Date(NOW.getTime() - 44 * day).toISOString()]);
});

Deno.test('a failed removals read is a 500, never an open lockout', async () => {
  const { handler } = setup({
    store: {
      attemptsSince: () => Promise.resolve(0),
      providerCallsSince: () => Promise.resolve(0),
      moderationRemovalsSince: () => Promise.reject(new Error('down')),
      record: () => Promise.resolve('x'),
    },
  });
  assertEquals((await handler(post({ text: TEXT }))).status, 500);
});

Deno.test('a good share returns the draft and records the attempt without any raw text', async () => {
  const { handler, state } = setup();
  const res = await handler(post({ text: TEXT, channel: 'share', sourcePlatform: 'whatsapp' }));
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals([body.importId, body.routing, body.reason], ['import-1', 'confirm', 'ok']);
  assertEquals(body.extraction.title, 'ספה תלת מושבית');
  assertEquals(body.city.picked.placeId, '5000');
  assert(body.confirmFields.includes('city'));
  assertEquals(body.removed.phone, 1);

  const [row] = state.records;
  assertEquals([row.user_id, row.channel, row.source_platform, row.provider_called], ['user-1', 'share', 'whatsapp', true]);
  assert(/^[0-9a-f]{64}$/.test(row.text_fingerprint));
  const stored = JSON.stringify(row);
  assert(!stored.includes('050-1234567') && !stored.includes('התקשרו'), 'no raw text is stored');
  assert(!JSON.stringify(body).includes(row.text_fingerprint), 'the fingerprint is not sent back');
});

Deno.test('the member comes from the token, never from the body', async () => {
  const { handler, state } = setup();
  await handler(post({ text: TEXT, user_id: 'someone-else', userId: 'someone-else' }));
  assertEquals(state.records[0].user_id, 'user-1');
});

Deno.test('a provider failure is a manual route that is still recorded', async () => {
  const { handler, state } = setup({
    provider: { extract: () => Promise.reject(new ExtractionProviderError('timeout', 'slow')) },
  });
  const body = await (await handler(post({ text: TEXT }))).json();
  assertEquals([body.routing, body.reason], ['manual', 'provider_failed']);
  assertEquals([state.records[0].routing, state.records[0].provider_called], ['manual', true]);
});

Deno.test('an empty text after the scrub is recorded too, with a stable fingerprint', async () => {
  const { handler, state } = setup();
  const body = await (await handler(post({ text: '050-1234567' }))).json();
  assertEquals(body.reason, 'empty_text');
  assertEquals(state.providerCalls, 0);
  assert(/^[0-9a-f]{64}$/.test(state.records[0].text_fingerprint));
});

Deno.test('a failing store is a 500 that leaks nothing', async () => {
  const { handler } = setup({
    store: {
      attemptsSince: () => Promise.reject(new Error('secret connection string')),
      providerCallsSince: () => Promise.resolve(0),
      moderationRemovalsSince: () => Promise.resolve([]),
      record: () => Promise.resolve('x'),
    },
  });
  const res = await handler(post({ text: TEXT }));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'internal' });
});
