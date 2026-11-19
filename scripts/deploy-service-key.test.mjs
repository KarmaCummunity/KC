import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, statSync, existsSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { isCompleteServiceKey, retrieveServiceKey, selectServiceKey, prepareVerifiedKey, verifyPreservedCaller } from './deploy-service-key.mjs';

const ref = 'enbqriuxvvuontiwslun';
const key = `sb_secret_${'a'.repeat(32)}`;
const env = { SUPABASE_PROJECT_REF: ref, SUPABASE_ACCESS_TOKEN: 'sbp_fixture' };
const rows = [{ type: 'secret', name: 'default', api_key: key }];
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

for (const value of [null, undefined, '', '******', 'sb_secret_***', 'sb_secret_...abc', 'sb_secret_••••', 'sb_secret_short', `${key}\n`, 'null']) {
  test(`rejects incomplete secret fixture ${String(value)}`, () => {
    assert.equal(isCompleteServiceKey(value, ref), false);
    assert.throws(() => selectServiceKey([{ type: 'secret', name: 'default', api_key: value }], ref), /missing_masked/);
  });
}
test('masked modern key never silently falls back to legacy', () => {
  assert.throws(() => selectServiceKey([...rows.map((r) => ({ ...r, api_key: null })), { name: 'service_role', api_key: key }], ref));
  assert.throws(() => selectServiceKey([...rows, ...rows], ref));
});
test('legacy JWT must have correct role and project, and still requires online authentication', () => {
  const jwt = (claims) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${'b'.repeat(43)}`;
  assert.equal(isCompleteServiceKey(jwt({ role: 'service_role', ref }), ref), true);
  assert.equal(isCompleteServiceKey(jwt({ role: 'anon', ref }), ref), false);
  assert.equal(isCompleteServiceKey(jwt({ role: 'service_role', ref: 'prod' }), ref), false);
});
test('supported reveal GET and read-only service authentication, no CLI or write request', async () => {
  const calls = [];
  const fetch = async (url, opts) => { calls.push({ url, opts }); return response(calls.length === 1 ? rows : { users: [] }); };
  assert.equal(await retrieveServiceKey({ target: 'dev', env, fetch }), key);
  assert.match(calls[0].url, /api-keys\?reveal=true$/);
  assert.match(calls[1].url, new RegExp(`https://${ref}\\.supabase.co/auth/v1/admin/users`));
  for (const call of calls) assert.equal(call.opts.method, undefined);
  assert.equal(calls[1].opts.headers.apikey, key);
  assert.equal(calls[1].opts.headers.Authorization, undefined);
});
test('wrong target is refused before network access', async () => {
  let calls = 0;
  await assert.rejects(() => retrieveServiceKey({ target: 'prod', env, fetch: () => { calls++; } }));
  assert.equal(calls, 0);
});
for (const status of [401, 403, 429, 500]) {
  test(`retrieval HTTP ${status} fails without probe`, async () => {
    let calls = 0;
    await assert.rejects(() => retrieveServiceKey({ target: 'dev', env, fetch: () => { calls++; return response({}, status); } }));
    assert.equal(calls, 1);
  });
}
test('valid-looking but unusable credential cannot proceed to Vault', async () => {
  let calls = 0;
  await assert.rejects(() => retrieveServiceKey({ target: 'dev', env, fetch: () => response(++calls === 1 ? rows : {}, calls === 1 ? 200 : 401) }), /probe_http_401/);
});
test('old workflow execution without marker exits before any network or mutations', () => {
  const result = spawnSync(process.execPath, ['scripts/deploy-preflight.mjs', 'supabase', 'dev'], {
    cwd: new URL('..', import.meta.url),
    env: { ...env, SUPABASE_DB_PASSWORD: 'fixture' }, encoding: 'utf8', timeout: 2000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /workflow lacks verified Vault sync/);
  assert.doesNotMatch(result.stdout + result.stderr, /fetch failed|response data/);
});
const workflow = (name) => parse(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
test('global preflight precedes approval and every DB/backup job', () => {
  const jobs = workflow('deploy').jobs;
  assert.ok(jobs.approve.needs.includes('preflight'));
  assert.ok(jobs.db.needs.includes('preflight'));
  const preflight = workflow('deploy-preflight').jobs.supabase;
  const step = preflight.steps.find((s) => s.name === 'Check Supabase secrets');
  assert.equal(step.env.KC_SAFE_VAULT_SYNC, 'reveal-v1');
  assert.match(step.run, /deploy-preflight.mjs/);
});
test('migrate authenticates and persists credential before link, dry run or DB push; Vault reuses exact value', () => {
  const steps = workflow('deploy-db').jobs.migrate.steps;
  const prepare = steps.findIndex((s) => s.run?.includes('deploy-service-key.mjs --prepare'));
  for (const match of ['supabase link', 'Dry-run push', 'Apply migrations']) {
    assert.ok(steps.findIndex((s) => s.run?.includes(match) || s.name === match) > prepare);
  }
  const verify = steps.findIndex((s) => s.run?.includes('--verify-existing'));
  assert.ok(verify > prepare);
  for (const label of ['Dry-run push', 'Apply migrations']) assert.ok(steps.findIndex((s) => s.name === label) > verify);
  assert.doesNotMatch(JSON.stringify(steps), /vault\.(create_secret|update_secret)|KC_VAULT_KEY/);
  assert.equal(steps.at(-1).if, 'always()');
});
test('old reusable workflow snapshot cannot reach DB writes with new deployed scripts', () => {
  const source = readFileSync(new URL('./deploy-preflight.mjs', import.meta.url), 'utf8');
  assert.match(source, /env.KC_SAFE_VAULT_SYNC !== 'reveal-v1'/);
  assert.match(source, /await retrieveServiceKey/);
  for (const name of ['deploy-db', 'deploy-functions']) {
    for (const job of Object.values(workflow(name).jobs)) {
      assert.equal(job.env.KC_SAFE_VAULT_SYNC, 'reveal-v1');
      assert.ok(job.steps.some((s) => s.run?.includes('deploy-preflight.mjs')));
    }
  }
});
test('manual dev Vault seeding uses verified retrieval too and always cleans up', () => {
  const steps = workflow('seed-kc-dev').jobs.seed.steps;
  assert.ok(steps.some((s) => s.if === "inputs.action == 'vault'" && s.run?.includes('--prepare dev')));
  assert.ok(steps.some((s) => s.if === "inputs.action == 'vault'" && s.run?.includes('--verify-existing dev')));
  assert.doesNotMatch(JSON.stringify(steps), /projects api-keys|vault\.(create_secret|update_secret)|KC_VAULT_KEY/);
  assert.equal(steps.at(-1).if, 'always()');
});

test('prepare uses 0600, refuses existing file/symlink and removes partial writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kc-key-test-'));
  const path = join(dir, 'key');
  try {
    prepareVerifiedKey(path, key);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(readFileSync(path, 'utf8'), key);
    assert.throws(() => prepareVerifiedKey(path, 'replacement'), /EEXIST/);
    assert.equal(readFileSync(path, 'utf8'), key);
    const link = join(dir, 'link');
    symlinkSync(path, link);
    assert.throws(() => prepareVerifiedKey(link, 'replacement'), /EEXIST/);
    const partial = join(dir, 'partial');
    assert.throws(() => prepareVerifiedKey(partial, key, { write(fd) { writeFileSync(fd, 'partial'); throw new Error('disk_failure'); } }));
    assert.equal(existsSync(partial), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('legacy JWT online authentication uses both headers and discards response body', async () => {
  const legacy = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role', ref })).toString('base64url')}.${'b'.repeat(43)}`;
  let calls = 0, cancelled = false;
  assert.equal(await retrieveServiceKey({ target: 'dev', env, fetch: async (url, opts) => {
    if (++calls === 1) return response([{ name: 'service_role', api_key: legacy }]);
    assert.equal(opts.headers.apikey, legacy);
    assert.equal(opts.headers.Authorization, `Bearer ${legacy}`);
    return { ok: true, status: 200, body: { async cancel() { cancelled = true; } } };
  } }), legacy);
  assert.equal(cancelled, true);
});
test('response cancellation failure is fail-closed', async () => {
  let calls = 0;
  await assert.rejects(() => retrieveServiceKey({ target: 'dev', env, fetch: async () => ++calls === 1 ? response(rows) : { ok: true, body: { cancel() { throw new Error('cancel_failure'); } } } }));
});
const hash = createHash('sha256').update(key).digest('hex');
const goodState = { key_count: 1, key_hash: hash, url_count: 1, url_matches: 1 };
const verify = (state, status = 0, inspect = () => {}) => verifyPreservedCaller({ target: 'dev', env: { ...env, RUNNER_TEMP: '/fixture', SUPABASE_DB_PASSWORD: 'fixture' },
  read: (path) => path.endsWith('pooler-url') ? `postgresql://postgres.${ref}@aws-0.pooler.supabase.com:5432/postgres` : key,
  run: (command, args, opts) => { inspect(command, args, opts); return { status, stdout: JSON.stringify(state) }; },
});
test('same byte-identical caller and exact URL pass with a single read-only SELECT; no keys in SQL', () => {
  verify(goodState, 0, (command, args, opts) => {
    assert.equal(command, 'psql');
    assert.equal(args.join(' ').includes(key), false);
    assert.doesNotMatch(args.at(-1), /update|insert|create_secret|update_secret/i);
    assert.match(opts.env.PGOPTIONS, /default_transaction_read_only=on/);
  });
});
for (const [label, state] of Object.entries({ missingKey: { key_count: 0 }, duplicateKey: { key_count: 2 }, authValidDifferentKey: { key_hash: 'a'.repeat(64) }, missingURL: { url_count: 0 }, duplicateURL: { url_count: 2 }, wrongURL: { url_matches: 0 } })) {
  test(`preservation refuses ${label}`, () => assert.throws(() => verify({ ...goodState, ...state }), /controlled_repair/));
}
test('DB failure refuses even if stdout resembles correct state', () => assert.throws(() => verify(goodState, 1)));
test('parallel rotation is never overwritten: deploy and seed contain no Vault writes', () => {
  for (const name of ['deploy-db', 'seed-kc-dev']) {
    const text = readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /vault\.(create_secret|update_secret)|KC_VAULT_KEY/);
    assert.match(text, /--verify-existing/);
  }
});
