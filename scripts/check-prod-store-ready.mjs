#!/usr/bin/env node
/**
 * Read-only go/no-go for a PROD store build against the kc-prod ledger.
 *
 * Fails closed unless:
 *   - KC_PROD_STORE_BUILD_ENABLED is exactly "true"
 *   - KC_PROD_SCHEMA_MODE is "baseline"
 *   - supabase/baseline/prod-allowed-migrations.txt is non-empty
 *   - the kc-prod migration ledger is non-empty and exactly matches that
 *     allowlist (versions derived from the approved basenames)
 *
 * Also reuses scripts/check-prod-ledger.mjs so a `myself` schema/hook or
 * the wrong project ref still fails closed. This is stricter than the daily
 * watch, which allows an empty ledger.
 *
 * Reads only: GET /database/migrations, GET /config/auth, and POST
 * /database/query/read-only. Never writes schema, auth, or functions.
 * This script does not set KC_PROD_SCHEMA_MODE or the enable flag.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROD_REF,
  evaluateProdLedger,
  inspectProdLedger,
  migrationVersion,
  repoVersionsFromFiles,
  supabaseProdReader,
} from './check-prod-ledger.mjs';
import {
  loadAllowedManifest,
  listMigrationFiles,
  normalizeProdSchemaMode,
} from './check-prod-schema-mode.mjs';
import { enabledErrors } from './prod-store-build-gate.mjs';

export { PROD_REF };

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function allowlistVersions(allowed) {
  return [...new Set(allowed.map(migrationVersion).filter(Boolean))].sort();
}

export function evaluateProdStoreReady({
  enabled,
  mode,
  allowed = [],
  projectRef,
  expectedRef = PROD_REF,
  ledger = [],
  schemas = [],
  myselfAuthHits = [],
}) {
  const errors = [];
  errors.push(...enabledErrors(enabled));

  const normalized = normalizeProdSchemaMode(mode);
  if (normalized !== 'baseline') {
    errors.push(
      `PROD store builds require KC_PROD_SCHEMA_MODE=baseline (got "${normalized}"). ` +
        'Do not enable the store pipeline until the DB agent has applied the approved baseline.',
    );
  }
  if (allowed.length === 0) {
    errors.push(
      'PROD store builds require a non-empty supabase/baseline/prod-allowed-migrations.txt.',
    );
  }

  const repoVersions = repoVersionsFromFiles(allowed);
  const ledgerResult = evaluateProdLedger({
    projectRef,
    expectedRef,
    repoVersions,
    ledger,
    schemas,
    myselfAuthHits,
  });
  errors.push(...ledgerResult.errors);

  const prodVersions = ledgerResult.prodVersions ?? [];
  if (prodVersions.length === 0) {
    errors.push(
      'kc-prod migration ledger is empty. The new baseline has not been applied; refusing a PROD store build.',
    );
  }

  const expected = allowlistVersions(allowed);
  if (expected.length > 0 && prodVersions.length > 0) {
    const expectedSet = new Set(expected);
    const ledgerSet = new Set(prodVersions);
    const missing = expected.filter((v) => !ledgerSet.has(v));
    const extra = prodVersions.filter((v) => !expectedSet.has(v));
    if (missing.length || extra.length) {
      const parts = [];
      if (missing.length) parts.push(`missing from ledger: ${missing.join(', ')}`);
      if (extra.length) parts.push(`not in the baseline allowlist: ${extra.join(', ')}`);
      errors.push(`kc-prod ledger does not match the approved baseline (${parts.join('; ')})`);
    }
  }

  return [...new Set(errors)];
}

export async function main(env, io = {}) {
  const token = env.SUPABASE_ACCESS_TOKEN ?? '';
  const projectRef = env.SUPABASE_PROJECT_REF ?? PROD_REF;
  if (!token) {
    console.error('::error::SUPABASE_ACCESS_TOKEN is missing (supabase-prod environment)');
    return 1;
  }
  const root = io.root ?? DEFAULT_ROOT;
  const allowed = io.allowed ?? loadAllowedManifest(root);
  const log = io.log ?? console;

  let ledgerResult;
  if (io.inspect) {
    ledgerResult = await io.inspect();
  } else {
    const supabase = io.supabase ?? supabaseProdReader({ projectRef, token, fetchImpl: fetch });
    ledgerResult = await inspectProdLedger({
      supabase,
      projectRef,
      repoVersions: repoVersionsFromFiles(allowed),
    });
  }

  const errors = evaluateProdStoreReady({
    enabled: env.KC_PROD_STORE_BUILD_ENABLED,
    mode: env.KC_PROD_SCHEMA_MODE,
    allowed,
    projectRef,
    ledger: (ledgerResult.prodVersions ?? []).map((version) => ({ version })),
    schemas: io.schemas ?? [],
    myselfAuthHits: io.myselfAuthHits ?? [],
  });

  // inspectProdLedger already collected myself / wrong-ref / unexpected. If the
  // caller didn't pass schemas/hits through io, merge inspect errors that
  // evaluateProdStoreReady would have missed (empty schemas default).
  if (!io.schemas && !io.myselfAuthHits && !io.inspect) {
    // schemas/hits were used inside inspect but not returned as raw inputs.
    // inspectProdLedger.errors already has myself / unexpected; merge them.
    for (const e of ledgerResult.errors ?? []) {
      if (!errors.includes(e)) errors.push(e);
    }
  }

  if (errors.length) {
    for (const e of errors) (log.error ?? log.log)(`::error::${e}`);
    return 1;
  }
  const count = allowlistVersions(allowed).length;
  (log.info ?? log.log)(
    `PROD store-ready: kc-prod ledger matches the baseline allowlist (${count} versions).`,
  );
  // listMigrationFiles is a cheap sanity that the repo still has the tree;
  // it is not part of the ledger-vs-manifest gate.
  listMigrationFiles(root);
  return 0;
}

const launched =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (launched) {
  main(process.env).then((code) => {
    if (code) process.exit(code);
  }).catch((err) => {
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
