// Unit tests for scripts/mobile-nightly-resolve.mjs. Run: node --test scripts/mobile-nightly-resolve.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, planNightly, shippedTags } from './mobile-nightly-resolve.mjs';

const tagRef = (name, sha, type = 'commit') => ({ ref: `refs/tags/${name}`, object: { type, sha } });

test('shippedTags groups lightweight tags by commit and ignores annotated tags', () => {
  const shipped = shippedTags([
    tagRef('mobile/v1.5.3-ios14-android22', 'a'),
    tagRef('mobile/v1.5.3-ios15-android23', 'a'),
    tagRef('mobile/v1.5.4-ios16-android24', 'tagobj', 'tag'),
  ]);
  assert.deepEqual([...shipped], [['a', ['mobile/v1.5.3-ios14-android22', 'mobile/v1.5.3-ios15-android23']]]);
});

test('builds a green commit that has no shipped tag', () => {
  assert.deepEqual(planNightly({ greenSha: 'b', shipped: shippedTags([tagRef('mobile/v1-ios1-android1', 'a')]), force: false }), {
    build: true,
    reason: 'new green commit',
  });
});

test('skips a commit that already shipped, even if an earlier record step failed', () => {
  const r = planNightly({ greenSha: 'a', shipped: shippedTags([tagRef('mobile/v1-ios1-android1', 'a')]), force: false });
  assert.equal(r.build, false);
  assert.match(r.reason, /already shipped as mobile\/v1-ios1-android1/);
});

test('force rebuilds a shipped commit', () => {
  assert.equal(planNightly({ greenSha: 'a', shipped: shippedTags([tagRef('mobile/v1-ios1-android1', 'a')]), force: true }).build, true);
});

test('planNightly refuses to plan without a green commit', () => {
  assert.throws(() => planNightly({ greenSha: null, shipped: new Map(), force: true }), /green SHA/);
});

test('parseVersion accepts MAJOR.MINOR.PATCH and rejects anything else', () => {
  assert.equal(parseVersion('1.5.3\n'), '1.5.3');
  assert.throws(() => parseVersion('1.5'), /MAJOR\.MINOR\.PATCH/);
  assert.throws(() => parseVersion('v1.5.3'), /MAJOR\.MINOR\.PATCH/);
});
