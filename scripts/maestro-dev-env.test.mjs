import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNotProduction,
  bundleUrls,
  extractAnonKey,
  seedPasswordFromEnv,
  KC_DEV_SUPABASE_URL,
  DEFAULT_DEV_WEB_URL,
} from './maestro-dev-env.mjs';

const HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
const jwt = (payload) => `${HEADER}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2ln`;

test('extractAnonKey returns the anon JWT of the requested project only', () => {
  const service = jwt({ role: 'service_role', ref: 'devref' });
  const otherProject = jwt({ role: 'anon', ref: 'otherref' });
  const anon = jwt({ role: 'anon', ref: 'devref' });
  const js = `a="${service}";b="${otherProject}";c="${anon}"`;
  assert.equal(extractAnonKey(js, 'devref'), anon);
});

test('extractAnonKey falls back to a publishable key, else null', () => {
  assert.equal(extractAnonKey('k="sb_publishable_AbC-12_x"', 'devref'), 'sb_publishable_AbC-12_x');
  assert.equal(extractAnonKey('no keys here', 'devref'), null);
});

test('seedPasswordFromEnv reads E2E_SEED_PASSWORD and fails loudly when unset', () => {
  assert.equal(seedPasswordFromEnv({ E2E_SEED_PASSWORD: 'Seed-Pass-1' }), 'Seed-Pass-1');
  assert.throws(() => seedPasswordFromEnv({}), /E2E_SEED_PASSWORD/);
  assert.throws(() => seedPasswordFromEnv({ E2E_SEED_PASSWORD: '  ' }), /E2E_SEED_PASSWORD/);
});

test('assertNotProduction blocks the prod project and the prod domain', () => {
  assert.doesNotThrow(() => assertNotProduction(KC_DEV_SUPABASE_URL, DEFAULT_DEV_WEB_URL));
  assert.throws(() => assertNotProduction('https://kdqtbdbzwvlugkhonexg.supabase.co', DEFAULT_DEV_WEB_URL), /production/);
  assert.throws(() => assertNotProduction(KC_DEV_SUPABASE_URL, 'https://www.karma-community-kc.com'), /production/);
});

test('bundleUrls resolves the Expo web bundles referenced by index.html', () => {
  const html = '<script src="/_expo/static/js/web/entry-abc.js"></script><script src="/other.js"></script>';
  assert.deepEqual(bundleUrls(html, 'https://dev.example.test/'), ['https://dev.example.test/_expo/static/js/web/entry-abc.js']);
});
