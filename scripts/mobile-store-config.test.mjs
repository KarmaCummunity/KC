// Unit tests for scripts/mobile-store-config.mjs. Run: node --test scripts/mobile-store-config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_REF, DEV_URL, PROD_REF, checkAnonKey, checkBundle, checkPin, injectProfileEnv } from './mobile-store-config.mjs';

/** Build an unsigned JWT with the given payload (only the payload is inspected). */
const jwt = (payload) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

test('pins the dev backend for a dev build with a publishable key', () => {
  assert.deepEqual(checkPin({ branch: 'dev', anonKey: 'sb_publishable_x' }), []);
});

test('refuses any source branch other than dev', () => {
  assert.match(checkPin({ branch: 'main', anonKey: 'sb_publishable_x' })[0], /must come from dev \(got "main"\)/);
  assert.match(checkPin({ branch: undefined, anonKey: 'sb_publishable_x' })[0], /got ""/);
});

test('refuses a missing key', () => {
  assert.deepEqual(checkPin({ branch: 'dev', anonKey: '' }), ['MOBILE_SUPABASE_ANON_KEY is not set']);
});

test('accepts a legacy anon JWT of the dev project', () => {
  assert.deepEqual(checkAnonKey(jwt({ ref: DEV_REF, role: 'anon' }), DEV_REF), []);
});

test('rejects the prod anon key for a dev build', () => {
  const errors = checkPin({ branch: 'dev', anonKey: jwt({ ref: PROD_REF, role: 'anon' }) });
  assert.deepEqual(errors, [`MOBILE_SUPABASE_ANON_KEY belongs to project "${PROD_REF}", not "${DEV_REF}"`]);
});

test('rejects service-role and secret keys', () => {
  assert.match(checkAnonKey(jwt({ ref: DEV_REF, role: 'service_role' }), DEV_REF)[0], /role "service_role"/);
  assert.match(checkAnonKey('sb_secret_abc', DEV_REF)[0], /secret key/);
});

test('rejects a value that is not a Supabase key', () => {
  assert.match(checkAnonKey('not-a-key', DEV_REF)[0], /neither/);
});

test('a bundle with only the dev URL passes', () => {
  assert.deepEqual(checkBundle(Buffer.from(`\u0000hbc\u0000${DEV_URL}\u0000`)), []);
});

test('a bundle without the dev URL fails', () => {
  assert.deepEqual(checkBundle(Buffer.from('nothing here')), [`bundle does not contain the kc-dev URL ${DEV_URL}`]);
});

test('a bundle that also mentions the prod project fails', () => {
  const errors = checkBundle(Buffer.from(`${DEV_URL} https://${PROD_REF}.supabase.co`));
  assert.deepEqual(errors, [`bundle contains the prod project ref ${PROD_REF}`]);
});

test('injectProfileEnv merges into one profile and keeps the rest untouched', () => {
  const eas = { cli: {}, build: { nightly: { env: { A: '1' } }, preview: { env: { B: '2' } } } };
  const next = injectProfileEnv(eas, 'nightly', { C: '3' });
  assert.deepEqual(next.build.nightly.env, { A: '1', C: '3' });
  assert.deepEqual(next.build.preview, { env: { B: '2' } });
  assert.deepEqual(eas.build.nightly.env, { A: '1' });
});

test('injectProfileEnv fails on an unknown profile', () => {
  assert.throws(() => injectProfileEnv({ build: {} }, 'nightly', {}), /no build profile "nightly"/);
});
