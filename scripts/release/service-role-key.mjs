#!/usr/bin/env node
// Read-only existing-key retrieval. stdout is a credential pipe, never a log.
import { pathToFileURL } from 'node:url';

const REF = /^[a-z]{20}$/;
const fail = () => new Error('Service caller key verification failed; no credential was emitted.');

export function selectServiceKey(keys) {
  if (!Array.isArray(keys)) throw fail();
  const defaults = keys.filter(k => k?.type === 'secret' && (k.name === 'default' || k.id === 'default'));
  if (defaults.length > 1) throw fail();
  if (defaults.length === 1) {
    const key = defaults[0].api_key;
    if (typeof key !== 'string' || !/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key)) throw fail();
    return key;
  }
  const legacy = keys.filter(k => k?.name === 'service_role' || k?.id === 'service_role');
  if (legacy.length !== 1 || typeof legacy[0].api_key !== 'string' || !/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(legacy[0].api_key)) throw fail();
  return legacy[0].api_key;
}

export async function verifiedServiceKey({ projectRef, accessToken, fetchImpl = fetch }) {
  if (!REF.test(projectRef ?? '') || !accessToken) throw fail();
  const read = async () => {
    const response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
      method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw fail();
    return selectServiceKey(await response.json());
  };
  try {
    const first = await read();
    if (first !== await read()) throw fail();
    // A nonclaiming platform GET validates the returned value before Vault can be updated.
    // Prefix/length checks alone accept the CLI's stable but unusable no-reveal value.
    const response = await fetchImpl(`https://${projectRef}.supabase.co/auth/v1/settings`, {
      method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${first}`, apikey: first }, signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200) throw fail();
    const settings = await response.json();
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || typeof settings.external !== 'object' || settings.external === null) throw fail();
    return first;
  } catch {
    // Never include response bodies, request headers, key values or provider exceptions.
    throw fail();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true') throw fail();
    const key = await verifiedServiceKey({ projectRef: process.env.SUPABASE_PROJECT_REF, accessToken: process.env.SUPABASE_ACCESS_TOKEN });
    // Mask before writing to the pipe. A failure emits no credential and exits nonzero.
    process.stderr.write(`::add-mask::${key}\n`);
    process.stdout.write(key);
  } catch {
    process.stderr.write('Service caller key verification failed; Vault was not updated.\n');
    process.exitCode = 1;
  }
}
