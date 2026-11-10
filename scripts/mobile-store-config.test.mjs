// Unit tests for scripts/mobile-store-config.mjs. Run: node --test scripts/mobile-store-config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_REF, DEV_URL, PROD_REF, PROD_URL, checkAnonKey, checkBundle, checkPin, injectProfileEnv, resolveStoreBackend, sentryVars } from './mobile-store-config.mjs';

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

test('sentryVars keeps only the non-secret Sentry settings that are set', () => {
  assert.deepEqual(
    sentryVars({ EXPO_PUBLIC_SENTRY_DSN: ' https://k@o1.ingest.sentry.io/1 ', SENTRY_ORG: 'org', SENTRY_URL: '', SENTRY_AUTH_TOKEN: 'secret', OTHER: 'x' }),
    { EXPO_PUBLIC_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1', SENTRY_ORG: 'org' },
  );
  assert.deepEqual(sentryVars({}), {});
});

test('resolveStoreBackend is prod only for the exact token, otherwise dev', () => {
  assert.equal(resolveStoreBackend('prod'), 'prod');
  assert.equal(resolveStoreBackend(' prod '), 'prod');
  assert.equal(resolveStoreBackend('production'), 'dev');
  assert.equal(resolveStoreBackend('dev'), 'dev');
  assert.equal(resolveStoreBackend(''), 'dev');
  assert.equal(resolveStoreBackend(undefined), 'dev');
});

test('pins the prod backend for a main build with a publishable or prod anon JWT', () => {
  assert.deepEqual(checkPin({ branch: 'main', anonKey: 'sb_publishable_x', mode: 'prod' }), []);
  assert.deepEqual(checkPin({ branch: 'main', anonKey: jwt({ ref: PROD_REF, role: 'anon' }), mode: 'prod' }), []);
});

test('prod mode refuses any source branch other than main and a kc-dev key', () => {
  assert.match(checkPin({ branch: 'dev', anonKey: 'sb_publishable_x', mode: 'prod' })[0], /must come from main \(got "dev"\)/);
  const errors = checkPin({ branch: 'main', anonKey: jwt({ ref: DEV_REF, role: 'anon' }), mode: 'prod' });
  assert.deepEqual(errors, [`MOBILE_SUPABASE_ANON_KEY belongs to project "${DEV_REF}", not "${PROD_REF}"`]);
});

test('a bundle with only the prod URL passes in prod mode and fails in dev mode', () => {
  const prodOnly = Buffer.from(`\u0000hbc\u0000${PROD_URL}\u0000`);
  assert.deepEqual(checkBundle(prodOnly, 'prod'), []);
  assert.ok(checkBundle(prodOnly).some((e) => e.includes('kc-dev URL')));
});

test('a bundle without the prod URL fails in prod mode', () => {
  assert.deepEqual(
    checkBundle(Buffer.from('nothing here'), 'prod'),
    [`bundle does not contain the kc-prod URL ${PROD_URL}`],
  );
});

test('a bundle that also mentions the dev project fails in prod mode', () => {
  const errors = checkBundle(Buffer.from(`${PROD_URL} ${DEV_URL}`), 'prod');
  assert.deepEqual(errors, [`bundle contains the kc-dev project ref ${DEV_REF}`]);
});
