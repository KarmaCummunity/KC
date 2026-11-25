import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qualifyCandidate } from './asc-auto-candidate.mjs';
const sha = 'a'.repeat(40);
const notes = 'b'.repeat(64);
const input = () => ({
  record: { upload_run_id: 456, backend: 'prod', source_sha: sha, version: '1.9.400', build_number: '50', notes_sha256: notes, release_type: 'MANUAL',
    acceptance: { guest: true, media_denial: true, notification_consent: true, production_signed_binary: true },
    evidence: [{ method: 'human-device', reviewed_by: 'test-reviewer', device: 'test-iPhone', os: 'test-iOS', checked_at: '2026-11-25T12:00:00Z', checks: ['notification_consent_delivery'], kind: 'reviewed-device-candidate', evidence_url: 'https://example.invalid/private-reviewed-evidence', version: '1.9.400', build_number: '50', source_sha: sha }] },
  currentNotesHash: notes, sourceOnMain: true, uploadProof: { backend: 'prod', source_sha: sha, build_number: '50' },
  runs: [{ id: 456, status: 'completed', head_sha: sha, path: '.github/workflows/prod-store-build.yml', repository: { full_name: 'KarmaCummunity/KC' } }],
});
test('only exact qualified PROD binary with manual release is eligible', () => {
  assert.deepEqual(qualifyCandidate(input()), { version: '1.9.400', buildNumber: '50', sourceSha: sha });
});
for (const [name, change] of [
  ['missing notification delivery check', x => { x.record.evidence[0].checks = []; }],
  ['missing upload provenance', x => { x.record.upload_run_id = 999; }],
  ['wrong upload source', x => { x.uploadProof.source_sha = 'd'.repeat(40); }],
  ['missing guest acceptance', x => { delete x.record.acceptance.guest; }],
  ['DEV backend', x => { x.record.backend = 'dev'; }],
  ['missing signed binary acceptance', x => { x.record.acceptance.production_signed_binary = false; }],
  ['stale notes', x => { x.currentNotesHash = 'c'.repeat(64); }],
  ['source not on main', x => { x.sourceOnMain = false; }],
  ['unreviewed device evidence', x => { delete x.record.evidence[0].reviewed_by; }],
  ['foreign upload repository', x => { x.runs[0].repository.full_name = 'other/repo'; }],
  ['wrong evidence build', x => { x.record.evidence[0].build_number = '49'; }],
  ['old simulator substituted for physical candidate', x => { x.record.evidence[0].kind = 'dev-ipad-simulator'; }],
  ['automatic release', x => { x.record.release_type = 'AFTER_APPROVAL'; }],
]) test(`${name} fails closed`, () => { const x = input(); change(x); assert.throws(() => qualifyCandidate(x)); });

test('automatic workflow has no DEV/PR/upload trigger, preserves gate and cancellation boundary', () => {
  const yaml = readFileSync(new URL('../.github/workflows/asc-auto-qualified-submit.yml', import.meta.url), 'utf8');
  assert.match(yaml, /workflows: \[CI\]/);
  assert.match(yaml, /branches: \[main\]/);
  assert.match(yaml, /workflow_run.event == 'push'/);
  assert.match(yaml, /head_repository.full_name == github.repository/);
  assert.match(yaml, /environment: mobile-store/);
  assert.match(yaml, /ASC_CANCEL_SUBMISSION: ''/);
  assert.match(yaml, /cancel-in-progress: false/);
  assert.equal((yaml.match(/run: node scripts\/asc-auto-candidate.mjs/g) ?? []).length, 2);
  assert.doesNotMatch(yaml, /workflow_dispatch:|pull_request:|secrets: inherit|ASC_MODE: plan/);
});
test('iOS proof is independent of Android, secret free, and binds selected source/build', () => {
  const yaml = readFileSync(new URL('../.github/workflows/prod-store-build.yml', import.meta.url), 'utf8');
  const proof = yaml.split('  ios-upload-proof:')[1].split('  android:')[0];
  assert.match(proof, /needs: \[gate, ios\]/);
  assert.match(proof, /SOURCE_SHA: \$\{\{ needs.gate.outputs.sha \}\}/);
  assert.match(proof, /IOS_BUILD_NUMBER: \$\{\{ needs.ios.outputs.build_number \}\}/);
  assert.doesNotMatch(proof, /secrets\.|needs.android/);
});
