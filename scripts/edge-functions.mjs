#!/usr/bin/env node
// The Edge Functions the deploy pipeline ships to a hosted Supabase project,
// and how the deploy smoke may probe each one.
//
// One list for the deploy job and the smoke, so a function cannot be deployed
// without being checked or checked without being deployed. Every directory
// under supabase/functions with an index.ts is deployable, except shared code
// (`_*`), LOCAL_ONLY functions (must never exist on a hosted project) and
// NOT_DEPLOYED functions (kept in the repo, switched off in the pipeline).
//
//   (no args)                   print the deployable names, space-separated
//   --verify-active <json>      fail unless `supabase functions list -o json`
//                               (the file) shows every deployable function ACTIVE

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions');

/** mock-login mints sessions without OAuth for local E2E; it 404s on hosted projects but has no business there. */
export const LOCAL_ONLY = new Set(['mock-login']);

/**
 * Functions that stay in the repo but are NOT deployed to any hosted project by
 * the pipeline, with the reason (an explicit, reviewable list; adding a name
 * here is the whole opt-out, removing it is the whole opt-in, and the tests
 * force every whatsapp-* function to be listed until someone decides otherwise).
 * The pipeline never deletes a function: one that is already deployed stays at
 * its last version until removed by hand (`supabase functions delete`).
 */
export const NOT_DEPLOYED = new Map([
  ['whatsapp-intake-worker', 'WhatsApp is not part of the launch scope'],
  ['whatsapp-sender', 'WhatsApp is not part of the launch scope'],
  ['whatsapp-webhook', 'WhatsApp is not part of the launch scope'],
]);

/**
 * How the deploy smoke probes each function: one OPTIONS request carrying the
 * web origin and the public anon key, and the only statuses that prove the
 * handler booted. Supabase's gateway passes OPTIONS to the handler without
 * verifying the JWT (observed on kc-dev 2026-10-30: a GET without auth gets
 * 401 from the gateway, the same OPTIONS reaches the handler), so each status
 * below comes from the handler's own first check — before it reads a body,
 * queries the database or calls anything. `null` = not probed by the smoke;
 * its deploy is verified only by `--verify-active`. A new function
 * must be added here (a test enforces it).
 */
export const SMOKE_PROBES = {
  'backfill-image-thumbs': { expect: [405], why: 'method guard (POST only) runs first' },
  'delete-account': { expect: [200], why: 'answers the CORS preflight' },
  'dispatch-notification': { expect: [401], why: 'service-role bearer check runs before the body is read' },
  'embed-worker': { expect: [401], why: 'service-role bearer check runs first' },
  'match-rerank': { expect: [405], why: 'method guard (POST only) runs first' },
  'payments-webhook': { expect: [405], why: 'method guard (POST only) runs first' },
  'public-research-submit': { expect: [200], why: 'answers the preflight for the deployed web origin (403 = origin not allowlisted)' },
  'purge-deleted-accounts': { expect: [405], why: 'method guard (POST only) runs first' },
  'receipts-issuer': { expect: [405], why: 'method guard (POST only) runs first' },
  'reconcile-storage-orphans': { expect: [405], why: 'method guard (POST only) runs first' },
  'revenuecat-webhook': { expect: [405], why: 'method guard (POST only) runs first' },
  'rotate-research-salt': { expect: [405], why: 'method guard (POST only) runs first' },
  'strip-exif': { expect: [405], why: 'method guard (POST only) runs first' },
  'subscriptions-charger': { expect: [405], why: 'method guard (POST only) runs first' },
  translate: { expect: [200], why: 'answers the preflight for the deployed web origin' },
  'validate-donation-link': { expect: [200], why: 'answers the CORS preflight' },
};

/** Sorted deployable function names under `dir`. */
export function listDeployableFunctions(dir = DEFAULT_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !LOCAL_ONLY.has(e.name) && !NOT_DEPLOYED.has(e.name))
    .filter((e) => existsSync(join(dir, e.name, 'index.ts')))
    .map((e) => e.name)
    .sort();
}

/** Names from `names` that `listed` (CLI JSON) does not show as ACTIVE. */
export function inactiveFunctions(listed, names) {
  const active = new Set(listed.filter((f) => f.status === 'ACTIVE').map((f) => f.slug ?? f.name));
  return names.filter((n) => !active.has(n));
}

function main([flag, file]) {
  const names = listDeployableFunctions();
  if (names.length === 0) {
    console.error('::error::no deployable Edge Functions found');
    process.exit(1);
  }
  if (flag !== '--verify-active') {
    console.log(names.join(' '));
    return;
  }
  const missing = inactiveFunctions(JSON.parse(readFileSync(file, 'utf8')), names);
  for (const n of missing) console.log(`::error::Edge Function ${n} is not ACTIVE on the project`);
  if (missing.length) process.exit(1);
  console.log(`All ${names.length} Edge Functions are ACTIVE.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
