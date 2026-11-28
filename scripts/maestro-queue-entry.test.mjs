// Self-test of the orphaned merge-queue entry check: node --test scripts/maestro-queue-entry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryState } from './maestro-queue-entry.mjs';

const QUEUE_REF = 'gh-readonly-queue/dev/pr-2741-d44e152fec75bbd36b9df0c12acf7d39b45c9313';

/** A ref lookup that answers `status` and records the refs it was asked for. */
function lookup(status) {
  const asked = [];
  return { asked, refStatus: async (ref) => (asked.push(ref), status) };
}

test('a merge-queue run whose ref is gone is orphaned', async () => {
  const api = lookup(404);
  const state = await entryState({ eventName: 'merge_group', refName: QUEUE_REF, ...api });
  assert.equal(state.orphaned, true);
  assert.deepEqual(api.asked, [QUEUE_REF]);
  assert.match(state.reason, /no longer exists/);
});

test('a merge-queue run whose ref still exists is live', async () => {
  const state = await entryState({ eventName: 'merge_group', refName: QUEUE_REF, ...lookup(200) });
  assert.equal(state.orphaned, false);
});

test('any other answer counts as live, so a GitHub hiccup never skips the suite', async () => {
  for (const status of [401, 403, 429, 500, 502]) {
    const state = await entryState({ eventName: 'merge_group', refName: QUEUE_REF, ...lookup(status) });
    assert.equal(state.orphaned, false, `status ${status}`);
  }
});

test('a failed request counts as live', async () => {
  const refStatus = async () => {
    throw new Error('fetch failed');
  };
  const state = await entryState({ eventName: 'merge_group', refName: QUEUE_REF, refStatus });
  assert.equal(state.orphaned, false);
  assert.match(state.reason, /fetch failed/);
});

test('a pull request, push or dispatch run is never checked', async () => {
  for (const eventName of ['pull_request', 'push', 'workflow_dispatch', 'workflow_call', undefined]) {
    const api = lookup(404);
    const state = await entryState({ eventName, refName: QUEUE_REF, ...api });
    assert.equal(state.orphaned, false);
    assert.deepEqual(api.asked, []);
  }
});

test('a merge_group run on a ref outside the queue namespace is never checked', async () => {
  const api = lookup(404);
  const state = await entryState({ eventName: 'merge_group', refName: 'dev', ...api });
  assert.equal(state.orphaned, false);
  assert.deepEqual(api.asked, []);
});
