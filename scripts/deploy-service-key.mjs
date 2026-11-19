#!/usr/bin/env node
// Read-only retrieval/probe. Never log a response body, credential or request URL.
// --check <dev|prod> validates without persisting; --prepare also writes one
// mode-0600 runner-temp file, compared against the existing Vault caller before
// migrations. Deploys never replace caller keys. This protects NEW script SHAs:
// rerunning an old SHA, or old seed workflows from main, remains unsafe and must
// be administratively held until those workflows are released normally.
import { writeFileSync, readFileSync, openSync, fstatSync, closeSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REFS = { dev: 'enbqriuxvvuontiwslun', prod: 'kdqtbdbzwvlugkhonexg' };

export function isCompleteServiceKey(key, ref) {
  if (typeof key !== 'string') return false;
  if (/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key)) return true;
  if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}$/.test(key)) return false;
  try {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    return claims.role === 'service_role' && claims.ref === ref;
  } catch { return false; }
}

export function selectServiceKey(rows, ref) {
  if (!Array.isArray(rows)) throw new Error('service_key_response_invalid');
  const preferred = rows.filter((r) => r?.type === 'secret' && (r.name === 'default' || r.id === 'default'));
  // A present but masked/null modern key is an error, never a reason to silently
  // fall back to legacy. The GET must actually have revealed the selected key.
  const candidates = preferred.length ? preferred : rows.filter((r) => r?.name === 'service_role' || r?.id === 'service_role');
  if (candidates.length !== 1 || !isCompleteServiceKey(candidates[0].api_key, ref)) {
    throw new Error('service_key_missing_masked_or_ambiguous');
  }
  return candidates[0].api_key;
}

export async function retrieveServiceKey({ target, env, fetch }) {
  const ref = REFS[target];
  if (!ref || env.SUPABASE_PROJECT_REF !== ref || !env.SUPABASE_ACCESS_TOKEN?.startsWith('sbp_')) {
    throw new Error('service_key_target_or_token_invalid');
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`service_key_retrieval_http_${res.status}`);
  let rows;
  try { rows = await res.json(); } catch { throw new Error('service_key_response_invalid'); }
  const key = selectServiceKey(rows, ref);
  // Format is not authentication. Auth admin is read-only and requires a real
  // service credential. Consume/discard its body, never emit user records.
  const probe = await fetch(`https://${ref}.supabase.co/auth/v1/admin/users?page=1&per_page=1`, {
    headers: key.startsWith('sb_secret_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (probe.body) await probe.body.cancel();
  if (!probe.ok) throw new Error(`service_key_probe_http_${probe.status}`);
  return key;
}

export function prepareVerifiedKey(path, key, { write = writeFileSync } = {}) {
  // O_EXCL refuses existing regular files and symlinks. Cleanup only our own inode.
  const fd = openSync(path, 'wx', 0o600);
  let success = false;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error('credential_file_permissions');
    write(fd, key);
    success = true;
  } finally {
    closeSync(fd);
    if (!success) unlinkSync(path);
  }
}

export function verifyPreservedCaller({ target, env, run = spawnSync, read = readFileSync }) {
  const ref = REFS[target];
  if (!ref || env.SUPABASE_PROJECT_REF !== ref || !env.RUNNER_TEMP) throw new Error('caller_target_invalid');
  const key = read(join(env.RUNNER_TEMP, 'kc-verified-service-key'), 'utf8');
  if (!isCompleteServiceKey(key, ref)) throw new Error('caller_credential_invalid');
  const url = read('supabase/.temp/pooler-url', 'utf8').trim();
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !decodeURIComponent(parsed.username).endsWith(`.${ref}`)) throw new Error('caller_database_target_invalid');
  // A fixed SELECT returns hashes only. No credential enters SQL, argv or stdout.
  const result = run('psql', [url, '-X', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c',
    `select json_build_object('key_count', count(*) filter (where name = 'kc_service_role_key'), 'key_hash', min(encode(pg_catalog.sha256(pg_catalog.convert_to(decrypted_secret, 'UTF8')), 'hex')) filter (where name = 'kc_service_role_key'), 'url_count', count(*) filter (where name = 'kc_project_url'), 'url_matches', count(*) filter (where name = 'kc_project_url' and decrypted_secret = 'https://${ref}.supabase.co')) from vault.decrypted_secrets where name in ('kc_service_role_key', 'kc_project_url')`],
    { env: { ...env, PGPASSWORD: env.PGPASSWORD || env.SUPABASE_DB_PASSWORD, PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=10000' }, encoding: 'utf8', timeout: 15000, maxBuffer: 4096 });
  const expected = createHash('sha256').update(key).digest('hex');
  let state;
  try { state = JSON.parse(result.stdout); } catch { throw new Error('vault_state_unverifiable'); }
  if (result.status !== 0 || state.key_count !== 1 || state.key_hash !== expected || state.url_count !== 1 || state.url_matches !== 1) throw new Error('vault_missing_ambiguous_or_mismatch_controlled_repair_required');
}

async function main([mode, target]) {
  if (mode === '--verify-existing') {
    verifyPreservedCaller({ target, env: process.env });
    console.log('existing Vault caller preserved; no key replacement allowed');
    return;
  }
  if (!['--check', '--prepare'].includes(mode)) throw new Error('usage_service_key_check_or_prepare');
  const key = await retrieveServiceKey({ target, env: process.env, fetch: globalThis.fetch });
  // Mask before any later step can read the file. No key goes to GITHUB_OUTPUT,
  // GITHUB_ENV, artifacts, command arguments, or diagnostic/error messages.
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::add-mask::${key}`);
  if (mode === '--prepare') {
    if (!process.env.RUNNER_TEMP) throw new Error('runner_temp_missing');
    prepareVerifiedKey(join(process.env.RUNNER_TEMP, 'kc-verified-service-key'), key);
  }
  console.log('service key retrieved and authenticated for target; no values printed');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    // Exceptions from fetch or response parsing can contain request data.
    console.error('::error::service key retrieval/validation failed; refusing before database changes');
    process.exit(1);
  });
}
