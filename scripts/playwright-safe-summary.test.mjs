import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeSummary } from './playwright-safe-summary.mjs';
const stats = { expected: 19, unexpected: 36, flaky: 2, skipped: 31, duration: 1000 };
test('exports numeric counts without secret-bearing report content', () => {
  const secret = 'synthetic-test-credential';
  const result = safeSummary({ stats: { ...stats, startTime: secret, password: secret }, suites: [{ title: secret }], errors: [{ message: secret }], attachments: [{ body: secret }] });
  assert.deepEqual(result, { format: 'kc-playwright-counts-v1', ...stats });
  assert.equal(JSON.stringify(result).includes(secret), false);
});
test('rejects malformed or stringified counts rather than forwarding report text', () => {
  for (const value of [undefined, null, -1, Infinity, NaN, 'credential']) {
    assert.throws(() => safeSummary({ stats: { ...stats, expected: value } }), /Invalid/);
  }
  assert.throws(() => safeSummary({}), /Missing/);
});
for (const workflow of ['ci-release.yml', 'e2e-nightly-dev.yml']) {
  test(`${workflow} uploads only the generated counts artifact after a successful privacy step`, () => {
    const source = readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), 'utf8');
    assert.match(source, /id: safe-playwright-summary/);
    assert.match(source, /steps\['safe-playwright-summary'\]\.outcome == 'success'/);
    const uploads = source.split(/uses: actions\/upload-artifact@/).slice(1);
    assert.equal(uploads.length, 1);
    assert.match(uploads[0], /path: \$\{\{ runner\.temp \}\}\/safe-playwright-summary\/counts\.json/);
    assert.doesNotMatch(uploads[0], /path:.*(?:test-results|playwright-report)|tests\/e2e\/(?:test-results|playwright-report)/);
  });
}
