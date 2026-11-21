#!/usr/bin/env node
// Guards ADR-009 phase 5 ("the API becomes the only door") while the move is in flight.
//
// The app must reach the database only through adapters wrapped with `viaApi`, so each port
// can be served by KC's API. This check finds, in apps/mobile:
//   - an adapter constructed without `viaApi(...)` around it
//   - a table or function called on a Supabase client directly (`.from('x')`, `.rpc('x')`)
// and fails on any finding that is not in KNOWN below. KNOWN is a ratchet: an entry whose
// code is gone must be removed too, so the list can only shrink, and the phase is done
// when it is empty.
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
  // Realtime and presence: phase 6.
  ['apps/mobile/src/lib/container.ts: new SupabaseChatRealtime', 'phase 6'],
  ['apps/mobile/src/lib/container.ts: new SupabaseChatV2Realtime', 'phase 6'],
  ['apps/mobile/src/lib/container.ts: new SupabaseOnlinePresence', 'phase 6'],
  ['apps/mobile/src/services/postsComposition.ts: new SupabaseFeedRealtime', 'phase 6'],
  ['apps/mobile/src/services/userRealtimeComposition.ts: new SupabaseUserRealtime', 'phase 6'],
  // Edge Function services: phase 8.
  ['apps/mobile/src/services/importComposition.ts: new EdgeFnPostExtractionService', 'phase 8'],
  ['apps/mobile/src/services/postsComposition.ts: new EdgeFnTranslationService', 'phase 8'],
  // Sign-in: phase 9.
  ['apps/mobile/src/services/authComposition.ts: new SupabaseAuthService', 'phase 9'],
  // A device cache around public reads, with Date values (phase 5: needs a JSON-safe port).
  ['apps/mobile/src/services/legalComposition.ts: new SupabaseLegalDocumentRepository', 'phase 5: needs a JSON-safe port'],
]);

const ADAPTER = /new ((?:Supabase|EdgeFn)\w+)\(/g;
const DIRECT_CALL = /\.(from|rpc)\(\s*'([a-z_0-9]+)'/g;
const WRAPPED = /viaApi\(\s*'[A-Za-z0-9]+',\s*$/;

/** The findings in one source file, as `<finding>` strings. */
export function findingsIn(source) {
  const findings = [];
  for (const match of source.matchAll(ADAPTER)) {
    if (!WRAPPED.test(source.slice(0, match.index))) findings.push(`new ${match[1]}`);
  }
  for (const match of source.matchAll(DIRECT_CALL)) {
    const before = source.slice(0, match.index);
    // `storage.from('<bucket>')` addresses a bucket, not a table; Storage moves in phase 7.
    if (/storage\s*$/.test(before)) continue;
    // `Buffer.from('…')`, `Array.from(…)`: a static method of a class, not a database client.
    if (/\b[A-Z]\w*\s*$/.test(before)) continue;
    findings.push(`.${match[1]}('${match[2]}')`);
  }
  return findings;
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
    console.error("\nWrap the adapter with viaApi('<wire name>', …) (apps/mobile/src/services/backend/apiBackend.ts),");
    console.error('or move a direct call behind an application port. See docs/architecture/adr/ADR-010-port-gateway.md.\n');
  }
  if (stale.length > 0) {
    console.error('\n✗ KNOWN in app/scripts/check-api-door.mjs lists code that is gone; remove these entries:\n');
    for (const key of stale) console.error(`  • ${key}`);
    console.error('');
  }
  if (unexpected.length > 0 || stale.length > 0) process.exit(1);
  console.log(`✓ API door check passed — ${KNOWN.size} known bypasses left (ADR-009 phases 5, 6, 8, 9).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
