import { assert, assertEquals } from 'jsr:@std/assert@1';
import { checkLimits, DEFAULT_LIMITS, importLockedUntil, lockoutLookbackMs, type LimitInputs } from './limits.ts';

const NOW = new Date('2026-11-16T12:00:00Z');
const ok: LimitInputs = {
  accountCreatedAt: new Date('2026-11-01T00:00:00Z'), now: NOW,
  attemptsLastHour: 0, attemptsLastDay: 0, providerCallsToday: 0, moderationRemovals: [],
};
const DAY = 24 * 3600_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

Deno.test('an established member under every limit may run', () => {
  assertEquals(checkLimits(ok), null);
});

Deno.test('an account younger than 24 hours cannot import; exactly 24 hours can', () => {
  assertEquals(checkLimits({ ...ok, accountCreatedAt: new Date(NOW.getTime() - 23 * 3600_000) }), 'account_too_new');
  assertEquals(checkLimits({ ...ok, accountCreatedAt: new Date(NOW.getTime() - 24 * 3600_000) }), null);
});

Deno.test('an unknown account age fails closed', () => {
  assertEquals(checkLimits({ ...ok, accountCreatedAt: null }), 'account_too_new');
});

Deno.test('the hourly limit is 5 and the daily limit 20', () => {
  assertEquals(checkLimits({ ...ok, attemptsLastHour: 4 }), null);
  assertEquals(checkLimits({ ...ok, attemptsLastHour: 5 }), 'rate_limited');
  assertEquals(checkLimits({ ...ok, attemptsLastDay: 19 }), null);
  assertEquals(checkLimits({ ...ok, attemptsLastDay: 20 }), 'rate_limited');
});

Deno.test('the daily provider budget stops the whole service', () => {
  assertEquals(checkLimits({ ...ok, providerCallsToday: DEFAULT_LIMITS.dailyBudget - 1 }), null);
  assertEquals(checkLimits({ ...ok, providerCallsToday: DEFAULT_LIMITS.dailyBudget }), 'budget_exhausted');
});

Deno.test('a member limit is reported before the shared budget', () => {
  assertEquals(checkLimits({ ...ok, attemptsLastHour: 9, providerCallsToday: 99999 }), 'rate_limited');
});

Deno.test('the limits are config', () => {
  assertEquals(checkLimits({ ...ok, attemptsLastHour: 1 }, { ...DEFAULT_LIMITS, perHour: 1 }), 'rate_limited');
});

// ── FR-IMPORT-008 AC4: 3 moderation removals in 30 days lock imports for 14 days ─────────────────
Deno.test('two removals never lock', () => {
  assertEquals(importLockedUntil([daysAgo(1), daysAgo(2)], NOW), null);
});

Deno.test('three removals within 30 days lock for 14 days from the third', () => {
  const until = importLockedUntil([daysAgo(20), daysAgo(10), daysAgo(1)], NOW);
  assertEquals(until?.toISOString(), new Date(daysAgo(1).getTime() + 14 * DAY).toISOString());
  assertEquals(checkLimits({ ...ok, moderationRemovals: [daysAgo(20), daysAgo(10), daysAgo(1)] }), 'import_locked');
});

Deno.test('the order the store returns them in does not matter', () => {
  assertEquals(importLockedUntil([daysAgo(1), daysAgo(20), daysAgo(10)], NOW)?.getTime(), daysAgo(1).getTime() + 14 * DAY);
});

Deno.test('three removals spread over more than 30 days do not lock', () => {
  assertEquals(importLockedUntil([daysAgo(35), daysAgo(10), daysAgo(1)], NOW), null);
});

Deno.test('exactly 30 days between the first and the third still locks', () => {
  assert(importLockedUntil([daysAgo(31), daysAgo(15), daysAgo(1)], NOW) !== null);
});

Deno.test('the lock ends 14 days after the removal that started it', () => {
  // Third removal 14 days and one minute ago: the lock has just ended.
  const third = new Date(NOW.getTime() - 14 * DAY - 60_000);
  assertEquals(importLockedUntil([daysAgo(25), daysAgo(20), third], NOW), null);
  // One minute later the lock would still run.
  const recent = new Date(NOW.getTime() - 14 * DAY + 60_000);
  assert(importLockedUntil([daysAgo(25), daysAgo(20), recent], NOW) !== null);
});

Deno.test('a later run extends the lock to its own end', () => {
  const until = importLockedUntil([daysAgo(40), daysAgo(38), daysAgo(36), daysAgo(5), daysAgo(4), daysAgo(3)], NOW);
  assertEquals(until?.getTime(), daysAgo(3).getTime() + 14 * DAY);
});

Deno.test('the lock is reported after account age and before the rate limits', () => {
  const locked = [daysAgo(3), daysAgo(2), daysAgo(1)];
  assertEquals(checkLimits({ ...ok, accountCreatedAt: daysAgo(0), moderationRemovals: locked }), 'account_too_new');
  assertEquals(checkLimits({ ...ok, attemptsLastHour: 99, moderationRemovals: locked }), 'import_locked');
});

Deno.test('the store reads back as far as a window and a lock', () => {
  assertEquals(lockoutLookbackMs(), 44 * DAY);
});

