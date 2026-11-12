import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AUTO_ASSIGN_FLOOR, assign, pendingErrors, planAssignments, restore } from './migration-ids.mjs';

/** Runs `body` with a scratch migrations directory holding the given files. */
function withDir(files, body) {
  const dir = mkdtempSync(join(tmpdir(), 'migration-ids-'));
  try {
    for (const file of files) writeFileSync(join(dir, file), '-- sql');
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('numbers pending files after the highest numbered file, in NN then slug order', () => {
  const plan = planAssignments(['0001_baseline.sql', '0060_old.sql', 'next-02_b.sql', 'next-01_z.sql', 'next-01_a.sql']);
  assert.deepEqual(plan, [
    { from: 'next-01_a.sql', to: '0061_a.sql' },
    { from: 'next-01_z.sql', to: '0062_z.sql' },
    { from: 'next-02_b.sql', to: '0063_b.sql' },
  ]);
});

test('never numbers below the auto-assign floor, so hand-claimed numbers stay free', () => {
  const [first] = planAssignments(['0001_baseline.sql', '0036_last.sql', 'next-01_x.sql']);
  assert.equal(first.to, `00${AUTO_ASSIGN_FLOOR}_x.sql`);
});

test('two merges in a row never reuse a number', () => {
  withDir(['0001_baseline.sql', 'next-01_first.sql'], (dir) => {
    assign(dir);
    writeFileSync(join(dir, 'next-01_second.sql'), '-- sql');
    assign(dir);
    assert.deepEqual(readdirSync(dir).sort(), ['0001_baseline.sql', '0050_first.sql', '0051_second.sql']);
  });
});

test('rejects a malformed pending name and a repeated slug', () => {
  assert.match(pendingErrors(['next-1_x.sql']).join('\n'), /invalid pending migration filename/);
  assert.match(pendingErrors(['next-00_x.sql']).join('\n'), /starts at 01/);
  assert.match(pendingErrors(['next-01_x.sql', 'next-02_x.sql']).join('\n'), /duplicate pending migration slug "x"/);
  assert.deepEqual(pendingErrors(['0001_baseline.sql', 'next-01_x.sql']), []);
});

test('assign renames on disk and restore undoes it', () => {
  withDir(['0001_baseline.sql', 'next-01_x.sql'], (dir) => {
    const mapFile = join(dir, 'map.json');
    assign(dir, mapFile);
    assert.ok(existsSync(join(dir, '0050_x.sql')));
    restore(dir, mapFile);
    assert.ok(existsSync(join(dir, 'next-01_x.sql')));
    assert.ok(!existsSync(mapFile));
  });
});

test('assign lists the numbered files in the production manifest and restore takes them out', () => {
  withDir(['0001_baseline.sql', 'next-01_x.sql', 'next-02_y.sql'], (dir) => {
    const mapFile = join(dir, 'map.json');
    const manifest = join(dir, 'manifest.txt');
    writeFileSync(manifest, '# approved\n0001_baseline.sql\n');
    assign(dir, mapFile, manifest);
    assert.equal(readFileSync(manifest, 'utf8'), '# approved\n0001_baseline.sql\n0050_x.sql\n0051_y.sql\n');
    restore(dir, mapFile, manifest);
    assert.equal(readFileSync(manifest, 'utf8'), '# approved\n0001_baseline.sql\n');
  });
});

test('a name the manifest already lists is not listed twice, and a missing manifest is ignored', () => {
  withDir(['0001_baseline.sql', 'next-01_x.sql'], (dir) => {
    const manifest = join(dir, 'manifest.txt');
    writeFileSync(manifest, '0001_baseline.sql\n0050_x.sql');
    assign(dir, null, manifest);
    assert.equal(readFileSync(manifest, 'utf8'), '0001_baseline.sql\n0050_x.sql');
  });
  withDir(['0001_baseline.sql', 'next-01_x.sql'], (dir) => {
    assert.deepEqual(assign(dir, null, join(dir, 'absent.txt')), [{ from: 'next-01_x.sql', to: '0050_x.sql' }]);
  });
});

test('does nothing when no file is pending', () => {
  withDir(['0001_baseline.sql'], (dir) => assert.deepEqual(assign(dir), []));
});
