// SEC-1063 (KC#1658) — database function privileges, checked on the deployed kc-dev API.
//
// `EXECUTE` on a function of schema `public` is an explicit decision: nothing is callable by a
// signed-out visitor (role `anon`) unless a migration grants it. The pgTAP suites prove that on a
// scratch database; this journey proves it on the deployed one, over the same HTTP API the app uses:
// it calls every function the API exposes as a signed-out visitor and expects the database to
// refuse (`42501`, "permission denied for function …") for all but the reviewed public list.
//
// The function list and the argument names come from the generated database types, so a new
// function is covered the day it lands. A call carries only nulls, and a refused call runs nothing.
// The functions on the public list are not called here: their own journeys use them (research,
// share card, nonprofit pages).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { SUPABASE_URL, anonKey } from '../lib/env';

// No browser session: the calls are made as a signed-out visitor.
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Functions a signed-out visitor may call. Adding a name here is a security review: it must be a
 * read that returns only public data, granted to `anon` by a migration.
 */
const ANON_CALLABLE: ReadonlySet<string> = new Set([
  'community_stats',
  'get_nonprofit_public_page',
  'get_public_research_questions',
  'list_kc_support_channels',
  'list_verified_nonprofits',
  'post_share_card',
  'rpc_org_transparency',
]);

const TYPES_FILE = fileURLToPath(new URL('../../../app/packages/infrastructure-supabase/src/database.types.ts', import.meta.url));
/** Functions the deployed API may not know yet (a migration merged but not deployed) before the run fails. */
const MAX_UNRESOLVED = 10;
/** Calls in flight at once; the suite makes one call per function overload. */
const BATCH_SIZE = 12;

/** One way to call a function: its name and the arguments PostgREST needs to find it. */
interface FunctionCall {
  readonly name: string;
  readonly requiredArgs: readonly string[];
}

/** The `Functions` block of schema `public` in the generated types, as text. */
function publicFunctionsBlock(types: string): string {
  const schemaStart = types.indexOf('\n  public: {');
  const start = types.indexOf('\n    Functions: {', schemaStart);
  const end = types.indexOf('\n    }', start);
  if (schemaStart < 0 || start < 0 || end < 0) throw new Error('database.types.ts: no public Functions block');
  return types.slice(start, end);
}

/**
 * Every callable shape of every function: one entry per `Args` of the generated types (an
 * overloaded function has several). Optional arguments (`name?:`) are left out, as PostgREST
 * resolves a function by the names it is given.
 */
function functionCalls(types: string): FunctionCall[] {
  const block = publicFunctionsBlock(types);
  // An entry starts at six spaces of indent: `      name: {` or `      name:` (overloads).
  const entries = block.split(/\n {6}(?=[a-z_][a-z0-9_]*:)/).slice(1);
  return entries.flatMap((entry) => {
    const name = entry.slice(0, entry.indexOf(':'));
    const argSets = [...entry.matchAll(/Args: (never|\{[^}]*\})/g)].map((match) => match[1]!);
    return argSets.map((args) => ({
      name,
      requiredArgs: [...args.matchAll(/([A-Za-z_][A-Za-z0-9_]*)(\??):/g)].filter((arg) => arg[2] === '').map((arg) => arg[1]!),
    }));
  });
}

/** What the API answered to one call made as a signed-out visitor. */
interface Probe {
  readonly call: FunctionCall;
  readonly status: number;
  readonly code: string | null;
}

async function probe(request: APIRequestContext, key: string, call: FunctionCall): Promise<Probe> {
  const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${call.name}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    data: Object.fromEntries(call.requiredArgs.map((arg) => [arg, null])),
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => null)) as { code?: string } | null;
  return { call, status: response.status(), code: body?.code ?? null };
}

test('a signed-out visitor can call no database function outside the public list', async ({ request }) => {
  test.setTimeout(300_000);
  const calls = functionCalls(readFileSync(TYPES_FILE, 'utf8'));
  const names = new Set(calls.map((call) => call.name));
  // The scan must see the schema: an empty or tiny list would pass by checking nothing.
  expect(names.size, 'functions found in the generated types').toBeGreaterThan(200);
  for (const name of ANON_CALLABLE) expect(names.has(name), `${name} is on the public list but not in the schema`).toBe(true);

  const key = await anonKey();
  const guarded = calls.filter((call) => !ANON_CALLABLE.has(call.name));
  const probes: Probe[] = [];
  for (let i = 0; i < guarded.length; i += BATCH_SIZE) {
    probes.push(...(await Promise.all(guarded.slice(i, i + BATCH_SIZE).map((call) => probe(request, key, call)))));
  }

  // The database refused: the visitor has no EXECUTE on the function.
  const refused = (p: Probe) => p.status === 401 && p.code === '42501';
  // PostgREST did not find the function for these argument names, so nothing ran and nothing was
  // checked. That happens while a merged migration is not deployed to kc-dev yet (or was just
  // renamed): it is reported on the run, and tolerated only for a small share of the schema.
  const unresolved = [...new Set(probes.filter((p) => p.code === 'PGRST202' || p.code === 'PGRST203').map((p) => p.call.name))];
  const reachable = probes
    .filter((p) => !refused(p) && p.code !== 'PGRST202' && p.code !== 'PGRST203')
    .map((p) => `${p.call.name} → ${p.status} ${p.code ?? ''}`.trim());
  if (unresolved.length > 0) {
    test.info().annotations.push({ type: 'unresolved functions (types and kc-dev differ)', description: unresolved.join(', ') });
  }

  expect(reachable, 'functions a signed-out visitor could run').toEqual([]);
  expect(unresolved.length, `functions the API could not resolve: ${unresolved.join(', ')}`).toBeLessThanOrEqual(MAX_UNRESOLVED);
});
