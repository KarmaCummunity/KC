import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWebhookAuth, publicFunctions } from './check-webhook-auth.mjs';

const TOML = `
[functions.whatsapp-webhook]
verify_jwt = false

[functions.translate]
verify_jwt = true

[functions.payments-webhook]
verify_jwt = false

[functions.identity-verification-webhook]
verify_jwt = false
`;

const GOOD = {
  'payments-webhook':
    "headers.get('x-kc-signature'); crypto.subtle.importKey('raw', k, { name: 'HMAC' }, false, ['sign']); timingSafeEqual(a, b)",
  'whatsapp-webhook': "req.headers.get('x-hub-signature-256'); hmacSha256Hex(s, b); timingSafeEqual(a, b)",
  'identity-verification-webhook':
    "if (!await deps.provider.verifyWebhook(req.headers, raw, now)) return json({ ok: false, error: 'unauthenticated' }, 401);",
};

test('publicFunctions lists only verify_jwt = false blocks', () => {
  assert.deepEqual(publicFunctions(TOML), ['whatsapp-webhook', 'payments-webhook', 'identity-verification-webhook']);
});

test('passes when every public function carries its caller check', () => {
  assert.deepEqual(checkWebhookAuth({ configToml: TOML, readFunction: (n) => GOOD[n] ?? null, allSources: [] }), []);
});

test('fails when a public function is not registered', () => {
  const toml = `${TOML}\n[functions.new-hook]\nverify_jwt = false\n`;
  const problems = checkWebhookAuth({ configToml: toml, readFunction: (n) => GOOD[n] ?? '', allSources: [] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /new-hook: verify_jwt = false but not registered/);
});

test('fails when the signature check is gone', () => {
  const read = (n) => (n === 'payments-webhook' ? 'await deps.apply(body)' : GOOD[n]);
  const problems = checkWebhookAuth({ configToml: TOML, readFunction: read, allSources: [] });
  assert.equal(problems.length, 3);
  assert.ok(problems.every((p) => p.startsWith('payments-webhook:')));
});

test('fails on an environment switch that skips the check', () => {
  const allSources = [{ path: 'supabase/functions/x/index.ts', text: "Deno.env.get('WHATSAPP_SKIP_SIGNATURE_VERIFY') === 'true'" }];
  const problems = checkWebhookAuth({ configToml: TOML, readFunction: (n) => GOOD[n], allSources });
  assert.deepEqual(problems, ['supabase/functions/x/index.ts: reads an environment switch that skips caller authentication']);
});

test('fails when the identity webhook no longer verifies the provider signature', () => {
  const read = (n) => (n === 'identity-verification-webhook' ? 'const body = JSON.parse(raw);' : GOOD[n]);
  const problems = checkWebhookAuth({ configToml: TOML, readFunction: read, allSources: [] });
  assert.equal(problems.length, 2);
  assert.ok(problems.every((p) => p.startsWith('identity-verification-webhook:')));
});
