import { assertEquals } from 'jsr:@std/assert@1';
import { checkLimits, DEFAULT_LIMITS, type LimitInputs } from './limits.ts';

const NOW = new Date('2026-11-16T12:00:00Z');
const ok: LimitInputs = {
  accountCreatedAt: new Date('2026-11-01T00:00:00Z'), now: NOW,
  attemptsLastHour: 0, attemptsLastDay: 0, providerCallsToday: 0,
};

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
