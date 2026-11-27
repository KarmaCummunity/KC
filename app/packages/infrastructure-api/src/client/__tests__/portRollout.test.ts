import { describe, expect, it } from 'vitest';
import { isAtLeastVersion, isServedTo, needsMemberId, rolloutBucket } from '../portRollout';

/** Member ids shaped like the real ones, generated without randomness so the test is repeatable. */
const memberIds = Array.from({ length: 5000 }, (_unused, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`);

describe('rolloutBucket', () => {
  it('gives a member the same place every time, from 0 to 99', () => {
    for (const id of memberIds.slice(0, 200)) {
      const bucket = rolloutBucket(id, 'post');
      expect(bucket).toBe(rolloutBucket(id, 'post'));
      expect(Number.isInteger(bucket) && bucket >= 0 && bucket <= 99).toBe(true);
    }
  });

  it('spreads members evenly enough for a share to mean what it says', () => {
    for (const percent of [1, 10, 50]) {
      const inside = memberIds.filter((id) => rolloutBucket(id, 'post') < percent).length;
      const share = (inside / memberIds.length) * 100;
      expect(Math.abs(share - percent), `${percent}% served ${share.toFixed(2)}%`).toBeLessThan(percent * 0.2 + 0.7);
    }
  });

  it('places a member differently per port, so one group is not first for everything', () => {
    const sameInBoth = memberIds.filter((id) => rolloutBucket(id, 'post') === rolloutBucket(id, 'chat')).length;

    // Independent places agree about one time in a hundred.
    expect(sameInBoth / memberIds.length).toBeLessThan(0.03);
  });
});

describe('isServedTo', () => {
  const member = { memberId: memberIds[0] as string, appVersion: '1.6.2' };

  it('keeps everyone who was in when the share grows', () => {
    const at10 = memberIds.filter((id) => isServedTo('post', { percent: 10 }, { memberId: id, appVersion: null }));
    const at50 = new Set(memberIds.filter((id) => isServedTo('post', { percent: 50 }, { memberId: id, appVersion: null })));

    expect(at10.length).toBeGreaterThan(0);
    expect(at10.every((id) => at50.has(id))).toBe(true);
  });

  it('serves everyone with no rule or a full share, and no one at zero', () => {
    expect(isServedTo('post', undefined, { memberId: null, appVersion: null })).toBe(true);
    expect(isServedTo('post', { percent: 100 }, { memberId: null, appVersion: null })).toBe(true);
    expect(isServedTo('post', {}, { memberId: null, appVersion: null })).toBe(true);
    expect(memberIds.some((id) => isServedTo('post', { percent: 0 }, { memberId: id, appVersion: null }))).toBe(false);
  });

  it('leaves a visitor out of a partial share', () => {
    expect(isServedTo('post', { percent: 99 }, { memberId: null, appVersion: '9.9.9' })).toBe(false);
  });

  it('checks the app version before the share', () => {
    expect(isServedTo('post', { percent: 100, minAppVersion: '1.6.3' }, member)).toBe(false);
    expect(isServedTo('post', { percent: 100, minAppVersion: '1.6.2' }, member)).toBe(true);
  });
});

describe('isAtLeastVersion', () => {
  it.each([
    ['1.6.0', '1.6.0', true],
    ['1.6.1', '1.6.0', true],
    ['1.10.0', '1.9.9', true],
    ['2.0.0', '1.99.99', true],
    ['1.5.9', '1.6.0', false],
    ['1.6.0', '1.6.1', false],
    ['0.9.0', '1.0.0', false],
    // A build suffix does not change the version it is a build of.
    ['1.6.0-beta.2', '1.6.0', true],
  ])('%s against a minimum of %s is %s', (version, minimum, expected) => {
    expect(isAtLeastVersion(version, minimum)).toBe(expected);
  });

  it('treats a version it cannot read, on either side, as not new enough', () => {
    expect(isAtLeastVersion(null, '1.0.0')).toBe(false);
    expect(isAtLeastVersion('latest', '1.0.0')).toBe(false);
    expect(isAtLeastVersion('1.6', '1.0.0')).toBe(false);
    expect(isAtLeastVersion('1.6.0', 'soon')).toBe(false);
  });
});

describe('needsMemberId', () => {
  it('is true only for a share that is neither everyone nor no one', () => {
    expect([undefined, {}, { percent: 100 }, { percent: 0 }, { minAppVersion: '1.0.0' }].map(needsMemberId)).toEqual([false, false, false, false, false]);
    expect([{ percent: 1 }, { percent: 99 }].map(needsMemberId)).toEqual([true, true]);
  });
});
