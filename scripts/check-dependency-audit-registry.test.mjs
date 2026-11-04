import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AuditRegistryError,
  BULK_ADVISORY_URL,
  advisoryId,
  fetchAdvisories,
  isAffected,
  matchFindings,
} from './check-dependency-audit-registry.mjs';

/** name -> version -> files, as collectInventory builds it. */
function inventory(entries) {
  const packages = new Map();
  for (const [name, version, source] of entries) {
    const versions = packages.get(name) ?? new Map();
    versions.set(version, [source]);
    packages.set(name, versions);
  }
  return packages;
}

/** A fetch stub that answers each call from the list, recording the requests. */
function fakeFetch(answers) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status === 200, status: next.status, json: async () => next.body };
  };
  return { impl, calls };
}

const noSleep = async () => {};

test('fetchAdvisories posts every version of every package to the bulk endpoint', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: { a: [{ id: 1 }], b: [] } }]);
  const packages = inventory([
    ['a', '1.0.0', 'x'],
    ['a', '2.0.0', 'y'],
    ['b', '3.0.0', 'x'],
  ]);
  const result = await fetchAdvisories(packages, { fetchImpl: impl, sleep: noSleep });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, BULK_ADVISORY_URL);
  assert.deepEqual(calls[0].body, { a: ['1.0.0', '2.0.0'], b: ['3.0.0'] });
  assert.deepEqual([...result.keys()], ['a']);
});

test('fetchAdvisories retries a 503 and a network error, then succeeds', async () => {
  const { impl, calls } = fakeFetch([
    { status: 503 },
    new Error('socket hang up'),
    { status: 200, body: {} },
  ]);
  await fetchAdvisories(inventory([['a', '1.0.0', 'x']]), { fetchImpl: impl, sleep: noSleep });
  assert.equal(calls.length, 3);
});

test('fetchAdvisories fails at once on a non-retryable status', async () => {
  const { impl, calls } = fakeFetch([{ status: 400 }, { status: 200, body: {} }]);
  await assert.rejects(
    fetchAdvisories(inventory([['a', '1.0.0', 'x']]), { fetchImpl: impl, sleep: noSleep }),
    (error) => error instanceof AuditRegistryError && /HTTP 400/.test(error.message),
  );
  assert.equal(calls.length, 1);
});

test('fetchAdvisories gives up after the last retry instead of passing', async () => {
  const { impl, calls } = fakeFetch([{ status: 502 }, { status: 502 }, { status: 502 }, { status: 502 }]);
  await assert.rejects(
    fetchAdvisories(inventory([['a', '1.0.0', 'x']]), { fetchImpl: impl, sleep: noSleep }),
    AuditRegistryError,
  );
  assert.equal(calls.length, 4);
});

test('advisoryId prefers the GHSA ID and falls back to the registry ID', () => {
  assert.equal(advisoryId({ id: 9, url: 'https://github.com/advisories/GHSA-AB12-cd34-ef56' }), 'GHSA-ab12-cd34-ef56');
  assert.equal(advisoryId({ id: 9, url: 'https://www.npmjs.com/advisories/9' }), 'npm-9');
});

test('isAffected follows the vulnerable range and treats an unparsable range as affected', () => {
  assert.equal(isAffected('8.4.49', '<=8.5.17'), true);
  assert.equal(isAffected('8.5.29', '<=8.5.17'), false);
  assert.equal(isAffected('4.2.0', '>=4.2.0 <=4.3.1'), true);
  assert.equal(isAffected('1.0.0', 'not a range'), true);
});

test('matchFindings keeps only the affected versions, with their sources', () => {
  const packages = inventory([
    ['postcss', '8.4.49', 'app/pnpm-lock.yaml'],
    ['postcss', '8.5.29', 'app/pnpm-lock.yaml'],
  ]);
  const advisories = new Map([
    [
      'postcss',
      [
        {
          id: 1,
          url: 'https://github.com/advisories/GHSA-r28c-9q8g-f849',
          title: 'Path traversal',
          severity: 'high',
          vulnerable_versions: '<=8.5.17',
        },
      ],
    ],
  ]);
  assert.deepEqual(matchFindings(packages, advisories), [
    {
      advisory: 'GHSA-r28c-9q8g-f849',
      severity: 'high',
      title: 'Path traversal',
      url: 'https://github.com/advisories/GHSA-r28c-9q8g-f849',
      package: 'postcss',
      version: '8.4.49',
      sources: ['app/pnpm-lock.yaml'],
    },
  ]);
});
