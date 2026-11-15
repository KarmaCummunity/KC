import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEdgeConfig, renderEdgeConfigModule } from './write-web-edge-config.mjs';

const BASE = { EXPO_PUBLIC_SUPABASE_URL: 'https://p.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon' };

test('maps the public build variables and drops the empty optional ones', () => {
  assert.deepEqual(buildEdgeConfig({ ...BASE, KC_IOS_STORE_URL: '  ', KC_ANDROID_STORE_URL: 'https://play.google.com/x' }), {
    SUPABASE_URL: 'https://p.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    KC_ANDROID_STORE_URL: 'https://play.google.com/x',
  });
});

test('fails the deploy when a required value is missing', () => {
  assert.throws(() => buildEdgeConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://p.supabase.co' }), /EXPO_PUBLIC_SUPABASE_ANON_KEY/);
});

test('renders a module whose values cannot break out of their string literals', () => {
  const source = renderEdgeConfigModule({ KC_IOS_STORE_URL: 'https://x/"; process.exit(1); "' });
  assert.ok(source.startsWith('// Generated'));
  assert.ok(source.includes('\\"; process.exit(1); \\"'));
});
