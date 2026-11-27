#!/usr/bin/env node
// Guards ADR-009 phase 5 ("the API becomes the only door") while the move is in flight.
//
// The app must reach the backend only through the doors in apps/mobile/src/services/backend:
// data through adapters wrapped with `viaApi`, channels through `viaApiRealtime`, files
// through `storageBackend.ts`. This check
// finds, in apps/mobile, every place that reaches Supabase another way:
//   - an adapter constructed without `viaApi(...)` around it
//   - a table or function called on a Supabase client directly (`.from('x')`, `.rpc('x')`)
//   - a channel opened on the client itself (`supabase.channel(`)
//   - a bucket addressed directly (`storage.from(`) or a storage address built by hand
//     (`/storage/v1/…`): files move in phase 7
//   - an Edge Function invoked directly (`functions.invoke(`)
//   - the session read or changed on the client (`.auth.<method>(`): sign-in moves in phase 9
// and fails on any finding that is not in KNOWN below. KNOWN is a ratchet: an entry whose
// code is gone must be removed too, so the list can only shrink, and the move is done when
// it is empty. Comments are not code: a pattern inside one is not a finding.
//
// Run from `app/`: `node scripts/check-api-door.mjs`. Wired into `pnpm lint:arch`.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['apps/mobile/src', 'apps/mobile/app'];
const SKIP_DIRS = new Set(['node_modules', '__tests__', '__mocks__', 'dist', '.expo']);

/**
 * What still bypasses the API door, and the phase of ADR-009 that removes it.
 * Key: `<file>: <finding>`.
 */
export const KNOWN = new Map([
  // Files: phase 7. Everything goes through the storage door (ADR-012 step 3); what is left
  // is the door's own Supabase side, removed when the files have moved, and a prepared,
  // unused contract for private photos.
  ['apps/mobile/src/lib/privatePhotoSource.ts: storage URL', 'phase 7'],
  ['apps/mobile/src/services/backend/storageBackend.ts: storage.from()', 'phase 7'],
  ['apps/mobile/src/services/backend/storageBackend.ts: storage URL', 'phase 7'],
  // Sign-in and the session: phase 9.
  ['apps/mobile/src/services/authComposition.ts: new SupabaseAuthService', 'phase 9'],
  ['apps/mobile/src/services/backend/apiBackend.ts: .auth.getSession()', 'phase 9'],
  ['apps/mobile/src/services/backend/apiBackend.ts: .auth.refreshSession()', 'phase 9'],
  ['apps/mobile/src/services/backend/storageBackend.ts: .auth.getSession()', 'phase 9'],
]);

const ADAPTER = /new ((?:Supabase|EdgeFn)\w+)\(/g;
const DIRECT_CALL = /\.(from|rpc)\(\s*'([a-z_0-9]+)'/g;
const WRAPPED = /viaApi\(\s*'[A-Za-z0-9]+',\s*$/;
const ON_REALTIME_DOOR = /^\s*viaApiRealtime\(/;
/** A channel opened on a Supabase client itself, e.g. `supabase.channel(` or `getSupabaseClient()\n  .channel(`. */
const DIRECT_CHANNEL = /(?:\bsupabase|\bclient|getSupabaseClient\([^)]*\))\s*\.channel\(/g;
/** A bucket addressed on a client: `client.storage.from(`, also across a line break. */
const DIRECT_BUCKET = /\bstorage\s*\.from\(/g;
/** A storage address built by hand instead of asked from the storage door. */
const STORAGE_URL = /\/storage\/v1\//g;
const DIRECT_FUNCTION = /\bfunctions\s*\.invoke\(/g;
/** A call on something named `auth`: `client.auth.getSession(`, or `auth.signOut(` on a variable. */
const AUTH_CALL = /(\.\s*)?\bauth\s*\.\s*([A-Za-z]+)\(/g;
/**
 * The session methods of the Supabase client. A variable named `auth` is a finding only for
 * one of these: the app's own auth store is also called `auth` and is not a door to Supabase.
 */
const SESSION_METHOD = /^(getSession|getUser|getClaims|setSession|refreshSession|exchangeCodeForSession|onAuthStateChange|signOut|signUp|signIn\w+|verifyOtp|resend|reauthenticate|updateUser|resetPasswordForEmail|linkIdentity|unlinkIdentity|startAutoRefresh|stopAutoRefresh)$/;

/**
 * The source without its comments, so prose about a pattern is not a finding. A `//` that
 * follows a colon or a quote is part of an address or a string, not a comment.
 */
export function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** The findings in one source file, as `<finding>` strings, each at most once. */
export function findingsIn(rawSource) {
  const source = withoutComments(rawSource);
  const findings = [];
  for (const match of source.matchAll(ADAPTER)) {
    const after = source.slice(match.index + match[0].length);
    // A data adapter is wrapped by `viaApi('<port>', new …)`; a realtime adapter is built on
    // `viaApiRealtime(<client>)`, which swaps the client's channels for the API's (ADR-011).
    if (!WRAPPED.test(source.slice(0, match.index)) && !ON_REALTIME_DOOR.test(after)) findings.push(`new ${match[1]}`);
  }
  for (const match of source.matchAll(DIRECT_CALL)) {
    const before = source.slice(0, match.index);
    // `storage.from('<bucket>')` addresses a bucket, not a table: reported below as a bucket.
    if (/storage\s*$/.test(before)) continue;
    // `Buffer.from('…')`, `Array.from(…)`: a static method of a class, not a database client.
    if (/\b[A-Z]\w*\s*$/.test(before)) continue;
    findings.push(`.${match[1]}('${match[2]}')`);
  }
  // Channels go through `viaApiRealtime(supabase).channel(…)` or an adapter built on it.
  if (DIRECT_CHANNEL.test(source)) findings.push('supabase.channel()');
  if (DIRECT_BUCKET.test(source)) findings.push('storage.from()');
  if (STORAGE_URL.test(source)) findings.push('storage URL');
  if (DIRECT_FUNCTION.test(source)) findings.push('functions.invoke()');
  for (const match of source.matchAll(AUTH_CALL)) {
    // `<client>.auth.<anything>(` is the client's session; a bare `auth.<method>(` only when the method is one of its own.
    if (match[1] !== undefined || SESSION_METHOD.test(match[2])) findings.push(`.auth.${match[2]}()`);
  }
  // A global pattern remembers where `test` stopped; the next file starts from the beginning.
  for (const pattern of [DIRECT_CHANNEL, DIRECT_BUCKET, STORAGE_URL, DIRECT_FUNCTION]) pattern.lastIndex = 0;
  return [...new Set(findings)];
}

function sourceFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, files);
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

/** Compares what the code contains with what is known; returns the two kinds of drift. */
export function compare(found, known = KNOWN) {
  const foundSet = new Set(found);
  return {
    unexpected: found.filter((key) => !known.has(key)),
    stale: [...known.keys()].filter((key) => !foundSet.has(key)),
  };
}

function main() {
  const found = SCAN_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))).flatMap((file) => {
    const path = relative(ROOT, file).replace(/\\/g, '/');
    return findingsIn(readFileSync(file, 'utf8')).map((finding) => `${path}: ${finding}`);
  });
  const { unexpected, stale } = compare(found);

  if (unexpected.length > 0) {
    console.error('\n✗ The app reaches Supabase without going through the API door:\n');
    for (const key of unexpected) console.error(`  • ${key}`);
    console.error("\nWrap the adapter with viaApi('<wire name>', …) or build it on viaApiRealtime(…)");
    console.error('(apps/mobile/src/services/backend/apiBackend.ts), send file work through storageBackend.ts next to it,');
    console.error('or move a direct call behind an application port.');
    console.error('See docs/architecture/adr/ADR-010-port-gateway.md.\n');
  }
  if (stale.length > 0) {
    console.error('\n✗ KNOWN in app/scripts/check-api-door.mjs lists code that is gone; remove these entries:\n');
    for (const key of stale) console.error(`  • ${key}`);
    console.error('');
  }
  if (unexpected.length > 0 || stale.length > 0) process.exit(1);
  const phases = [...new Set(KNOWN.values())].sort().join(', ');
  console.log(`✓ API door check passed — ${KNOWN.size} known bypasses left (ADR-009 ${phases}).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
