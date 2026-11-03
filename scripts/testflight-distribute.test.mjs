// Run: node --test scripts/testflight-distribute.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGroups, whatsNewText } from './testflight-distribute.mjs';

test('parseGroups splits and rejects KupaPay', () => {
  assert.deepEqual(parseGroups('KC Beta, KC Real Users'), ['KC Beta', 'KC Real Users']);
  assert.throws(() => parseGroups('KC Beta,KupaPay testers'));
});
test('whatsNewText falls back to neutral line', () => {
  assert.equal(whatsNewText(''), 'General testing of Karma Community');
  assert.equal(whatsNewText(' x '), 'x');
});
