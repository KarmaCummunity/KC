// Guards the pgTAP suites (supabase/tests/*.sql) against ordering rows by `ctid`.
// `ctid` is a row's physical place: an UPDATE writes the row elsewhere and page pruning reuses
// slots, so "order by ctid" picks a different row from run to run (#2256). A test that needs
// creation order records it (see the `handoff_order` table of the handoff suites).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = fileURLToPath(new URL('../supabase/tests/', import.meta.url));

/** Lines of SQL without their `--` comments, so prose that explains the rule does not trip it. */
function codeLines(sql) {
  return sql.split('\n').map((line) => line.replace(/--.*$/, ''));
}

test('no DB test orders rows by ctid', () => {
  const offenders = readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .flatMap((name) => codeLines(readFileSync(`${TESTS_DIR}${name}`, 'utf8'))
      .map((line, i) => ({ name, line: i + 1, text: line }))
      .filter(({ text }) => /\bctid\b/i.test(text)))
    .map(({ name, line }) => `${name}:${line}`);
  assert.deepEqual(offenders, []);
});
