#!/usr/bin/env node
// Candidate-bound automatic review submission gate. No ASC write capability here.
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Reject stale, simulated, failed or unrelated evidence before submission credentials are used. */
export function qualifyCandidate({ record, currentNotesHash, sourceOnMain, runs, uploadProof }) {
  const reject = (condition, reason) => { if (!condition) throw new Error(`Automatic submission blocked: ${reason}`); };
  reject(record?.backend === 'prod' && record.release_type === 'MANUAL', 'PROD with MANUAL release required');
  reject(/^[a-f0-9]{40}$/.test(record.source_sha ?? '') && sourceOnMain, 'source must be on main');
  reject(/^\d+\.\d+\.\d+$/.test(record.version ?? '') && /^\d+$/.test(record.build_number ?? ''), 'exact version/build required');
  reject(/^[a-f0-9]{64}$/.test(currentNotesHash ?? '') && record.notes_sha256 === currentNotesHash, 'review notes changed or missing');
  reject(['guest', 'media_denial', 'notification_consent', 'production_signed_binary'].every(k => record.acceptance?.[k] === true), 'native acceptance incomplete');
  reject(Array.isArray(record.evidence) && record.evidence.length > 0, 'evidence missing');
  const upload = runs.find(r => r.id === record.upload_run_id);
  reject(upload?.status === 'completed' && upload.path === '.github/workflows/prod-store-build.yml' && upload.repository?.full_name === 'KarmaCummunity/KC', 'completed PROD upload run required');
  reject(uploadProof?.backend === 'prod' && uploadProof.source_sha === record.source_sha && uploadProof.build_number === record.build_number, 'exact successful iOS upload proof required');
  const exact = record.evidence.find(e => e.kind === 'reviewed-device-candidate' && e.version === record.version && e.build_number === record.build_number && e.source_sha === record.source_sha);
  reject(exact && ['human-device', 'automated-device'].includes(exact.method), 'reviewed device evidence does not match');
  reject(['reviewed_by', 'device', 'os', 'checked_at'].every(k => typeof exact[k] === 'string' && exact[k].trim().length > 0), 'device evidence review metadata missing');
  reject(!Number.isNaN(Date.parse(exact.checked_at)), 'device evidence date invalid');
  reject(typeof exact.evidence_url === 'string' && /^https:\/\//.test(exact.evidence_url), 'private reviewed evidence reference required');
  reject(exact.checks?.includes('notification_consent_delivery'), 'physical notification consent/delivery scope missing');
  return { version: record.version, buildNumber: record.build_number, sourceSha: record.source_sha };
}

async function main(env = process.env) {
  const recordPath = 'docs/release/asc-qualified-candidate.json';
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], { encoding: 'utf8' }).trim().split('\n');
  if (!existsSync(recordPath) || !changed.includes(recordPath)) {
    console.log('No new qualification record. Nothing to submit.');
    return;
  }
  const record = JSON.parse(readFileSync('docs/release/asc-qualified-candidate.json', 'utf8'));
  const currentNotesHash = createHash('sha256').update(readFileSync('docs/store/app-review-notes.md')).digest('hex');
  let sourceOnMain = false;
  if (/^[a-f0-9]{40}$/.test(record.source_sha ?? '')) {
    try { execFileSync('git', ['merge-base', '--is-ancestor', record.source_sha, 'HEAD']); sourceOnMain = true; } catch { /* fail closed below */ }
  }
  const branchResponse = await fetch('https://api.github.com/repos/KarmaCummunity/KC/branches/main', { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}` } });
  if (!branchResponse.ok || (await branchResponse.json()).commit?.sha !== env.CANDIDATE_COMMIT) throw new Error('Candidate qualification commit is not current main');
  const runs = [];
  for (const runId of [record.upload_run_id]) {
    if (!Number.isSafeInteger(runId)) throw new Error('Invalid evidence/upload run id');
    const response = await fetch(`https://api.github.com/repos/KarmaCummunity/KC/actions/runs/${runId}`, {
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`Evidence run unavailable: ${response.status}`);
    runs.push(await response.json());
  }
  const candidate = qualifyCandidate({ record, currentNotesHash, sourceOnMain, runs, uploadProof });
  appendFileSync(env.GITHUB_OUTPUT, `version=${candidate.version}\nbuild_number=${candidate.buildNumber}\nsource_sha=${candidate.sourceSha}\n`);
  console.log('Exact PROD candidate qualification passed. Public release stays MANUAL.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exit(1); });
