import { expect, it } from 'vitest';
import { checkLimits, DEFAULT_LIMITS, importLockedUntil, type LimitInputs, lockoutLookbackMs } from '../importLimits';

const NOW = new Date('2026-11-16T12:00:00Z');
const ok: LimitInputs = {
  accountCreatedAt: new Date('2026-11-01T00:00:00Z'), now: NOW,
  attemptsLastHour: 0, attemptsLastDay: 0, providerCallsToday: 0, moderationRemovals: [],
};
const DAY = 24 * 3600_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

it('an established member under every limit may run', () => {
  expect(checkLimits(ok)).toEqual(null);
});

it('an account younger than 24 hours cannot import; exactly 24 hours can', () => {
  expect(checkLimits({ ...ok, accountCreatedAt: new Date(NOW.getTime() - 23 * 3600_000) })).toEqual('account_too_new');
  expect(checkLimits({ ...ok, accountCreatedAt: new Date(NOW.getTime() - 24 * 3600_000) })).toEqual(null);
});

it('an unknown account age fails closed', () => {
  expect(checkLimits({ ...ok, accountCreatedAt: null })).toEqual('account_too_new');
});

it('the hourly limit is 5 and the daily limit 20', () => {
  expect(checkLimits({ ...ok, attemptsLastHour: 4 })).toEqual(null);
  expect(checkLimits({ ...ok, attemptsLastHour: 5 })).toEqual('rate_limited');
  expect(checkLimits({ ...ok, attemptsLastDay: 19 })).toEqual(null);
  expect(checkLimits({ ...ok, attemptsLastDay: 20 })).toEqual('rate_limited');
});

it('the daily provider budget stops the whole service', () => {
  expect(checkLimits({ ...ok, providerCallsToday: DEFAULT_LIMITS.dailyBudget - 1 })).toEqual(null);
  expect(checkLimits({ ...ok, providerCallsToday: DEFAULT_LIMITS.dailyBudget })).toEqual('budget_exhausted');
});

it('a member limit is reported before the shared budget', () => {
  expect(checkLimits({ ...ok, attemptsLastHour: 9, providerCallsToday: 99999 })).toEqual('rate_limited');
});

it('the limits are config', () => {
  expect(checkLimits({ ...ok, attemptsLastHour: 1 }, { ...DEFAULT_LIMITS, perHour: 1 })).toEqual('rate_limited');
});

// ── FR-IMPORT-008 AC4: 3 moderation removals in 30 days lock imports for 14 days ─────────────────
it('two removals never lock', () => {
  expect(importLockedUntil([daysAgo(1), daysAgo(2)], NOW)).toEqual(null);
});

it('three removals within 30 days lock for 14 days from the third', () => {
  const until = importLockedUntil([daysAgo(20), daysAgo(10), daysAgo(1)], NOW);
  expect(until?.toISOString()).toEqual(new Date(daysAgo(1).getTime() + 14 * DAY).toISOString());
  expect(checkLimits({ ...ok, moderationRemovals: [daysAgo(20), daysAgo(10), daysAgo(1)] })).toEqual('import_locked');
});

it('the order the store returns them in does not matter', () => {
  expect(importLockedUntil([daysAgo(1), daysAgo(20), daysAgo(10)], NOW)?.getTime()).toEqual(daysAgo(1).getTime() + 14 * DAY);
});

it('three removals spread over more than 30 days do not lock', () => {
  expect(importLockedUntil([daysAgo(35), daysAgo(10), daysAgo(1)], NOW)).toEqual(null);
});

it('exactly 30 days between the first and the third still locks', () => {
  expect(importLockedUntil([daysAgo(31), daysAgo(15), daysAgo(1)], NOW) !== null).toBe(true);
});

it('the lock ends 14 days after the removal that started it', () => {
  // Third removal 14 days and one minute ago: the lock has just ended.
  const third = new Date(NOW.getTime() - 14 * DAY - 60_000);
  expect(importLockedUntil([daysAgo(25), daysAgo(20), third], NOW)).toEqual(null);
  // One minute later the lock would still run.
  const recent = new Date(NOW.getTime() - 14 * DAY + 60_000);
  expect(importLockedUntil([daysAgo(25), daysAgo(20), recent], NOW) !== null).toBe(true);
});

it('a later run extends the lock to its own end', () => {
  const until = importLockedUntil([daysAgo(40), daysAgo(38), daysAgo(36), daysAgo(5), daysAgo(4), daysAgo(3)], NOW);
  expect(until?.getTime()).toEqual(daysAgo(3).getTime() + 14 * DAY);
});

it('the lock is reported after account age and before the rate limits', () => {
  const locked = [daysAgo(3), daysAgo(2), daysAgo(1)];
  expect(checkLimits({ ...ok, accountCreatedAt: daysAgo(0), moderationRemovals: locked })).toEqual('account_too_new');
  expect(checkLimits({ ...ok, attemptsLastHour: 99, moderationRemovals: locked })).toEqual('import_locked');
});

it('the store reads back as far as a window and a lock', () => {
  expect(lockoutLookbackMs()).toEqual(44 * DAY);
});
