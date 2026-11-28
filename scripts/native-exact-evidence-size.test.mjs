import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_EVIDENCE_BYTES, validateEvidenceBytes } from './native-exact-evidence-size.mjs';
test('evidence size accepts exact bound and rejects empty, malformed and oversized payloads', () => {
  assert.equal(validateEvidenceBytes(MAX_EVIDENCE_BYTES).bytes, MAX_EVIDENCE_BYTES);
  assert.equal(validateEvidenceBytes(1).bytes, 1);
  for (const n of [0, -1, NaN, Infinity, 1.5, MAX_EVIDENCE_BYTES + 1]) assert.throws(() => validateEvidenceBytes(n));
});
test('upload is gated on encryption plus size check and uses only isolated private transport', () => {
  const y = readFileSync('.github/workflows/native-exact-acceptance.yml', 'utf8');
  assert.match(y, /id: encrypted_evidence/);
  assert.match(y, /node tooling\/scripts\/native-exact-evidence-size.mjs/);
  assert.match(y, /if: always\(\) && steps.encrypted_evidence.outcome == 'success'/);
  assert.doesNotMatch(y, /actions\/upload-artifact|retention-days/);
  assert.match(y, /native-exact-private-upload.mjs preflight/);
  assert.match(y, /native-exact-private-upload.mjs upload/);
});
