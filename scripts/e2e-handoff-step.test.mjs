/** Offline execution coverage for the existing handoff helper (#2457). No browser or backend. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Load the actual TS helper, replacing only its external dependencies. This keeps the tests on
// the production control flow without pulling a browser, environment secrets or network access.
const key = '__kcHandoffRegression';
after(() => { delete globalThis[key]; });
const dependencies = {
  '@playwright/test': `export const expect = globalThis.${key}.expect;`,
  './app': `export const gotoApp = globalThis.${key}.gotoApp;
    export const trackApiErrors = globalThis.${key}.trackApiErrors;`,
  './api': `export const rest = globalThis.${key}.rest;
    export const sessionFor = globalThis.${key}.sessionFor;`,
};
const asModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const original = await readFile(new URL('../tests/e2e/lib/handoffStep.ts', import.meta.url), 'utf8');
let sequence = 0;

async function scenario(options = {}) {
  const calls = { clicks: [], polls: [], ui: [], reloads: [], reads: [], sessions: [], tracks: [] };
  const row = { id: 'handoff-fixture', status: 'reserved', owner_id: 'giver', recipient_id: 'member' };
  const failure = new Error('server status did not reach reserved');
  const user = { email: 'member@example.invalid', password: 'fixture-only' };
  const trouble = { alerts: [...(options.alerts ?? [])], apiErrors: [...(options.errors ?? [])] };
  const locator = { or() { return this; }, first() { return this; } };
  const page = {
    getByTestId() { return locator; }, getByText() { return locator; },
    on(event, callback) { this[event] = callback; },
  };
  const expect = () => ({
    async toContainText(label, config) {
      calls.ui.push({ label, ...config });
      if (calls.ui.length <= (options.uiFailures ?? 0)) throw new Error('page status missing');
    },
  });
  expect.poll = (read, config) => ({
    async toBe(status) {
      calls.polls.push({ status, ...config });
      // Exercise the real participant-scoped row reader even for a simulated poll timeout.
      assert.equal(await read(), options.noRow ? 'no handoff row' : 'reserved');
      if (calls.polls.length <= (options.pollFailures ?? 0)) throw failure;
    },
  });
  globalThis[key] = {
    expect,
    async gotoApp(actualPage, path) { assert.equal(actualPage, page); calls.reloads.push(path); },
    trackApiErrors(actualPage) { calls.tracks.push(actualPage); return trouble.apiErrors; },
    async sessionFor(actualUser) {
      calls.sessions.push(actualUser);
      return { session: { access_token: 'fixture-token', user: { id: 'member' } } };
    },
    async rest(token, path) { calls.reads.push({ token, path }); return options.noRow ? [] : [row]; },
  };
  // Unique parent URL creates an independent helper module per scenario. The dependency wrappers
  // capture this scenario's functions when evaluated, so scenarios run serially in this file.
  let source = stripTypeScriptTypes(original);
  const scenarioId = sequence++;
  for (const [specifier, replacement] of Object.entries(dependencies)) {
    const quoted = `'${specifier}'`;
    assert.ok(source.includes(quoted), `helper still imports ${specifier}`);
    source = source.replace(quoted, JSON.stringify(asModule(replacement + `\n// scenario ${scenarioId}`)));
  }
  const module = await import(asModule(source));
  const step = {
    page, path: '/items/fixture', trouble, user, postId: 'post-fixture', status: 'reserved',
    button: () => ({ async click(config) {
      calls.clicks.push(config);
      if (options.retryButtonGone && calls.clicks.length === 2) throw new Error('button gone');
    } }),
  };
  return { module, step, calls, row, failure, trouble, page, user };
}

test('happy path reads as the participant and verifies both server and page', async () => {
  const s = await scenario();
  assert.equal(await s.module.takeHandoffStep(s.step), s.row);
  assert.equal(s.calls.clicks.length, 1);
  assert.deepEqual(s.calls.polls.map((x) => x.timeout), [30_000]);
  assert.deepEqual(s.calls.ui, [{ label: 'משוריין', timeout: 10_000 }]);
  assert.deepEqual(s.calls.reloads, []);
  assert.equal(s.calls.reads.length, 2);
  for (const read of s.calls.reads) {
    assert.equal(read.token, 'fixture-token');
    assert.equal(read.path, 'post_handoffs?select=id,status,owner_id,recipient_id&post_id=eq.post-fixture&order=created_at.desc&limit=1');
  }
  assert.ok(s.calls.sessions.every((user) => user === s.user));
});

for (const error of ['503 POST /rest/v1/rpc/claim', '400 POST /rest/v1/rpc/claim 57014 statement timeout']) {
  test(`a reported transient error permits exactly one retry: ${error}`, async () => {
    const s = await scenario({ errors: [error], pollFailures: 1 });
    assert.equal(await s.module.takeHandoffStep(s.step), s.row);
    assert.deepEqual(s.calls.clicks, [undefined, { timeout: 10_000 }]);
    assert.deepEqual(s.calls.polls.map((x) => x.timeout), [30_000, 45_000]);
    assert.deepEqual(s.calls.reloads, ['/items/fixture']);
    assert.equal(s.calls.ui.length, 1);
  });
}

for (const errors of [[], ['403 POST /rest/v1/rpc/claim forbidden'], ['429 POST /rest/v1/rpc/claim limited']]) {
  test(`a timeout without transient evidence does not repeat the action: ${errors[0] ?? 'none'}`, async () => {
    const s = await scenario({ errors, alerts: ['fixture refusal'], pollFailures: 1 });
    await assert.rejects(s.module.takeHandoffStep(s.step), (error) => {
      assert.equal(error.cause, s.failure);
      assert.match(error.message, /server status did not reach reserved/);
      assert.match(error.message, /alert: fixture refusal/);
      if (errors.length) assert.ok(error.message.includes(errors[0]));
      return true;
    });
    assert.equal(s.calls.clicks.length, 1);
    assert.equal(s.calls.polls.length, 1);
    assert.equal(s.calls.ui.length, 0);
    assert.deepEqual(s.calls.reloads, []);
  });
}

test('a second server timeout still fails, with no third click or page-only success', async () => {
  const s = await scenario({ errors: ['504 POST /rest/v1/rpc/claim'], pollFailures: 2 });
  await assert.rejects(s.module.takeHandoffStep(s.step), { cause: s.failure });
  assert.equal(s.calls.clicks.length, 2);
  assert.equal(s.calls.polls.length, 2);
  assert.equal(s.calls.ui.length, 0);
});

test('a late successful write can remove the retry button without skipping the second server assertion', async () => {
  const s = await scenario({ errors: ['503 POST /rest/v1/rpc/claim'], pollFailures: 1, retryButtonGone: true });
  assert.equal(await s.module.takeHandoffStep(s.step), s.row);
  assert.equal(s.calls.polls.length, 2);
  assert.equal(s.calls.ui.length, 1);
});

test('a stale page gets one reload and the existing 45-second status assertion', async () => {
  const s = await scenario({ uiFailures: 1 });
  assert.equal(await s.module.takeHandoffStep(s.step), s.row);
  assert.equal(s.calls.clicks.length, 1);
  assert.deepEqual(s.calls.ui.map((x) => x.timeout), [10_000, 45_000]);
  assert.deepEqual(s.calls.reloads, ['/items/fixture']);
});

test('a missing page status remains a failure even when the server passed', async () => {
  const s = await scenario({ uiFailures: 2 });
  await assert.rejects(s.module.takeHandoffStep(s.step), (error) => {
    assert.match(error.message, /page status missing/);
    assert.match(error.message, /The app reported:\n  nothing/);
    assert.equal(error.cause.message, 'page status missing');
    return true;
  });
  assert.equal(s.calls.ui.length, 2);
  assert.equal(s.calls.reads.length, 1); // No final success read after a failed UI assertion.
});

test('a missing handoff row cannot pass through the server assertion', async () => {
  const s = await scenario({ noRow: true, pollFailures: 1 });
  await assert.rejects(s.module.takeHandoffStep(s.step), { cause: s.failure });
  assert.equal(s.calls.clicks.length, 1);
  assert.equal(s.calls.ui.length, 0);
});

test('watchTrouble retains accepted alert messages and the API error collector', async () => {
  const s = await scenario();
  const trouble = s.module.watchTrouble(s.page);
  let accepted = 0;
  s.page.dialog({ message: () => 'fixture alert', accept: async () => { accepted++; } });
  assert.deepEqual(trouble.alerts, ['fixture alert']);
  assert.equal(accepted, 1);
  assert.equal(trouble.apiErrors, s.trouble.apiErrors);
  assert.deepEqual(s.calls.tracks, [s.page]);
});
