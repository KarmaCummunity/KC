import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXIT, auditNeeded, isDependencyPath, parseArgs, runAudit } from './check-dependency-audit.mjs';
import { renderLog, renderSummary } from './check-dependency-audit-report.mjs';

const ALLOWLIST = 'scripts/check-dependency-audit.allowlist.json';
const LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: { '': {}, 'node_modules/left-pad': { version: '1.3.0' } },
});
const HIGH_ADVISORY = {
  'left-pad': [
    {
      id: 1,
      url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
      title: 'Bad padding',
      severity: 'high',
      vulnerable_versions: '<2.0.0',
    },
  ],
};

/**
 * Runs the CLI against an in-memory repository with one npm lockfile.
 * @param {{ argv?: string[], exceptions?: object[], advisories?: object, changed?: string[] | Error }} setup
 */
async function run({ argv = [], exceptions = [], advisories = {}, changed = [] } = {}) {
  const files = {
    [ALLOWLIST]: JSON.stringify({ exceptions }),
    'tests/e2e/package-lock.json': LOCK,
  };
  const lines = [];
  let fetched = 0;
  const code = await runAudit({
    argv,
    today: '2026-11-03',
    env: {},
    log: (line) => lines.push(line),
    readFile: (path) => files[path],
    gitLines: (args) => {
      if (args[0] === 'ls-files') return Object.keys(files);
      if (changed instanceof Error) throw changed;
      return changed;
    },
    fetchImpl: async () => {
      fetched += 1;
      return { ok: true, status: 200, json: async () => advisories };
    },
  });
  return { code, lines, fetched };
}

test('parseArgs reads both options and rejects unknown or empty ones', () => {
  assert.deepEqual(parseArgs(['--changed-since', 'abc']), { changedSince: 'abc', allowlist: ALLOWLIST });
  assert.equal(parseArgs(['--allowlist', 'x.json']).allowlist, 'x.json');
  assert.throws(() => parseArgs(['--changed-since']), TypeError);
  assert.throws(() => parseArgs(['--fix']), TypeError);
});

test('isDependencyPath covers lockfiles, manifests, Edge Functions and the audit itself', () => {
  for (const path of [
    'app/pnpm-lock.yaml',
    'tests/e2e/package-lock.json',
    'app/packages/ui/package.json',
    'supabase/functions/translate/index.ts',
    ALLOWLIST,
    'scripts/check-dependency-audit-policy.mjs',
  ]) {
    assert.equal(isDependencyPath(path), true, path);
  }
  for (const path of ['docs/SSOT/BACKLOG.md', 'app/apps/mobile/src/App.tsx', 'supabase/migrations/0001.sql']) {
    assert.equal(isDependencyPath(path), false, path);
  }
});

test('auditNeeded audits unless the diff proves no dependency file changed', () => {
  assert.equal(auditNeeded(null, () => []).audit, true);
  assert.equal(auditNeeded('0000000000000000000000000000000000000000', () => []).audit, true);
  assert.equal(auditNeeded('abc', () => { throw new Error('bad object'); }).audit, true);
  assert.equal(auditNeeded('abc', () => ['docs/a.md']).audit, false);
  assert.equal(auditNeeded('abc', () => ['docs/a.md', 'app/pnpm-lock.yaml']).audit, true);
});

test('runAudit fails on an uncovered high advisory', async () => {
  const { code, lines } = await run({ advisories: HIGH_ADVISORY });
  assert.equal(code, EXIT.FAILED);
  assert.ok(lines.some((line) => line.startsWith('ERROR GHSA-aaaa-bbbb-cccc (high) left-pad@1.3.0')));
});

test('runAudit passes when a valid exception covers the advisory', async () => {
  const exception = {
    advisory: 'GHSA-aaaa-bbbb-cccc',
    package: 'left-pad',
    reason: 'Test-only dependency; never shipped, reviewed for this test.',
    reviewed: '2026-11-01',
    expires: '2026-12-01',
  };
  const { code, lines } = await run({ advisories: HIGH_ADVISORY, exceptions: [exception] });
  assert.equal(code, EXIT.PASSED);
  assert.ok(lines.some((line) => line.startsWith('EXCEPTED GHSA-aaaa-bbbb-cccc')));
});

test('runAudit fails on an invalid allowlist before asking the registry', async () => {
  const { code, fetched } = await run({ exceptions: [{ advisory: 'GHSA-aaaa-bbbb-cccc' }] });
  assert.equal(code, EXIT.FAILED);
  assert.equal(fetched, 0);
});

test('runAudit skips the registry when no dependency file changed since the base', async () => {
  const { code, fetched, lines } = await run({ argv: ['--changed-since', 'abc'], changed: ['docs/a.md'] });
  assert.equal(code, EXIT.PASSED);
  assert.equal(fetched, 0);
  assert.match(lines[0], /skipped/);
});

test('runAudit audits when the base commit cannot be diffed', async () => {
  const { code, fetched } = await run({
    argv: ['--changed-since', 'abc'],
    changed: new Error('bad object'),
    advisories: HIGH_ADVISORY,
  });
  assert.equal(fetched, 1);
  assert.equal(code, EXIT.FAILED);
});

test('renderLog annotates blocking findings and stale exceptions on GitHub Actions', () => {
  const blocking = {
    advisory: 'GHSA-aaaa-bbbb-cccc', severity: 'high', title: 'T', url: 'u',
    package: 'p', version: '1.0.0', sources: ['a/package-lock.json'],
  };
  const stale = { advisory: 'GHSA-dddd-eeee-ffff', package: 'q', expires: '2027-01-01' };
  const lines = renderLog(
    { blocking: [blocking], excepted: [], informational: [], stale: [stale] },
    { unauditable: [], sources: ['a/package-lock.json'], annotate: true },
  );
  assert.ok(lines.some((line) => line.startsWith('::error title=Dependency audit::GHSA-aaaa-bbbb-cccc')));
  assert.ok(lines.some((line) => line.startsWith('::warning title=Dependency audit::Exception GHSA-dddd-eeee-ffff')));
  assert.match(lines.at(-1), /failed: 1 blocking/);
});

test('renderSummary lists blocking and excepted findings in one table', () => {
  const base = { severity: 'high', title: 'T', url: 'https://x', version: '1.0.0', sources: ['l'] };
  const markdown = renderSummary({
    blocking: [{ ...base, advisory: 'GHSA-aaaa-bbbb-cccc', package: 'p' }],
    excepted: [{ ...base, advisory: 'GHSA-dddd-eeee-ffff', package: 'q', exception: { expires: '2027-01-31' } }],
    informational: [],
    stale: [],
  });
  assert.match(markdown, /❌ blocking \| \[GHSA-aaaa-bbbb-cccc\]\(https:\/\/x\)/);
  assert.match(markdown, /excepted until 2027-01-31/);
});
