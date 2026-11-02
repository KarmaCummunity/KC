import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkCodeownersCoverage, isOwned, parseCodeowners, patternToRegExp, referencedScripts } from './check-codeowners-coverage.mjs';

// Builds a throwaway repository from { path: contents } and returns its root.
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'codeowners-'));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

test('patterns follow the CODEOWNERS anchoring rules', () => {
  assert.ok(patternToRegExp('/scripts/ci-*').test('scripts/ci-gate.mjs'));
  assert.ok(!patternToRegExp('/scripts/ci-*').test('app/scripts/ci-gate.mjs'), 'a leading slash anchors at the root');
  assert.ok(!patternToRegExp('/scripts/ci-*').test('scripts/lib/ci-gate.mjs'), '* stays within one segment');
  assert.ok(patternToRegExp('/.github/').test('.github/workflows/ci.yml'), 'a directory pattern covers its contents');
  assert.ok(!patternToRegExp('/.github/').test('.github'), 'a directory pattern does not match the bare name');
  assert.ok(patternToRegExp('vitest.config.*').test('app/packages/domain/vitest.config.ts'), 'a slash-free pattern matches at any depth');
  assert.ok(patternToRegExp('docs/**/x.md').test('docs/a/b/x.md'), '** crosses segments');
});

test('the last matching rule wins, and a rule without owners un-owns', () => {
  const rules = parseCodeowners('# comment\n/scripts/maestro-*  @owner\n\n/scripts/*.test.mjs\n');
  assert.equal(isOwned('scripts/maestro-dev-env.mjs', rules), true);
  assert.equal(isOwned('scripts/maestro-dev-env.test.mjs', rules), false);
  assert.equal(isOwned('scripts/other.mjs', rules), false);
});

test('collects workflow-run scripts and their relative imports, never test files or lookalike paths', () => {
  const root = fixture({
    '.github/workflows/a.yml': 'run: node scripts/a.mjs && bash scripts/run.sh\nrun: npm ci --prefix scripts # scripts/package-lock.json\nrun: node --test scripts/a.test.mjs',
    '.github/actions/x/action.yml': 'run: node app/scripts/b.mjs',
    'scripts/a.mjs': "import { x } from './lib/x.mjs';\nconst y = await import('./y.mjs');",
    'scripts/lib/x.mjs': '',
    'scripts/y.mjs': '',
    'scripts/run.sh': '',
    'scripts/a.test.mjs': '',
    'app/scripts/b.mjs': '',
  });
  try {
    assert.deepEqual(referencedScripts(root), ['app/scripts/b.mjs', 'scripts/a.mjs', 'scripts/lib/x.mjs', 'scripts/run.sh', 'scripts/y.mjs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports a workflow-run script that CODEOWNERS leaves unowned', () => {
  const root = fixture({
    '.github/CODEOWNERS': '/scripts/ci-*  @owner\n',
    '.github/workflows/a.yml': 'run: node scripts/ci-gate.mjs && node scripts/spec-ids.mjs assign',
    'scripts/ci-gate.mjs': '',
    'scripts/spec-ids.mjs': '',
  });
  try {
    assert.deepEqual(checkCodeownersCoverage(root).unowned, ['scripts/spec-ids.mjs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the repository itself passes', () => {
  assert.deepEqual(checkCodeownersCoverage().unowned, []);
});
