import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function validateTarget(sha, webUrl, payload) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('Exact lowercase 40-character commit required');
  const url = new URL(webUrl);
  if (url.protocol !== 'https:' || !/^[0-9a-f]+\.karma-community\.pages\.dev$/.test(url.hostname) || url.pathname !== '/' || url.search || url.hash) throw new Error('Immutable KC Pages deployment root required');
  if (payload.sha !== sha) throw new Error('Pinned web source does not match candidate');
  return { source: sha, webUrl: url.href, environment: 'development', scope: 'Unchanged-source simulator guest acceptance, not store binary or APNs acceptance' };
}
export function chooseDevice(payload, family) {
  if (!['iPad', 'iPhone'].includes(family)) throw new Error('Unsupported device family');
  const rows = Object.entries(payload.devices ?? {}).filter(([runtime]) => runtime.includes('iOS')).sort(([a], [b]) => b.localeCompare(a)).flatMap(([runtime, devices]) => devices.map(d => ({ ...d, runtime })));
  const selected = rows.find(d => d.isAvailable !== false && d.name?.startsWith(family));
  if (!selected?.udid || !selected.deviceTypeIdentifier) throw new Error('Requested simulator family/type unavailable');
  return { name: selected.name, udid: selected.udid, runtime: selected.runtime, deviceTypeIdentifier: selected.deviceTypeIdentifier, family };
}
export function cleanCandidate(root, expected) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== expected || git('status', '--porcelain', '--untracked-files=no')) throw new Error('Candidate source identity changed');
  return { commit: expected, tree: git('rev-parse', 'HEAD^{tree}'), trackedDiff: false };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'target') {
    const [sha, url] = args;
    const response = await fetch(new URL('/version.json', url));
    if (!response.ok) throw new Error('Pinned deployment version unavailable');
    console.log(JSON.stringify(validateTarget(sha, url, await response.json())));
  } else if (mode === 'device') console.log(JSON.stringify(chooseDevice(JSON.parse(readFileSync(args[0], 'utf8')), args[1])));
  else if (mode === 'source') console.log(JSON.stringify(cleanCandidate(args[0], args[1])));
  else if (mode === 'hash') console.log(createHash('sha256').update(readFileSync(args[0])).digest('hex'));
  else throw new Error('Unsupported mode');
}
