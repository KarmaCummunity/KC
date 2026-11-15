#!/usr/bin/env node
// Read-only watch of the kc-prod migration ledger and a check that the
// `myself` schema / Auth hook never appears there (D-228, PROD readiness).
// Talks to the Supabase Management API only: GET /database/migrations,
// GET /config/auth, POST /database/query/read-only. Never applies migrations
// and never uses the write query endpoint.
//
// Env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF (must be the pinned prod
// ref). Optional repo root is the working tree being compared.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS } from './deploy-preflight.mjs';
import { listMigrationFiles } from './check-prod-schema-mode.mjs';

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PROD_REF = TARGETS.prod.ref;
export const MYSELF_SCHEMA_SQL =
  "select nspname::text as nspname from pg_namespace where nspname = 'myself'";

/** Leading version token of a supabase/migrations basename (digits before _). */
export function migrationVersion(filename) {
  const m = String(filename).match(/^(\d+)/);
  return m ? m[1] : null;
}

export function repoVersionsFromFiles(files) {
  return new Set(files.map(migrationVersion).filter(Boolean));
}

/** Normalize Management API migration payloads into {version, name} rows. */
export function parseLedger(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.migrations ?? payload?.data ?? [];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (typeof row === 'string') return { version: migrationVersion(row) ?? row, name: row };
      const version = String(row?.version ?? row?.id ?? row?.name ?? '');
      const name = String(row?.name ?? row?.filename ?? version);
      return { version: migrationVersion(version) ?? version, name };
    })
    .filter((row) => row.version);
}

const MYSELF_RE = /myself/i;

/** Paths in the Auth config whose string values mention `myself`. */
export function findMyselfInAuthConfig(config, path = '') {
  const hits = [];
  if (typeof config === 'string') {
    if (MYSELF_RE.test(config)) hits.push(path ? `${path}=${config}` : config);
    return hits;
  }
  if (!config || typeof config !== 'object') return hits;
  for (const [key, value] of Object.entries(config)) {
    const next = path ? `${path}.${key}` : key;
    if (MYSELF_RE.test(key) && (value == null || value === true || typeof value === 'string')) {
      hits.push(typeof value === 'string' ? `${next}=${value}` : next);
    }
    hits.push(...findMyselfInAuthConfig(value, next));
  }
  return hits;
}

export function schemaNamesFromQuery(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((row) => String(row?.nspname ?? '')).filter(Boolean);
}

/**
 * Compare the prod ledger to the repo and refuse a `myself` schema or hook.
 * An empty ledger is expected until the first approved D-228 apply.
 */
export function evaluateProdLedger({
  projectRef,
  expectedRef = PROD_REF,
  repoVersions,
  ledger,
  schemas,
  myselfAuthHits,
}) {
  const errors = [];
  const notes = [];

  if (projectRef !== expectedRef) {
    errors.push(
      `SUPABASE_PROJECT_REF must be the prod project ${expectedRef} (got ${projectRef ? 'another value' : 'nothing'})`,
    );
    return { ok: false, errors, notes, prodVersions: [], unexpected: [], pending: repoVersions.size };
  }

  const prodVersions = [...new Set(ledger.map((row) => row.version))];
  const unexpected = prodVersions.filter((v) => !repoVersions.has(v)).sort();
  const pending = [...repoVersions].filter((v) => !prodVersions.includes(v)).sort();

  if (schemas.includes('myself')) {
    errors.push('kc-prod has a `myself` schema; it must never appear on production');
  }
  if (myselfAuthHits.length) {
    errors.push(
      `kc-prod Auth config mentions myself (${myselfAuthHits.slice(0, 5).join('; ')}); the hook must never be enabled on production`,
    );
  }
  if (unexpected.length) {
    errors.push(
      `kc-prod ledger has ${unexpected.length} version(s) not in supabase/migrations: ${unexpected.slice(0, 8).join(', ')}`,
    );
  }

  if (prodVersions.length === 0) {
    notes.push('kc-prod ledger is empty (expected until the first approved D-228 apply)');
  } else {
    notes.push(`kc-prod ledger has ${prodVersions.length} applied version(s)`);
  }
  notes.push(`${pending.length} repo migration(s) are not on prod`);

  return { ok: errors.length === 0, errors, notes, prodVersions, unexpected, pending };
}

export function supabaseProdReader({ projectRef, token, fetchImpl = fetch }) {
  const base = `https://api.supabase.com/v1/projects/${projectRef}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const read = async (path, init = {}) => {
    const res = await fetchImpl(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers } });
    const text = await res.text().catch(() => '');
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      throw new Error(`${path} HTTP ${res.status}${text ? `: ${String(text).slice(0, 200)}` : ''}`);
    }
    return body;
  };
  return {
    async listMigrations() {
      const body = await read('/database/migrations');
      return parseLedger(body);
    },
    async authConfig() {
      return read('/config/auth');
    },
    async schemaNames() {
      const body = await read('/database/query/read-only', {
        method: 'POST',
        body: JSON.stringify({ query: MYSELF_SCHEMA_SQL }),
      });
      return schemaNamesFromQuery(body);
    },
  };
}

export async function inspectProdLedger({ supabase, projectRef, expectedRef, repoVersions }) {
  const ledger = await supabase.listMigrations();
  const schemas = await supabase.schemaNames();
  const auth = await supabase.authConfig();
  return evaluateProdLedger({
    projectRef,
    expectedRef,
    repoVersions,
    ledger,
    schemas,
    myselfAuthHits: findMyselfInAuthConfig(auth),
  });
}

async function main() {
  const projectRef = process.env.SUPABASE_PROJECT_REF ?? '';
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
  if (!token) {
    console.log('::error title=PROD ledger::SUPABASE_ACCESS_TOKEN is empty');
    process.exit(1);
  }
  const repoVersions = repoVersionsFromFiles(listMigrationFiles(DEFAULT_ROOT));
  const supabase = supabaseProdReader({ projectRef, token, fetchImpl: globalThis.fetch });
  const result = await inspectProdLedger({ supabase, projectRef, repoVersions });
  for (const n of result.notes) console.log(n);
  for (const e of result.errors) console.log(`::error title=PROD ledger::${e}`);
  if (!result.ok) process.exit(1);
  console.log('PROD ledger check passed (read-only).');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.log(`::error title=PROD ledger::${err.message}`);
    process.exit(1);
  });
}
