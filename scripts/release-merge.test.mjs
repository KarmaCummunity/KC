import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releasePrProblems, releaseSquashMessage, skipTokensIn } from './release-merge.mjs';

const SHA = 'd04d42fa354684b3b89357f9b5d07d6e1ee56197';
const TITLE = 'chore(release): promote dev to main (production baseline cut-over)';

test('skipTokensIn finds every token GitHub honours, in any case', () => {
  for (const t of ['[skip ci]', '[ci skip]', '[no ci]', '[skip actions]', '[actions skip]', '[Skip CI]']) {
    assert.deepEqual(skipTokensIn(`x\n* bump ${t}\n`), [t]);
  }
  assert.deepEqual(skipTokensIn('a\nskip-checks: true\n'), ['skip-checks: true']);
  assert.deepEqual(skipTokensIn('chore: skip ci flakes (no brackets)'), []);
});

test('the squash message is the title plus a fixed body without skip tokens', () => {
  const { subject, body } = releaseSquashMessage({ number: 2301, title: TITLE, headSha: SHA });
  assert.equal(subject, `${TITLE} (#2301)`);
  assert.match(body, new RegExp(SHA));
  assert.deepEqual(skipTokensIn(`${subject}\n${body}`), []);
});

test('a title with a skip token or a non-release title is refused', () => {
  assert.throws(() => releaseSquashMessage({ number: 1, title: `${TITLE} [skip ci]`, headSha: SHA }), /skip token/);
  assert.throws(() => releaseSquashMessage({ number: 1, title: 'feat: x', headSha: SHA }), /must start with/);
  assert.throws(() => releaseSquashMessage({ number: 1, title: TITLE, headSha: 'abc' }), /bad head SHA/);
});

test('releasePrProblems requires an open, clean dev → main PR at the given head', () => {
  const ok = { state: 'open', base: { ref: 'main' }, head: { ref: 'dev', sha: SHA }, mergeable_state: 'clean' };
  assert.deepEqual(releasePrProblems(ok, SHA), []);
  const bad = { state: 'open', base: { ref: 'dev' }, head: { ref: 'x', sha: 'y' }, mergeable_state: 'blocked' };
  assert.equal(releasePrProblems(bad, SHA).length, 4);
});
