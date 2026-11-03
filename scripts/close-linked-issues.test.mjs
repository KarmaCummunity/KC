import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClosingRefs, closeLinkedIssues } from './close-linked-issues.mjs';

const REPO = 'KarmaCummunity/KC';

test('parseClosingRefs finds every GitHub closing keyword, case-insensitive', () => {
  const body = [
    'Closes #1',
    'fixes #2',
    'RESOLVED: #3',
    'close #4, fix #5 and resolves #6',
    'Fixed KarmaCummunity/KC#7',
  ].join('\n');
  assert.deepEqual(parseClosingRefs(body, REPO), [1, 2, 3, 4, 5, 6, 7]);
});

test('parseClosingRefs ignores plain mentions, other repos, code and duplicates', () => {
  const body = [
    'Refs #10. Follow-up to #11.',
    'Closes other/repo#12',
    'Closes #13',
    'closes #13',
    '`Closes #14`',
    '```',
    'Closes #15',
    '```',
    'prefixCloses #16',
  ].join('\n');
  assert.deepEqual(parseClosingRefs(body, REPO), [13]);
});

test('parseClosingRefs handles empty and missing bodies', () => {
  assert.deepEqual(parseClosingRefs('', REPO), []);
  assert.deepEqual(parseClosingRefs(null, REPO), []);
});

function fakeApi(issues, reopenedAt = {}) {
  const closed = [];
  return {
    closed,
    getIssue: async (n) => issues[n] ?? null,
    lastReopenedAt: async (n) => reopenedAt[n] ?? null,
    closeIssue: async (n, comment) => closed.push({ n, comment }),
  };
}

const PR = { number: 50, merged_at: '2026-10-29T10:00:00Z', body: 'Closes #1\nCloses #2\nCloses #3\nCloses #4\nCloses #5' };

test('closeLinkedIssues closes open issues only, skipping PRs, closed and missing items', async () => {
  const api = fakeApi({
    1: { state: 'open' },
    2: { state: 'closed' },
    3: { state: 'open', pull_request: {} },
    4: { state: 'open' },
  });
  const result = await closeLinkedIssues(PR, REPO, api);
  assert.deepEqual(api.closed.map((c) => c.n), [1, 4]);
  assert.match(api.closed[0].comment, /#50/);
  assert.deepEqual(result.closed, [1, 4]);
  assert.deepEqual(result.skipped.map((s) => s.n), [2, 3, 5]);
});

test('closeLinkedIssues leaves an issue reopened after the merge alone', async () => {
  const api = fakeApi({ 1: { state: 'open' }, 4: { state: 'open' } }, { 1: '2026-10-29T12:00:00Z', 4: '2026-10-28T00:00:00Z' });
  const result = await closeLinkedIssues({ ...PR, body: 'Closes #1\nCloses #4' }, REPO, api);
  assert.deepEqual(result.closed, [4]);
  assert.equal(result.skipped[0].reason, 'reopened after merge');
});

test('closeLinkedIssues does nothing for unmerged PRs or dry runs', async () => {
  const api = fakeApi({ 1: { state: 'open' } });
  const unmerged = await closeLinkedIssues({ ...PR, merged_at: null, body: 'Closes #1' }, REPO, api);
  assert.deepEqual(unmerged.closed, []);
  const dry = await closeLinkedIssues({ ...PR, body: 'Closes #1' }, REPO, api, { dryRun: true });
  assert.deepEqual(dry.closed, [1]);
  assert.equal(api.closed.length, 0);
});
