// Unit tests for scripts/deploy-preflight.mjs. Run: node --test scripts/deploy-preflight.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TARGETS, checkProjectActive, checkSupabaseEnv, checkWebEnv } from './deploy-preflight.mjs';

const AGE = `age1${'q'.repeat(58)}`;
const SUPABASE_PROD = {
  SUPABASE_ACCESS_TOKEN: 'sbp_x',
  SUPABASE_DB_PASSWORD: 'pw',
  SUPABASE_PROJECT_REF: TARGETS.prod.ref,
  BACKUP_AGE_RECIPIENT: AGE,
};
const WEB_DEV = {
  CLOUDFLARE_API_TOKEN: 't',
  CLOUDFLARE_ACCOUNT_ID: 'f'.repeat(32),
  EXPO_PUBLIC_SUPABASE_URL: `https://${TARGETS.dev.ref}.supabase.co`,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_x',
  EXPO_PUBLIC_ENVIRONMENT: 'development',
  WEB_URL: 'https://dev.karma-community.pages.dev',
};

test('a complete prod Supabase environment passes', () => {
  assert.deepEqual(checkSupabaseEnv('prod', SUPABASE_PROD), []);
});

test('a dev secret pointing at the prod project is refused', () => {
  const errors = checkSupabaseEnv('dev', { ...SUPABASE_PROD, BACKUP_AGE_RECIPIENT: '' });
  assert.deepEqual(errors, [`SUPABASE_PROJECT_REF must be the dev project ${TARGETS.dev.ref} (got another value)`]);
});

test('prod needs the backup recipient; dev does not', () => {
  assert.match(checkSupabaseEnv('prod', { ...SUPABASE_PROD, BACKUP_AGE_RECIPIENT: '' })[0], /BACKUP_AGE_RECIPIENT/);
  assert.deepEqual(checkSupabaseEnv('dev', { ...SUPABASE_PROD, SUPABASE_PROJECT_REF: TARGETS.dev.ref, BACKUP_AGE_RECIPIENT: '' }), []);
});

test('a project API key in place of the account token is refused, and missing values are named', () => {
  const errors = checkSupabaseEnv('prod', { SUPABASE_ACCESS_TOKEN: 'sb_secret_x' });
  assert.equal(errors.length, 4);
  assert.match(errors[0], /account token/);
  assert.match(errors[2], /got nothing/);
});

test('a complete dev web environment passes', () => {
  assert.deepEqual(checkWebEnv('dev', WEB_DEV), []);
});

test('web settings must match the target project, environment and URL', () => {
  const errors = checkWebEnv('prod', { ...WEB_DEV, CLOUDFLARE_ACCOUNT_ID: 'abc', WEB_URL: 'http://x' });
  assert.deepEqual(errors, [
    'CLOUDFLARE_ACCOUNT_ID must be a 32-hex Cloudflare account id',
    `EXPO_PUBLIC_SUPABASE_URL must be https://${TARGETS.prod.ref}.supabase.co for prod`,
    'EXPO_PUBLIC_ENVIRONMENT must be "production" for prod',
    'the prod web URL variable (KC_PROD_URL) must be an https origin',
  ]);
});

test('checkProjectActive accepts only ACTIVE_HEALTHY', async () => {
  const reply = (ok, status, body) => async () => ({ ok, status, json: async () => body });
  assert.deepEqual(await checkProjectActive({ ref: 'r', token: 't', fetch: reply(true, 200, { status: 'ACTIVE_HEALTHY' }) }), []);
  assert.match((await checkProjectActive({ ref: 'r', token: 't', fetch: reply(true, 200, { status: 'INACTIVE' }) }))[0], /is INACTIVE/);
  assert.match((await checkProjectActive({ ref: 'r', token: 't', fetch: reply(false, 401, {}) }))[0], /HTTP 401/);
});
