import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from './sync-eas-sentry-token.mjs';

test('plan updates a variable that only covers the target environment', () => {
  assert.deepEqual(plan([{ id: 'a', environments: ['preview'] }], 'preview'), { action: 'update', id: 'a' });
});

test('plan splits the target off a shared variable, keeping the others', () => {
  assert.deepEqual(plan([{ id: 'a', environments: ['preview', 'production'] }], 'preview'), {
    action: 'split',
    id: 'a',
    keep: ['production'],
  });
});

test('plan creates when no variable covers the target', () => {
  assert.deepEqual(plan([{ id: 'a', environments: ['production'] }], 'preview'), { action: 'create' });
  assert.deepEqual(plan([], 'production'), { action: 'create' });
});

test('plan matches environments case-insensitively', () => {
  assert.deepEqual(plan([{ id: 'a', environments: ['PREVIEW', 'PRODUCTION'] }], 'preview'), {
    action: 'split',
    id: 'a',
    keep: ['PRODUCTION'],
  });
});
