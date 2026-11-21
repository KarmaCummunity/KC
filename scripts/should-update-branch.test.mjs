import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideUpdate, overlapping, unitOf } from './should-update-branch.mjs';

const open = { state: 'open', draft: false, mergeable_state: 'behind' };
const base = { pr: open, behindBy: 5, runStatuses: ['completed'], prFiles: ['app/src/a.tsx'], devFiles: ['docs/x.md'] };

test('closed and draft PRs are skipped', () => {
  assert.equal(decideUpdate({ ...base, pr: { ...open, state: 'closed' } }).reason, 'closed');
  assert.equal(decideUpdate({ ...base, pr: { ...open, draft: true } }).reason, 'draft');
});

test('an up-to-date PR is skipped', () => {
  assert.deepEqual(decideUpdate({ ...base, behindBy: 0 }), { decision: 'skip', reason: 'up-to-date', behindBy: 0 });
});

test('a PR whose CI is queued or running is skipped, even when dev overlaps (#1619)', () => {
  for (const s of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
    assert.equal(decideUpdate({ ...base, devFiles: base.prFiles, runStatuses: ['completed', s] }).reason, 'ci-in-flight');
  }
});

test('a conflicting PR is left to its author', () => {
  assert.equal(decideUpdate({ ...base, pr: { ...open, mergeable_state: 'dirty' }, devFiles: base.prFiles }).reason, 'conflict');
});

test('updates when dev changed a file the PR changes', () => {
  assert.deepEqual(decideUpdate({ ...base, devFiles: ['docs/x.md', 'app/src/a.tsx'] }), {
    decision: 'update',
    reason: 'overlap',
    behindBy: 5,
    overlap: ['app/src/a.tsx'],
  });
});

test('updates when both touch one unit without sharing a path (migration numbers, lock files)', () => {
  const r = decideUpdate({ ...base, prFiles: ['supabase/migrations/0092_a.sql'], devFiles: ['supabase/migrations/0092_b.sql'] });
  assert.deepEqual([r.decision, r.overlap], ['update', ['unit:supabase/migrations/']]);
  assert.equal(decideUpdate({ ...base, prFiles: ['app/package.json'], devFiles: ['app/package-lock.json'] }).decision, 'update');
  assert.equal(decideUpdate({ ...base, prFiles: ['supabase/schemas/x.sql'], devFiles: ['supabase/migrations/0093.sql'] }).decision, 'update');
});

test('skips when the dev changes touch nothing the PR touches, unless the PR is very stale', () => {
  assert.equal(decideUpdate(base).reason, 'no-overlap');
  assert.equal(decideUpdate({ ...base, behindBy: 301 }).reason, 'stale');
  assert.equal(decideUpdate({ ...base, behindBy: 301, maxBehind: 400 }).reason, 'no-overlap');
});

test('unitOf matches directory units by prefix and file units exactly', () => {
  assert.equal(unitOf('supabase/baseline/schema.sql'), 0);
  assert.equal(unitOf('app/package.json'), 1);
  assert.equal(unitOf('app/package.json.bak'), -1);
  assert.equal(unitOf('supabase/functions/x.ts'), -1);
  assert.deepEqual(overlapping(['a', 'b'], ['b', 'c']), ['b']);
});
