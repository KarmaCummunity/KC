import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MAX_SOURCE_LINES,
  OUTPUT_FILE,
  SOURCE_DIR,
  assembleBaseline,
  listSources,
  validateSource,
} from './assemble-baseline.mjs';

/** Create a throwaway schema directory from `{ 'module/file.sql': text }` and run `fn` on it. */
function withSchemaDir(tree, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'schemas-'));
  try {
    for (const [relativePath, text] of Object.entries(tree)) {
      const target = join(dir, relativePath);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, text);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('concatenates modules and files in path order under a source marker', () => {
  withSchemaDir(
    {
      '10_identity/010_users.sql': 'create table b();\n',
      '00_foundation/020_privileges.sql': 'select 2;\n',
      '00_foundation/010_schemas.sql': 'select 1;\n',
    },
    (dir) => {
      const { sql, errors } = assembleBaseline(dir);
      assert.deepEqual(errors, []);
      const markers = sql.split('\n').filter((line) => line.startsWith('-- >>> '));
      assert.deepEqual(markers, [
        '-- >>> supabase/schemas/00_foundation/010_schemas.sql',
        '-- >>> supabase/schemas/00_foundation/020_privileges.sql',
        '-- >>> supabase/schemas/10_identity/010_users.sql',
      ]);
      assert.ok(sql.indexOf('select 1;') < sql.indexOf('select 2;'));
      assert.ok(sql.indexOf('select 2;') < sql.indexOf('create table b();'));
    },
  );
});

test('ignores loose files such as the README beside the module folders', () => {
  withSchemaDir({ 'README.md': '# notes', '00_foundation/010_schemas.sql': 'select 1;\n' }, (dir) => {
    const { files, errors } = listSources(dir);
    assert.deepEqual(errors, []);
    assert.equal(files.length, 1);
  });
});

test('rejects a badly named module folder or source file', () => {
  withSchemaDir({ 'identity/010_users.sql': 'select 1;\n', '00_foundation/users.sql': 'select 1;\n' }, (dir) => {
    const { errors } = assembleBaseline(dir);
    assert.match(errors.join('\n'), /module folder "identity" must be named NN_snake_case/);
    assert.match(errors.join('\n'), /00_foundation\/users\.sql must be named NNN_snake_case\.sql/);
  });
});

test('rejects an empty directory', () => {
  withSchemaDir({}, (dir) => {
    assert.deepEqual(assembleBaseline(dir).errors, ['no schema source files found']);
  });
});

test('validateSource enforces the line cap, LF endings and non-empty files', () => {
  assert.deepEqual(validateSource('m/f.sql', 'select 1;\n'), []);
  assert.match(validateSource('m/f.sql', 'select 1;\r\n')[0], /carriage returns/);
  assert.match(validateSource('m/f.sql', '  \n')[0], /file is empty/);
  const tooLong = `${'select 1;\n'.repeat(MAX_SOURCE_LINES + 1)}`;
  assert.match(validateSource('m/f.sql', tooLong)[0], /exceeds the 300-line cap/);
  assert.deepEqual(validateSource('m/f.sql', 'select 1;\n'.repeat(MAX_SOURCE_LINES)), []);
});

test('the committed baseline matches supabase/schemas', () => {
  const { sql, errors } = assembleBaseline(SOURCE_DIR);
  assert.deepEqual(errors, []);
  assert.equal(
    readFileSync(OUTPUT_FILE, 'utf8'),
    sql,
    'supabase/baseline/0001_baseline.sql is stale — run: node scripts/assemble-baseline.mjs',
  );
});
