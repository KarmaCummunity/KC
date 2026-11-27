import { describe, expect, it } from 'vitest';
import { GeminiError } from '../../../platform/ai/geminiClient';
import { type ImportDeps, importExternalPost, type ImportMember } from '../importService';
import type { ImportRecord, ImportStore } from '../importStore';
import type { PlaceCandidate } from '../placeDecision';

const NOW = new Date('2026-11-16T12:00:00Z');
const DAY_MS = 24 * 3600_000;
const MEMBER: ImportMember = { id: 'user-1', createdAt: new Date('2026-10-01T00:00:00Z') };
const TEXT = 'מוסר ספה תלת מושבית בתל אביב, התקשרו 050-1234567';
const lists = { worlds: ['items', 'rides'], subcategories: { items: ['furniture'] }, detailKeys: {} };
const answer = {
  is_post: true,
  reject_reason: null,
  direction: 'offer',
  world_slug: 'items',
  subcategory: 'furniture',
  title: 'ספה תלת מושבית',
  description: 'במצב טוב',
  place: { city_text: 'תל אביב' },
  time: { kind: 'none' },
  ride: null,
  details: {},
  language: 'he',
  confidence: { overall: 0.95, per_field: { direction: 0.95, world: 0.95, title: 0.95 } },
};
const city: PlaceCandidate = { level: 'city', placeId: '5000', nameHe: 'x', cityId: '5000', score: 0.9, margin: 0.5 };

/** What the fakes answer, and what they were asked. */
interface Spy {
  records: ImportRecord[];
  providerCalls: number;
  counts: { hour: number; day: number; calls: number };
  removals: Date[];
  removalsSince: string[];
  similar: string | null;
  similarTexts: string[];
}

/** The draft the app receives, loosely typed for assertions. */
type Draft = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function setup(overrides: Partial<ImportDeps> = {}, spy: Partial<Spy> = {}) {
  const state: Spy = { records: [], providerCalls: 0, counts: { hour: 0, day: 0, calls: 0 }, removals: [], removalsSince: [], similar: null, similarTexts: [], ...spy };
  const reported: unknown[] = [];
  const store: ImportStore = {
    // The hourly window starts under two hours ago; anything older is the daily window.
    attemptsSince: (_userId, since) => Promise.resolve(Date.parse(since) > NOW.getTime() - 2 * 3600_000 ? state.counts.hour : state.counts.day),
    providerCallsSince: () => Promise.resolve(state.counts.calls),
    moderationRemovalsSince: (_userId, since) => {
      state.removalsSince.push(since);
      return Promise.resolve(state.removals);
    },
    similarOpenPost: (_userId, text) => {
      state.similarTexts.push(text);
      return Promise.resolve(state.similar);
    },
    record: (row) => {
      state.records.push(row);
      return Promise.resolve('import-1');
    },
  };
  const deps: ImportDeps = {
    isEnabled: () => Promise.resolve(true),
    store,
    cache: { get: () => Promise.resolve(null), put: () => Promise.resolve() },
    loadLists: () => Promise.resolve(lists),
    provider: {
      extract: () => {
        state.providerCalls += 1;
        return Promise.resolve({ raw: answer, model: 'm' });
      },
    },
    resolvePlace: () => Promise.resolve([city]),
    now: () => NOW,
    report: (error) => reported.push(error),
    ...overrides,
  };
  const run = async (body: unknown, member: ImportMember | null = MEMBER) => {
    const result = await importExternalPost(member, body, deps);
    return { status: result.status, body: result.body as Draft };
  };
  return { run, state, reported };
}

/** A store whose reads succeed with nothing, for tests that replace one method. */
const emptyStore: ImportStore = {
  attemptsSince: () => Promise.resolve(0),
  providerCallsSince: () => Promise.resolve(0),
  moderationRemovalsSince: () => Promise.resolve([]),
  similarOpenPost: () => Promise.resolve(null),
  record: () => Promise.resolve('x'),
};

describe('importExternalPost', () => {
  it('refuses an unauthenticated caller before anything else happens', async () => {
    const { run, state } = setup();

    expect((await run({ text: TEXT }, null)).status).toBe(401);
    expect(state.providerCalls).toBe(0);
  });

  it('answers 400 for a malformed request and 413 for an enormous text', async () => {
    const { run } = setup();

    for (const body of ['not an object', {}, { text: '   ' }, { text: 5 }, { text: TEXT, channel: 'bot' }, { text: TEXT, sourcePlatform: 'tiktok' }]) {
      expect((await run(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await run({ text: 'א'.repeat(20_001) })).status).toBe(413);
  });

  it('runs nothing and records nothing with the flag off', async () => {
    const { run, state } = setup({ isEnabled: () => Promise.resolve(false) });

    const { status, body } = await run({ text: TEXT });

    expect([status, body.routing, body.reason]).toEqual([200, 'manual', 'disabled']);
    expect([state.providerCalls, state.records.length]).toEqual([0, 0]);
  });

  it.each<[string, Partial<ImportMember>, Partial<Spy['counts']>]>([
    ['account_too_new', { createdAt: new Date(NOW.getTime() - 3600_000) }, {}],
    ['account_too_new', { createdAt: null }, {}],
    ['rate_limited', {}, { hour: 5 }],
    ['rate_limited', {}, { day: 20 }],
    ['budget_exhausted', {}, { calls: 2000 }],
  ])('answers manual with the reason %s and never calls the model', async (reason, member, counts) => {
    const { run, state } = setup({}, { counts: { hour: 0, day: 0, calls: 0, ...counts } });

    const { body } = await run({ text: TEXT }, { ...MEMBER, ...member });

    expect([body.routing, body.reason]).toEqual(['manual', reason]);
    expect([state.providerCalls, state.records.length]).toEqual([0, 0]);
  });

  // FR-IMPORT-008 AC4: imports removed by moderation 3 times in 30 days lock the member for 14 days.
  it('gives a member locked by moderation removals the manual route and no model call', async () => {
    const removals = [1, 2, 3].map((days) => new Date(NOW.getTime() - days * DAY_MS));
    const { run, state } = setup({}, { removals });

    const { body } = await run({ text: TEXT });

    expect([body.routing, body.reason]).toEqual(['manual', 'import_locked']);
    expect([state.providerCalls, state.records.length]).toEqual([0, 0]);
    // The removals are read back over a 30-day window plus the 14-day lock.
    expect(state.removalsSince).toEqual([new Date(NOW.getTime() - 44 * DAY_MS).toISOString()]);
  });

  it('answers 500 when the removals cannot be read: never an open lockout', async () => {
    const { run } = setup({ store: { ...emptyStore, moderationRemovalsSince: () => Promise.reject(new Error('down')) } });

    expect((await run({ text: TEXT })).status).toBe(500);
  });

  // FR-IMPORT-008 AC1: the cross-post guard.
  it('names the open post a draft repeats, and keeps the mark in the record', async () => {
    const { run, state } = setup({}, { similar: 'post-9' });

    const { body } = await run({ text: TEXT });

    expect(body.duplicatePostId).toBe('post-9');
    expect(state.records[0]?.duplicate_post_id).toBe('post-9');
    // Compared on what would become the post: the extracted title and description.
    expect(state.similarTexts).toEqual(['ספה תלת מושבית במצב טוב']);
  });

  it('gives no warning when no open post is similar', async () => {
    const { run, state } = setup();

    const { body } = await run({ text: TEXT });

    expect(body.duplicatePostId).toBeNull();
    expect(state.records[0]?.duplicate_post_id).toBeNull();
  });

  it('does not compare a refused attempt', async () => {
    const { run, state } = setup({}, { counts: { hour: 5, day: 0, calls: 0 } });

    const { body } = await run({ text: TEXT });

    expect([body.reason, body.duplicatePostId]).toEqual(['rate_limited', null]);
    expect(state.similarTexts).toEqual([]);
  });

  it('returns the draft of a good share and records the attempt without any raw text', async () => {
    const { run, state } = setup();

    const { status, body } = await run({ text: TEXT, channel: 'share', sourcePlatform: 'whatsapp' });

    expect(status).toBe(200);
    expect([body.importId, body.routing, body.reason]).toEqual(['import-1', 'confirm', 'ok']);
    expect(body.extraction.title).toBe('ספה תלת מושבית');
    expect(body.city.picked.placeId).toBe('5000');
    expect(body.confirmFields).toContain('city');
    expect(body.removed.phone).toBe(1);

    const row = state.records[0] as ImportRecord;
    expect([row.user_id, row.channel, row.source_platform, row.provider_called]).toEqual(['user-1', 'share', 'whatsapp', true]);
    expect(row.text_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // No raw text is stored, and the fingerprint is not sent back.
    expect(JSON.stringify(row)).not.toMatch(/050-1234567|התקשרו/);
    expect(JSON.stringify(body)).not.toContain(row.text_fingerprint);
  });

  it('takes the member from the token, never from the body', async () => {
    const { run, state } = setup();

    await run({ text: TEXT, user_id: 'someone-else', userId: 'someone-else' });

    expect(state.records[0]?.user_id).toBe('user-1');
  });

  it('routes a provider failure to manual, records it, and passes on why', async () => {
    const failures: unknown[] = [];
    const failure = new GeminiError('timeout', 'slow');
    const { run, state } = setup({ provider: { extract: () => Promise.reject(failure) }, onProviderFailure: (error) => failures.push(error) });

    const { body } = await run({ text: TEXT });

    expect([body.routing, body.reason]).toEqual(['manual', 'provider_failed']);
    expect([state.records[0]?.routing, state.records[0]?.provider_called]).toEqual(['manual', true]);
    expect(failures).toEqual([failure]);
  });

  it('records a text that is empty after the scrub too, with a stable fingerprint', async () => {
    const { run, state } = setup();

    const { body } = await run({ text: '050-1234567' });

    expect(body.reason).toBe('empty_text');
    expect(state.providerCalls).toBe(0);
    expect(state.records[0]?.text_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('answers 500 for a failing store, reports it, and leaks nothing', async () => {
    const failure = new Error('secret connection string');
    const { run, reported } = setup({ store: { ...emptyStore, attemptsSince: () => Promise.reject(failure) } });

    const { status, body } = await run({ text: TEXT });

    expect(status).toBe(500);
    expect(body).toEqual({ error: 'internal' });
    expect(reported).toEqual([failure]);
  });
});
