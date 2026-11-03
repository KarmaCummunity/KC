import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { collectHebrewViolations, isSkippedHebrewScanRel } from './extract-hebrew-text.mjs';

const HE = 'שלום עולם';

function makeRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'hebrew-scan-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function withRoot(files, fn) {
  const root = makeRoot(files);
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('flags Hebrew in a .ts source file outside locale bundles', () => {
  withRoot({ 'app/apps/mobile/src/components/Foo.ts': `export const x = '${HE}';` }, (root) => {
    const violations = collectHebrewViolations(root);
    assert.equal(violations.length, 1);
    assert.match(violations[0].rel.replace(/\\/g, '/'), /components\/Foo\.ts$/);
    assert.equal(violations[0].hits.length, 1);
  });
});

test('flags Hebrew in a .json file (TD-124 — scan must cover .json)', () => {
  withRoot({ 'app/apps/mobile/src/data/labels.json': `{ "label": "${HE}" }` }, (root) => {
    assert.equal(collectHebrewViolations(root).length, 1);
  });
});

test('skips canonical i18n locale bundles', () => {
  withRoot(
    { 'app/apps/mobile/src/i18n/locales/he/common.ts': `export default { a: '${HE}' };` },
    (root) => assert.equal(collectHebrewViolations(root).length, 0),
  );
});

test('skips the searchConstants parser-vocabulary allowlist', () => {
  withRoot(
    { 'app/packages/infrastructure-supabase/src/search/searchConstants.ts': `export const k = '${HE}';` },
    (root) => assert.equal(collectHebrewViolations(root).length, 0),
  );
});

test('skips test fixtures (__tests__ and *.test.ts)', () => {
  withRoot(
    {
      'app/x/__tests__/a.ts': `const a = '${HE}';`,
      'app/x/b.test.ts': `const b = '${HE}';`,
    },
    (root) => assert.equal(collectHebrewViolations(root).length, 0),
  );
});

test('skips transitional trees: SQL migrations + Expo app.json metadata', () => {
  withRoot(
    {
      'supabase/migrations/0001_x.sql': `-- ${HE}`,
      'app/apps/mobile/app.json': `{ "name": "${HE}" }`,
    },
    (root) => assert.equal(collectHebrewViolations(root).length, 0),
  );
});

test('a Hebrew-free tree yields zero violations', () => {
  withRoot(
    { 'app/apps/mobile/src/components/Foo.ts': `export const x = 'hello';` },
    (root) => assert.equal(collectHebrewViolations(root).length, 0),
  );
});

test('isSkippedHebrewScanRel encodes the documented skip rules', () => {
  assert.equal(isSkippedHebrewScanRel('app/apps/mobile/src/i18n/locales/he/x.ts'), true);
  assert.equal(isSkippedHebrewScanRel('supabase/migrations/0001_x.sql'), true);
  assert.equal(isSkippedHebrewScanRel('supabase/functions/dispatch-notification/i18n.json'), true);
  assert.equal(isSkippedHebrewScanRel('app/apps/mobile/app.json'), true);
  assert.equal(
    isSkippedHebrewScanRel('app/packages/infrastructure-supabase/src/search/searchConstants.ts'),
    true,
  );
  assert.equal(isSkippedHebrewScanRel('app/apps/mobile/src/components/Foo.tsx'), false);
});

function withGitRoot(files, fn) {
  withRoot(files, (root) => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fn(root);
  });
}

test('skips gitignored files such as a local `expo prebuild` android tree', () => {
  withGitRoot(
    {
      '.gitignore': '/android/\n',
      'android/app/src/main/res/values/strings.xml': `<string>${HE}</string>`,
      'src/a.ts': `export const s = '${HE}';`,
    },
    (root) => assert.deepEqual(collectHebrewViolations(root).map((v) => v.rel), ['src/a.ts']),
  );
});

test('still flags new untracked files that are not gitignored', () => {
  withGitRoot(
    { '.gitignore': 'dist-local/\n', 'src/new-screen.tsx': `const t = '${HE}';` },
    (root) => assert.deepEqual(collectHebrewViolations(root).map((v) => v.rel), ['src/new-screen.tsx']),
  );
});
