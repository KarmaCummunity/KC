// Unit tests for scripts/check-prod-ledger.mjs.
// Run: node --test scripts/check-prod-ledger.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MYSELF_SCHEMA_SQL,
  PROD_REF,
  evaluateProdLedger,
  findMyselfInAuthConfig,
  inspectProdLedger,
  migrationVersion,
  parseLedger,
  repoVersionsFromFiles,
  schemaNamesFromQuery,
  supabaseProdReader,
} from './check-prod-ledger.mjs';

const REPO = repoVersionsFromFiles(['0001_init.sql', '0002_next.sql', '0718_last.sql']);

function verdict(over = {}) {
  return evaluateProdLedger({
    projectRef: PROD_REF,
    repoVersions: REPO,
    ledger: [],
    schemas: [],
    myselfAuthHits: [],
    ...over,
  });
}

test('migrationVersion reads the leading digits of a filename', () => {
  assert.equal(migrationVersion('0001_init.sql'), '0001');
  assert.equal(migrationVersion('20240101120000_x.sql'), '20240101120000');
  assert.equal(migrationVersion('readme.md'), null);
});

test('parseLedger accepts arrays, wrapped payloads and string rows', () => {
  assert.deepEqual(parseLedger([{ version: '0001', name: '0001_init.sql' }]), [
    { version: '0001', name: '0001_init.sql' },
  ]);
  assert.deepEqual(parseLedger({ migrations: ['0002_next.sql'] }), [
    { version: '0002', name: '0002_next.sql' },
  ]);
  assert.deepEqual(parseLedger({ data: [{ id: '0718' }] }), [{ version: '0718', name: '0718' }]);
});

test('an empty prod ledger is ok (expected until the D-228 apply)', () => {
  const r = verdict();
  assert.equal(r.ok, true);
  assert.match(r.notes[0], /ledger is empty/);
  assert.equal(r.pending.length, 3);
  assert.deepEqual(r.unexpected, []);
});

test('applied versions that exist in the repo are reported, not failed', () => {
  const r = verdict({ ledger: [{ version: '0001', name: '0001_init.sql' }] });
  assert.equal(r.ok, true);
  assert.match(r.notes[0], /1 applied version/);
  assert.deepEqual(r.pending, ['0002', '0718']);
});

test('prod-only versions, a myself schema, and a myself Auth hook fail closed', () => {
  const drift = verdict({ ledger: [{ version: '9999', name: '9999_unknown.sql' }] });
  assert.equal(drift.ok, false);
  assert.match(drift.errors[0], /not in supabase\/migrations: 9999/);

  const schema = verdict({ schemas: ['myself'] });
  assert.equal(schema.ok, false);
  assert.match(schema.errors[0], /myself` schema/);

  const hook = verdict({ myselfAuthHits: ['hook_custom_access_token.uri=https://x/myself'] });
  assert.equal(hook.ok, false);
  assert.match(hook.errors[0], /Auth config mentions myself/);
});

test('a wrong project ref is refused before the ledger is trusted', () => {
  const r = verdict({ projectRef: 'enbqriuxvvuontiwslun' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /prod project/);
  assert.equal(r.prodVersions.length, 0);
});

test('findMyselfInAuthConfig walks nested URIs and hook keys', () => {
  assert.deepEqual(findMyselfInAuthConfig({ site_url: 'https://app.example' }), []);
  assert.match(
    findMyselfInAuthConfig({ hook: { custom_access_token: { uri: 'https://x/functions/v1/myself' } } })[0],
    /myself/,
  );
  assert.deepEqual(findMyselfInAuthConfig({ hook_custom_access_token: { enabled: true } }), []);
});

test('schemaNamesFromQuery reads nspname rows', () => {
  assert.deepEqual(schemaNamesFromQuery([{ nspname: 'myself' }]), ['myself']);
  assert.deepEqual(schemaNamesFromQuery([]), []);
});

test('supabaseProdReader uses only GET migrations/auth and the read-only query endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    if (url.endsWith('/database/migrations')) return { ok: true, text: async () => '[]' };
    if (url.endsWith('/config/auth')) return { ok: true, text: async () => '{}' };
    if (url.endsWith('/database/query/read-only')) {
      assert.equal(init.method, 'POST');
      assert.equal(JSON.parse(init.body).query, MYSELF_SCHEMA_SQL);
      return { ok: true, text: async () => '[]' };
    }
    throw new Error(`unexpected ${url}`);
  };
  const client = supabaseProdReader({ projectRef: PROD_REF, token: 'sbp_x', fetchImpl });
  assert.deepEqual(await client.listMigrations(), []);
  assert.deepEqual(await client.authConfig(), {});
  assert.deepEqual(await client.schemaNames(), []);
  assert.deepEqual(
    calls.map((c) => c.url.replace(`https://api.supabase.com/v1/projects/${PROD_REF}`, '')),
    ['/database/migrations', '/config/auth', '/database/query/read-only'],
  );
  assert.ok(!calls.some((c) => c.url.endsWith('/database/query') && !c.url.endsWith('/database/query/read-only')));
});

test('inspectProdLedger returns ok for an empty healthy project', async () => {
  const supabase = {
    listMigrations: async () => [],
    schemaNames: async () => [],
    authConfig: async () => ({ site_url: 'https://app.example' }),
  };
  const r = await inspectProdLedger({ supabase, projectRef: PROD_REF, repoVersions: REPO });
  assert.equal(r.ok, true);
  assert.match(r.notes[0], /ledger is empty/);
});
