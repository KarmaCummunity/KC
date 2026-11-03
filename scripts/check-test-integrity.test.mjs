// Unit tests for scripts/check-test-integrity.mjs.
// Run: node --test scripts/check-test-integrity.test.mjs
//
// Markers are assembled from pieces ('.sk' + 'ip(') so this file never adds a
// literal marker itself, which the guard would flag on the PR adding it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { countAssertions, findViolations, isTest, loadDiff, parseDiff, stripComments } from './check-test-integrity.mjs';

const SK = '.sk' + 'ip';
const MARKER_LINES = [
  `it${SK}('x', () => {})`,
  'describe' + '.on' + "ly('x', () => {})",
  'it' + '.to' + "do('later')",
  'test' + '.fix' + "me('flaky')",
  `it${SK}.each([1])('x %s', () => {})`,
  'describe' + '.on' + 'ly.each`a`',
  `const pending = describe${SK};`,
  'it' + '.sk' + "ipIf(isCi)('x', () => {})",
  'it' + '.ru' + "nIf(isCi)('x', () => {})",
  "test('x', { " + 'sk' + 'ip: true }, () => {})',
  "test('x', { " + 'on' + 'ly: true }, () => {})',
  "Deno.test({ name: 'x', " + 'ign' + 'ore: true, fn() {} })',
  'Deno.test' + '.ign' + "ore('x', () => {})",
  'Deno.test' + '.on' + "ly('x', () => {})",
  'x' + "it('x', () => {})",
  '// @ts-' + 'nocheck',
  '  ' + 're' + 'turn;',
];
const NO_TESTS = '--pass' + 'WithNoTests';

const mod = (path, { added = [], removed = [], oldText = '', newText = '' } = {}) => ({
  oldPath: path,
  newPath: path,
  path,
  added,
  removed,
  oldText,
  newText,
});
const created = (path, newText) => ({ oldPath: null, newPath: path, path, added: newText.split('\n'), removed: [], newText });

test('isTest covers unit, spec, __tests__, SQL and E2E files only', () => {
  for (const p of ['app/a.test.ts', 'scripts/x.test.mjs', 'app/src/__tests__/helpers.ts', 'supabase/tests/0001_x.sql', 'tests/e2e/journeys/feed.spec.ts']) {
    assert.equal(isTest(p), true, p);
  }
  for (const p of ['app/src/a.ts', 'supabase/migrations/0001_x.sql', 'docs/testing.md']) assert.equal(isTest(p), false, p);
});

test('a clean diff (new tests, app code) has no violations', () => {
  const files = [
    created('app/new.test.ts', 'expect(1).toBe(1);'),
    mod('app/src/a.ts', { added: ['export const a = 2;'], removed: ['export const a = 1;'] }),
  ];
  assert.deepEqual(findViolations(files), []);
});

test('deleting a test file is flagged', () => {
  const files = [{ oldPath: 'app/a.test.ts', newPath: null, path: 'app/a.test.ts', added: [], removed: [] }];
  assert.deepEqual(findViolations(files), ['app/a.test.ts: deletes a test file']);
});

test('any rename or move of a test file is flagged, even to another test path', () => {
  const moved = (to) => [{ oldPath: 'app/a.test.ts', newPath: to, path: to, added: [], removed: [], oldText: '', newText: '' }];
  assert.deepEqual(findViolations(moved('app/b.ts')), ['app/a.test.ts: renamed or moved to app/b.ts']);
  assert.deepEqual(findViolations(moved('app/x/a.test.ts')), ['app/a.test.ts: renamed or moved to app/x/a.test.ts']);
});

test('every skip / focus / todo / conditional / alias / option / nocheck / bare-return marker is flagged', () => {
  for (const line of MARKER_LINES) {
    assert.equal(findViolations([mod('app/a.test.ts', { added: [line] })]).length, 1, line);
  }
});

test('markers in non-test code are ignored; pgTAP skip in SQL tests is flagged', () => {
  assert.deepEqual(findViolations([mod('app/src/list.ts', { added: [`rows${SK}(2)`] })]), []);
  assert.equal(findViolations([mod('supabase/tests/0001_x.sql', { added: ["select skip('later', 2);"] })]).length, 1);
});

test('a switch that passes with zero tests is flagged anywhere but Markdown', () => {
  assert.equal(findViolations([mod('app/package.json', { added: [`"test": "vitest run ${NO_TESTS}"`] })]).length, 1);
  assert.deepEqual(findViolations([mod('docs/testing.md', { added: [`never use ${NO_TESTS}`] })]), []);
});

test('lowering or dropping a coverage threshold is flagged; raising is fine', () => {
  const cfg = 'app/packages/domain/vitest.config.ts';
  assert.match(findViolations([mod(cfg, { removed: ['lines: 60,'], added: ['lines: 50,'] })])[0], /loosens coverage threshold "lines" 60 → 50/);
  assert.match(findViolations([mod(cfg, { removed: ['branches: 60,'] })])[0], /drops coverage threshold "branches"/);
  assert.deepEqual(findViolations([mod(cfg, { removed: ['lines: 60,'], added: ['lines: 70,'] })]), []);
});

test('raising or dropping --max-warnings is flagged; lowering is fine', () => {
  const pkg = 'app/apps/mobile/package.json';
  const line = (n) => `"lint": "eslint . --max-warnings=${n}"`;
  assert.match(findViolations([mod(pkg, { removed: [line(70)], added: [line(80)] })])[0], /loosens --max-warnings 70 → 80/);
  assert.match(findViolations([mod(pkg, { removed: [line(70)], added: ['"lint": "eslint ."'] })])[0], /drops --max-warnings/);
  assert.deepEqual(findViolations([mod(pkg, { removed: [line(70)], added: [line(69)] })]), []);
});

test('a net loss of assertions in existing tests is flagged', () => {
  const file = mod('app/a.test.ts', { oldText: 'expect(a).toBe(1);\nassert.equal(b, 2);', newText: 'expect(a).toBe(1);' });
  assert.deepEqual(findViolations([file]), ['removes 1 assertion(s) net from tests (2 before, 1 after; files losing some: app/a.test.ts)']);
});

test('commenting assertions out counts as removing them, line or block comments', () => {
  const oldText = 'expect(a).toBe(1);\nexpect(b).toBe(2);';
  for (const newText of ['// expect(a).toBe(1);\nexpect(b).toBe(2);', '/*\nexpect(a).toBe(1);\n*/\nexpect(b).toBe(2);']) {
    assert.equal(findViolations([mod('app/a.test.ts', { oldText, newText })]).length, 1, newText);
  }
});

test('assertions moved into a new test file are not a loss', () => {
  const files = [
    mod('app/a.test.ts', { oldText: 'expect(a).toBe(1);\nexpect(b).toBe(2);', newText: '' }),
    created('app/a2.test.ts', 'expect(a).toBe(1);\nexpect(b).toBe(2);'),
  ];
  assert.deepEqual(findViolations(files), []);
});

test('countAssertions knows JS and SQL styles and ignores comments', () => {
  assert.equal(countAssertions('a.test.ts', 'expect(x).toBe(1); expect.soft(y).toBe(2);\nassert.deepEqual(a, b) // expect(z)'), 3);
  assert.equal(countAssertions('supabase/tests/x.sql', "assert v = 1, 'msg';\nraise exception 'bad';\nselect ok(true); -- assert x"), 3);
  assert.equal(stripComments('a /* b */ c // d'), 'a  c ');
});

test('parseDiff reads statuses, renames and hunks, and treats removed SQL comments as content', () => {
  const diff = [
    'diff --git a/app/a.test.ts b/app/a.test.ts',
    'index 1..2 100644',
    '--- a/app/a.test.ts',
    '+++ b/app/a.test.ts',
    '@@ -1 +1 @@',
    '-expect(a).toBe(1);',
    '+expect(a).toBe(2);',
    'diff --git a/supabase/tests/x.sql b/supabase/tests/x.sql',
    'deleted file mode 100644',
    '--- a/supabase/tests/x.sql',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '--- a comment',
    '-select 1;',
    'diff --git a/old.test.ts b/new.ts',
    'similarity index 100%',
    'rename from old.test.ts',
    'rename to new.ts',
  ].join('\n');
  const [a, b, c] = parseDiff(diff);
  assert.deepEqual(a, { oldPath: 'app/a.test.ts', newPath: 'app/a.test.ts', path: 'app/a.test.ts', added: ['expect(a).toBe(2);'], removed: ['expect(a).toBe(1);'] });
  assert.equal(b.newPath, null);
  assert.deepEqual(b.removed, ['-- a comment', 'select 1;']);
  assert.deepEqual([c.oldPath, c.newPath], ['old.test.ts', 'new.ts']);
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function withRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'test-integrity-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 'ci@example.com');
    git(dir, 'config', 'user.name', 'ci');
    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(join(dir, 'app/a.test.ts'), 'expect(1).toBe(1);\nexpect(2).toBe(2);\n');
    writeFileSync(join(dir, 'app/pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    fn(dir, git(dir, 'rev-parse', 'HEAD'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('loadDiff + findViolations catch a deleted test in a real repository', () => {
  withRepo((dir, base) => {
    git(dir, 'rm', '-q', 'app/a.test.ts', 'app/pnpm-lock.yaml');
    git(dir, 'commit', '-q', '-m', 'drop');
    const files = loadDiff(base, git(dir, 'rev-parse', 'HEAD'), dir);
    assert.deepEqual(files.map((f) => f.path), ['app/a.test.ts']);
    assert.deepEqual(findViolations(files), ['app/a.test.ts: deletes a test file']);
  });
});

test('loadDiff counts whole files, so a commented-out assertion is caught', () => {
  withRepo((dir, base) => {
    writeFileSync(join(dir, 'app/a.test.ts'), 'expect(1).toBe(1);\n// expect(2).toBe(2);\n');
    git(dir, 'commit', '-qam', 'comment out');
    const files = loadDiff(base, git(dir, 'rev-parse', 'HEAD'), dir);
    assert.deepEqual(findViolations(files), ['removes 1 assertion(s) net from tests (2 before, 1 after; files losing some: app/a.test.ts)']);
  });
});
