import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Execute the actual inline workflow shell with an offline gh double. No network,
// credentials, or real labels are used. Keep runner bash -e semantics intact.
const yaml = readFileSync(new URL('../.github/workflows/issue-claims.yml', import.meta.url), 'utf8');
const marker = '        run: |\n';
const script = yaml.slice(yaml.indexOf(marker) + marker.length)
  .split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');

function run({ list = '42 OPEN', count = '1', claimed = '2000-01-01T00:00:00Z', fail = '', labels = 'in-progress,agent:other' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kc-claims-'));
  try {
    const gh = join(dir, 'gh');
    writeFileSync(gh, `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
const op = a.slice(0, 2).join(' ');
if (op === process.env.FAIL) { console.error('offline API failure'); process.exit(7); }
if (op === 'issue list') process.stdout.write(process.env.LIST ? process.env.LIST + '\\n' : '');
else if (a[0] === 'api') console.log(process.env.CLAIMED);
else if (op === 'pr list') console.log(process.env.COUNT);
else if (op === 'issue view') console.log(process.env.LABELS);
else if (op === 'issue edit') fs.appendFileSync(process.env.EDITS, a.join(' ') + '\\n');
else { console.error('unexpected offline gh operation'); process.exit(9); }
`);
    chmodSync(gh, 0o755);
    const file = join(dir, 'workflow.sh');
    writeFileSync(file, script);
    const edits = join(dir, 'edits');
    const result = spawnSync('bash', ['-e', file], {
      encoding: 'utf8', timeout: 5000,
      env: { PATH: dir + ':' + process.env.PATH, GH_REPO: 'offline/test',
        PUSH_SHA: '', PR_NUMBER: '', LIST: list, COUNT: count, CLAIMED: claimed, FAIL: fail, LABELS: labels, EDITS: edits },
    });
    return { ...result, edits: existsSync(edits) ? readFileSync(edits, 'utf8') : '' };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('stale claim with an open PR is a successful no-op', () => {
  const r = run(); assert.equal(r.status, 0, r.stderr); assert.equal(r.edits, '');
});
test('empty claim list succeeds without edits', () => {
  const r = run({ list: '' }); assert.equal(r.status, 0, r.stderr); assert.equal(r.edits, '');
});
test('recent claim succeeds without edits', () => {
  const r = run({ claimed: '2099-01-01T00:00:00Z' }); assert.equal(r.status, 0, r.stderr); assert.equal(r.edits, '');
});
test('stale unbacked claim is released by offline double only', () => {
  const r = run({ count: '0' }); assert.equal(r.status, 0, r.stderr); assert.match(r.edits, /issue edit 42 --remove-label in-progress,agent:other/);
});
test('closed claim is released by offline double only', () => {
  const r = run({ list: '42 CLOSED' }); assert.equal(r.status, 0, r.stderr); assert.match(r.edits, /issue edit 42/);
});
test('PR lookup failure still fails instead of being masked', () => {
  const r = run({ fail: 'pr list' }); assert.notEqual(r.status, 0); assert.equal(r.edits, '');
});
test('claim-list API failure stays red without edits', () => {
  const r = run({ fail: 'issue list' }); assert.notEqual(r.status, 0); assert.equal(r.edits, '');
});
test('failed stale-claim label edit stays red', () => {
  const r = run({ count: '0', fail: 'issue edit' });
  assert.notEqual(r.status, 0); assert.equal(r.edits, '');
  assert.doesNotMatch(r.stdout, /released #/);
});
test('failed closed-claim label edit stays red', () => {
  const r = run({ list: '42 CLOSED', fail: 'issue edit' });
  assert.notEqual(r.status, 0); assert.equal(r.edits, '');
  assert.doesNotMatch(r.stdout, /released #/);
});
test('failed issue label lookup stays red', () => {
  const r = run({ count: '0', fail: 'issue view' });
  assert.notEqual(r.status, 0); assert.equal(r.edits, '');
});
test('already absent claim labels remain a successful no-op', () => {
  const r = run({ count: '0', labels: '' });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.edits, '');
  assert.doesNotMatch(r.stdout, /released #/);
});
