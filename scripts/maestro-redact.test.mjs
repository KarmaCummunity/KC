import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactDirectory, redactSecret, REDACTED } from './maestro-redact.mjs';

const SECRET = 'Kc-seed.Pass+1/x$';

test('redactSecret replaces every occurrence, including regex metacharacters in the secret', () => {
  assert.equal(redactSecret(`a ${SECRET} b ${SECRET}`, SECRET), `a ${REDACTED} b ${REDACTED}`);
  assert.equal(redactSecret('nothing here', SECRET), 'nothing here');
});

test('redactSecret refuses an empty secret, which would match everywhere', () => {
  assert.throws(() => redactSecret('text', ''), /empty secret/);
});

test('redactDirectory cleans nested text files, reports them, and leaves binary files and clean files alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-redact-'));
  const nested = join(dir, 'debug', '17-flow', '.maestro', 'tests');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, 'commands.json'), `{"env":{"KC_E2E_PASSWORD":"${SECRET}"}}`);
  writeFileSync(join(nested, 'maestro.log'), `typed ${SECRET}\nagain ${SECRET}\n`);
  writeFileSync(join(dir, 'clean.xml'), '<ok/>');
  writeFileSync(join(dir, 'video.mp4'), `binary ${SECRET}`);

  const changed = redactDirectory(dir, SECRET).map((p) => p.slice(dir.length + 1)).sort();

  assert.deepEqual(changed, [join('debug', '17-flow', '.maestro', 'tests', 'commands.json'), join('debug', '17-flow', '.maestro', 'tests', 'maestro.log')]);
  assert.equal(readFileSync(join(nested, 'commands.json'), 'utf8'), `{"env":{"KC_E2E_PASSWORD":"${REDACTED}"}}`);
  assert.equal(readFileSync(join(nested, 'maestro.log'), 'utf8'), `typed ${REDACTED}\nagain ${REDACTED}\n`);
  assert.equal(readFileSync(join(dir, 'clean.xml'), 'utf8'), '<ok/>');
  assert.equal(readFileSync(join(dir, 'video.mp4'), 'utf8'), `binary ${SECRET}`);
});
