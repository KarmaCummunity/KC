/**
 * Unit coverage for the E2E post_create budget helpers (#2444).
 * Pure: no network. Proves the fail-fast message names the limit and the start gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POST_CREATE_MAX,
  POST_CREATE_WINDOW_LABEL,
  POSTS_PER_FULL_RUN_AS_USER_A,
  decidePostCreateBudget,
  exhaustedBudgetMessage,
  isRateLimitedError,
} from '../tests/e2e/lib/postCreateBudget.mjs';

test('constants match the deployed post_create rule and the suite\'s documented spend', () => {
  assert.equal(POST_CREATE_MAX, 20);
  assert.equal(POSTS_PER_FULL_RUN_AS_USER_A, 9);
  assert.equal(POST_CREATE_WINDOW_LABEL, '1 hour');
  // Two clean runs fit; a third does not — the bug this helper surfaces.
  assert.ok(2 * POSTS_PER_FULL_RUN_AS_USER_A <= POST_CREATE_MAX);
  assert.ok(3 * POSTS_PER_FULL_RUN_AS_USER_A > POST_CREATE_MAX);
});

test('decidePostCreateBudget allows a full run when enough of the window remains', () => {
  const ok = decidePostCreateBudget({ used: 11, email: 'user1@seed.kc.test' });
  assert.equal(ok.ok, true);
  assert.equal(ok.remaining, 9);
});

test('decidePostCreateBudget refuses a full run when the window cannot cover it', () => {
  const blocked = decidePostCreateBudget({ used: 12, email: 'user1@seed.kc.test' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 8);
  assert.match(blocked.message, /post_create budget exhausted for user1@seed\.kc\.test/);
  assert.match(blocked.message, /20 new posts per 1 hour/);
  assert.match(blocked.message, /not a product regression/);
  assert.match(blocked.message, /About 12 post\(s\) already count/);
});

test('exhaustedBudgetMessage still names the limit when usage is unknown', () => {
  const msg = exhaustedBudgetMessage({ email: 'user1@seed.kc.test' });
  assert.match(msg, /post_create/);
  assert.match(msg, /20 new posts per 1 hour/);
  assert.doesNotMatch(msg, /About \d+ post/);
});

test('isRateLimitedError recognises the server refusal shape', () => {
  assert.equal(isRateLimitedError('400 posts: rate_limited'), true);
  assert.equal(isRateLimitedError(new Error('400 rpc/create_post_with_details: rate_limited')), true);
  assert.equal(isRateLimitedError('400 posts: post_limit_exceeded'), false);
});
