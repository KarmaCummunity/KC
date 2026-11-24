// Unit tests for scripts/mobile-nightly-resolve.mjs. Run: node --test scripts/mobile-nightly-resolve.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVersionGate,
  nightlyEnabled,
  parseVersion,
  planNightly,
  planNightlyPlatforms,
  platformTag,
  readReleaseTags,
  requestedPlatforms,
  shippedTags,
  shippedTagsFor,
  versionPrNeeded,
} from './mobile-nightly-resolve.mjs';

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

test('platformTag names one platform build', () => {
  assert.equal(platformTag('ios', '1.9.121', 33), 'mobile/ios/v1.9.121-b33');
  assert.equal(platformTag('android', '1.9.121', 14), 'mobile/android/v1.9.121-c14');
});

test('shippedTagsFor: per-platform tags count only for their platform, legacy tags for both', () => {
  const refs = [
    tagRef('mobile/ios/v1.9.1-b33', 'a'),
    tagRef('mobile/android/v1.9.1-c14', 'b'),
    tagRef('mobile/v1.9.0-ios30-android12', 'c'),
  ];
  assert.deepEqual([...shippedTagsFor(refs, 'ios').keys()].sort(), ['a', 'c']);
  assert.deepEqual([...shippedTagsFor(refs, 'android').keys()].sort(), ['b', 'c']);
});

test('only the platform that has not shipped is rebuilt', () => {
  const refs = [tagRef('mobile/ios/v1.9.1-b33', 'a')];
  const plan = planNightlyPlatforms({ greenSha: 'a', refs, force: false, platform: 'both' });
  assert.equal(plan.ios.build, false);
  assert.equal(plan.android.build, true);
});

test('platform input and kill switches limit the plan', () => {
  const ios = planNightlyPlatforms({ greenSha: 'a', refs: [], force: false, platform: 'ios' });
  assert.deepEqual([ios.ios.build, ios.android.build], [true, false]);
  const off = planNightlyPlatforms({
    greenSha: 'a',
    refs: [],
    force: true,
    platform: 'both',
    env: { KC_NIGHTLY_ANDROID_ENABLED: 'false' },
  });
  assert.deepEqual([off.ios.build, off.android.build], [true, false]);
  assert.match(off.android.reason, /KC_NIGHTLY_ANDROID_ENABLED=false/);
  assert.throws(() => planNightlyPlatforms({ greenSha: 'a', refs: [], force: false, platform: 'web' }), /PLATFORM/);
  assert.throws(
    () => planNightlyPlatforms({ greenSha: 'a', refs: [], force: false, env: { KC_NIGHTLY_IOS_ENABLED: 'no' } }),
    /KC_NIGHTLY_IOS_ENABLED/,
  );
});

test('nightlyEnabled defaults on and requestedPlatforms defaults to both', () => {
  assert.equal(nightlyEnabled('ios', {}).enabled, true);
  assert.equal(nightlyEnabled('ios', { KC_NIGHTLY_IOS_ENABLED: 'true' }).enabled, true);
  assert.equal(nightlyEnabled('android', { KC_NIGHTLY_ANDROID_ENABLED: 'false' }).enabled, false);
  assert.deepEqual(requestedPlatforms(''), ['ios', 'android']);
});

// Version at release time (#2613).
test('applyVersionGate: ahead keeps the plan; not ahead skips every platform even when forced', () => {
  const plan = { ios: { build: true, reason: 'forced by the `force` input' }, android: { build: false, reason: 'disabled' } };
  assert.equal(applyVersionGate(plan, { ahead: true }), plan);
  const gated = applyVersionGate(plan, { ahead: false, reason: 'app/VERSION 1.9.290 is not ahead of the released v1.9.290' });
  assert.deepEqual(gated.ios, { build: false, reason: 'app/VERSION 1.9.290 is not ahead of the released v1.9.290' });
  assert.deepEqual(gated.android, plan.android);
});

test('versionPrNeeded only when the gate stopped a real build and knows the next version', () => {
  const would = { ios: { build: true }, android: { build: false } };
  const none = { ios: { build: false }, android: { build: false } };
  assert.equal(versionPrNeeded(would, { ahead: false, next: '1.9.291' }), true);
  assert.equal(versionPrNeeded(none, { ahead: false, next: '1.9.291' }), false);
  assert.equal(versionPrNeeded(would, { ahead: true, next: null }), false);
  assert.equal(versionPrNeeded(would, { ahead: false, next: null }), false, 'API failure: skip, no PR');
});

test('readReleaseTags returns null on an API failure (the gate then skips)', async () => {
  const logs = [];
  assert.equal(await readReleaseTags(async () => { throw new Error('HTTP 502'); }, 'o/r', (m) => logs.push(m)), null);
  assert.match(logs[0], /Could not read the release tags: HTTP 502/);
  assert.deepEqual(await readReleaseTags(async () => [{ ref: 'refs/tags/v1.9.290' }], 'o/r'), ['v1.9.290']);
});
