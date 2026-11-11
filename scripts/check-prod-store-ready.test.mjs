import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProdStoreReady } from './check-prod-store-ready.mjs';

const PROD = 'kdqtbdbzwvlugkhonexg';
const allowed = ['0001_baseline.sql', '0002_followup.sql'];
const ledger = [{ version: '0001' }, { version: '0002' }];

test('evaluateProdStoreReady fails closed when the flag or mode is unset, even if the ledger looks right', () => {
  const errors = evaluateProdStoreReady({
    enabled: undefined,
    mode: undefined,
    allowed,
    projectRef: PROD,
    ledger,
  });
  assert.ok(errors.some((e) => e.includes('KC_PROD_STORE_BUILD_ENABLED')));
  assert.ok(errors.some((e) => e.includes('KC_PROD_SCHEMA_MODE=baseline')));
});

test('evaluateProdStoreReady refuses an empty ledger and an empty allowlist', () => {
  const errors = evaluateProdStoreReady({
    enabled: 'true',
    mode: 'baseline',
    allowed: [],
    projectRef: PROD,
    ledger: [],
  });
  assert.ok(errors.some((e) => /non-empty supabase\/baseline\/prod-allowed-migrations/.test(e)));
  assert.ok(errors.some((e) => /ledger is empty/.test(e)));
});

test('evaluateProdStoreReady refuses a ledger that does not exactly match the allowlist', () => {
  const errors = evaluateProdStoreReady({
    enabled: 'true',
    mode: 'baseline',
    allowed,
    projectRef: PROD,
    ledger: [{ version: '0001' }],
  });
  assert.ok(errors.some((e) => /does not match the approved baseline/.test(e)));
});

test('evaluateProdStoreReady passes only when flag, baseline mode, and exact ledger all hold', () => {
  const errors = evaluateProdStoreReady({
    enabled: 'true',
    mode: 'baseline',
    allowed,
    projectRef: PROD,
    ledger,
  });
  assert.deepEqual(errors, []);
});

test('evaluateProdStoreReady still flags a myself hook or the wrong project', () => {
  const hookErrors = evaluateProdStoreReady({
    enabled: 'true',
    mode: 'baseline',
    allowed,
    projectRef: PROD,
    ledger,
    myselfAuthHits: ['hook_custom_access_token_uri=https://kdqtbdbzwvlugkhonexg.supabase.co/functions/v1/myself'],
  });
  assert.ok(hookErrors.some((e) => /myself/i.test(e)));

  const refErrors = evaluateProdStoreReady({
    enabled: 'true',
    mode: 'baseline',
    allowed,
    projectRef: 'enbqriuxvvuontiwslun',
    ledger,
  });
  assert.ok(refErrors.some((e) => /SUPABASE_PROJECT_REF must be the prod project/.test(e)));
});
