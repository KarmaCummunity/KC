import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, devHeadFromMessage, globToRegExp, parseAllowlist, RELEASE_SUBJECT } from './check-main-dev-parity.mjs';

const SHA = '37caaa28071e21fd7931c93ed0c77d2b91c4eae7';

test('devHeadFromMessage reads the dev head of a release-merge.mjs squash', () => {
  const msg = `${RELEASE_SUBJECT} (production baseline cut-over) (#2308)\n\nRelease PR #2308, dev head ${SHA}.\n`;
  assert.equal(devHeadFromMessage(msg), SHA);
});

test('devHeadFromMessage ignores other commits and short SHAs', () => {
  assert.equal(devHeadFromMessage(`fix: x\n\ndev head ${SHA}`), null);
  assert.equal(devHeadFromMessage(`${RELEASE_SUBJECT} (#1)\n\ndev head 37caaa28`), null);
  assert.equal(devHeadFromMessage(undefined), null);
});

test('globToRegExp: * stays in a segment, ** crosses, dots are literal', () => {
  assert.ok(globToRegExp('app/VERSION').test('app/VERSION'));
  assert.ok(!globToRegExp('app/VERSION').test('app/VERSIONX'));
  assert.ok(globToRegExp('docs/*.md').test('docs/a.md'));
  assert.ok(!globToRegExp('docs/*.md').test('docs/x/a.md'));
  assert.ok(globToRegExp('docs/**').test('docs/x/a.md'));
  assert.ok(!globToRegExp('a.b').test('aXb'));
});

test('classify splits allowed paths from drift', () => {
  const allow = [{ path: 'app/VERSION', reason: 'bump' }];
  const { allowed, drift } = classify(['M\tapp/VERSION', 'M\t.github/workflows/deploy.yml', ''], allow);
  assert.deepEqual(allowed, [{ status: 'M', path: 'app/VERSION', reason: 'bump' }]);
  assert.deepEqual(drift, [{ status: 'M', path: '.github/workflows/deploy.yml', reason: undefined }]);
});

test('parseAllowlist requires a reason for every entry', () => {
  assert.throws(() => parseAllowlist('{"allow":[{"path":"a"}]}'), /has no reason/);
  assert.throws(() => parseAllowlist('[]'), /expected/);
  assert.deepEqual(parseAllowlist('{"allow":[]}'), []);
});

test('the committed allowlist parses and every entry is documented in PROD-DIFFERENCES.md', () => {
  const root = new URL('../', import.meta.url);
  const entries = parseAllowlist(readFileSync(new URL('docs/release/prod-differences.allowlist.json', root), 'utf8'));
  const doc = readFileSync(new URL('docs/release/PROD-DIFFERENCES.md', root), 'utf8');
  for (const e of entries) assert.ok(doc.includes(e.path), `${e.path} is not in PROD-DIFFERENCES.md`);
});
