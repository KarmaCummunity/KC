import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export const MAX_BYTES = 25 * 1024 * 1024;
const HOST = 'enbqriuxvvuontiwslun.supabase.co';
const ROOT = '/storage/v1/object/upload/sign/kc-native-evidence/';
export function validateCapability(raw, now = Date.now(), minimumSeconds = 300) {
  const c = JSON.parse(raw);
  if (!c || typeof c.url !== 'string') throw Error('Missing private upload capability');
  const u = new URL(c.url);
  if (u.protocol !== 'https:' || u.hostname !== HOST || u.port || u.username || u.password || u.hash) throw Error('Invalid evidence destination');
  if (!new RegExp('^' + ROOT + '[a-f0-9]{32}/evidence\\.cms$').test(u.pathname)) throw Error('Invalid evidence object');
  if ([...u.searchParams.keys()].join(',') !== 'token') throw Error('Invalid capability parameters');
  const token = u.searchParams.get('token');
  if (!token || token.split('.').length !== 3) throw Error('Invalid upload token');
  const claim = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  if (!Number.isSafeInteger(claim.exp) || claim.exp * 1000 < now + minimumSeconds * 1000) throw Error('Upload capability expired or too short');
  if (claim.upsert === true) throw Error('Overwrite capability forbidden');
  if (c.candidate !== '02cf8dc342de36ad8e229f6537d5ea10c0a0dfc0') throw Error('Candidate mismatch');
  return { url: u.toString(), expires: claim.exp };
}
export async function uploadEvidence(raw, file, fetcher = fetch) {
  const c = validateCapability(raw);
  const size = statSync(file).size;
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES) throw Error('Evidence size outside private transport limit');
  const res = await fetcher(c.url, {
    method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-upsert': 'false' },
    body: readFileSync(file),
  });
  if (!res.ok) throw Error('Private evidence upload failed');
  await res.arrayBuffer();
  return { uploaded: true, bytes: size };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const raw = process.env.KC_NATIVE_UPLOAD_CAPABILITY;
    if (process.argv[2] === 'preflight') validateCapability(raw, Date.now(), 100 * 60);
    else if (process.argv[2] === 'upload') await uploadEvidence(raw, process.argv[3]);
    else throw Error('Invalid transport command');
    console.log('Private evidence transport check passed');
  } catch {
    console.error('Private evidence transport failed closed; no fallback destination');
    process.exitCode = 1;
  }
}
