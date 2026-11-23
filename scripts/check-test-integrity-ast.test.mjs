// Unit tests for scripts/check-test-integrity-ast.mjs (TD-222 / #1818).
// Run: node --test scripts/check-test-integrity-ast.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countJsAssertions, findJsWeakening, scanJsTestSource, tokenize } from './check-test-integrity-ast.mjs';

test('countJsAssertions ignores expect/assert inside strings and comments', () => {
  assert.equal(countJsAssertions("expect(1).toBe(1);\n// expect(2)\nconst s = 'expect(3)';"), 1);
  assert.equal(countJsAssertions('/* expect(9) */ assert.equal(a, b);'), 1);
  assert.equal(countJsAssertions('expect.soft(y).toBe(2); expect(x).toBe(1);'), 2);
  assert.equal(countJsAssertions('expect<number>(x).toBe(1);'), 1);
});

test('tokenize does not emit string or comment contents as identifiers', () => {
  const ids = tokenize("const s = 'it.skip'; // it.only\nreal.skip(").filter((t) => t.kind === 'id').map((t) => t.value);
  assert.deepEqual(ids, ['const', 's', 'real', 'skip']);
});

test('findJsWeakening catches skip markers and ignores the same text inside strings', () => {
  const sk = '.sk' + 'ip';
  const hits = findJsWeakening(`it${sk}('x', () => {});\nconst decoy = "it${sk}('no')";`);
  assert.equal(hits.filter((h) => h.why.includes('skip / focus')).length, 1);
  assert.equal(hits[0].lineNo, 1);
});

test('findJsWeakening catches bare return on the same line as other code and after if', () => {
  const a = findJsWeakening('if (cond) return;\nexpect(1).toBe(1);');
  assert.ok(a.some((h) => h.why.includes('bare `return`')));
  const b = findJsWeakening('return; expect(1).toBe(1);');
  assert.ok(b.some((h) => h.why.includes('bare `return`')));
  // A valued return is not bare.
  assert.equal(findJsWeakening('return 1;\n').filter((h) => h.why.includes('bare')).length, 0);
});

test('findJsWeakening flags empty or assertion-free it/test callbacks', () => {
  const empty = findJsWeakening("it('x', () => {});\ntest('y', () => { const z = 1; });");
  assert.equal(empty.filter((h) => h.why.includes('assertion-free')).length, 2);
  const ok = findJsWeakening("it('x', () => { expect(1).toBe(1); });");
  assert.equal(ok.filter((h) => h.why.includes('assertion-free')).length, 0);
  // describe wrappers hold nested tests; they are not flagged as empty.
  const suite = findJsWeakening("describe('s', () => { it('x', () => { expect(1).toBe(1); }); });");
  assert.equal(suite.filter((h) => h.why.includes('assertion-free')).length, 0);
});

test('scanJsTestSource still sees option markers and x-prefixed tests', () => {
  const opt = scanJsTestSource("test('x', { " + 'sk' + 'ip: true }, () => { expect(1).toBe(1); });');
  assert.ok(opt.markers.some((m) => m.why.includes('option')));
  const x = scanJsTestSource('x' + "it('x', () => { expect(1).toBe(1); });");
  assert.ok(x.markers.some((m) => m.why.includes('x-prefix')));
});
