import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { JSON_FILE, MD_FILE, STATUSES, buildMap, parseBaselineSql, parseTypes, signature } from './app-migration-map.mjs';
import { renderMarkdown } from './app-migration-map.render.mjs';
import { launchTier } from './app-migration-map.rows.mjs';

const TYPES = `export type Database = {
  public: {
    Tables: {
      posts: {
        Row: {
          id: string
          title: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ping: { Args: never; Returns: string }
      one: { Args: { p_id: string }; Returns: undefined }
      page: {
        Args: {
          p_cursor?: Json
          p_limit?: number
        }
        Returns: {
          id: string
          title: string
        }[]
        SetofOptions: {
          from: "*"
          to: "posts"
        }
      }
      twice:
        | { Args: { a: string }; Returns: boolean }
        | {
            Args: { a: string; b: string }
            Returns: boolean
          }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
`;

test('parseTypes reads tables, one-line and multi-line functions and overloads', () => {
  const types = parseTypes(TYPES);
  assert.deepEqual(types.tables.posts.columns, ['id', 'title']);
  assert.deepEqual(types.functions.ping, [{ args: {}, returns: 'string' }]);
  assert.deepEqual(types.functions.one, [{ args: { p_id: 'string' }, returns: 'undefined' }]);
  assert.deepEqual(types.functions.page[0].args, { 'p_cursor?': 'Json', 'p_limit?': 'number' });
  assert.equal(types.functions.page[0].returns, '{ id: string title: string }[]');
  assert.equal(types.functions.twice.length, 2);
  assert.deepEqual(types.functions.twice[1].args, { a: 'string', b: 'string' });
});

test('signature names a returned table row', () => {
  const types = parseTypes(TYPES);
  assert.deepEqual(signature('page', types.functions.page, types.tables), ['page(p_cursor?: Json, p_limit?: number) → posts row[]']);
  assert.deepEqual(signature('ping', types.functions.ping), ['ping() → string']);
});

test('parseBaselineSql collects errors through private helpers and the client grants', () => {
  const baseline = parseBaselineSql([{
    path: '10_x/010_a.sql',
    sql: `
create function kc_private.require_caller() returns uuid language plpgsql as $$
begin raise exception 'unauthenticated' using errcode = '42501'; end; $$;
create function public.do_it(p_id uuid) returns void language plpgsql as $$
begin
  perform kc_private.require_caller();
  raise exception 'post_not_found' using errcode = 'P0001';
end; $$;
grant select, delete on public.posts to authenticated;
grant update (title, body) on public.posts to authenticated;
grant select on public.secrets to service_role;
`,
  }]);
  assert.deepEqual(baseline.functions.do_it.errors, ['post_not_found', 'unauthenticated']);
  assert.equal(baseline.functions.do_it.source, '10_x/010_a.sql:4');
  assert.deepEqual(baseline.grants.posts, { select: true, delete: true, update: ['body', 'title'] });
  assert.equal(baseline.grants.secrets, undefined);
});

const inventory = { entries: [
  { kind: 'rpc', name: 'old_ping', file: 'a.ts', line: 1, symbol: 'f', area: 'posts' },
  { kind: 'table', name: 'posts', file: 'a.ts', line: 2, symbol: 'f', area: 'posts', ops: ['select'] },
] };
const authored = (rows) => ({
  rows, notes: [], edgeFunctions: [], missing: [{ id: 'M01', title: 't', action: 'build' }],
  packages: [{ id: 'P', title: 't', launch: 'core', select: () => true, parallelWith: [], files: ['f'], work: 'w', tests: ['x'], degrade: 'd', risks: 'r' }],
});
const row = (kind, old, status, to, extra = {}) => ({ kind, old, status, to, note: 'n', confidence: 'high', ...extra });

test('buildMap joins rows with call sites and signatures and counts by status', () => {
  const types = parseTypes(TYPES);
  const { map, problems } = buildMap(
    { ...authored([row('rpc', 'old_ping', 'renamed', ['rpc:ping']), row('table', 'posts', 'same', ['table:posts'])]), missing: [] },
    inventory, parseTypes(''), types, { functions: { ping: { source: 's:1', errors: ['e1'] } }, grants: { posts: { select: true } } }, (code) => code !== 'e1',
  );
  assert.deepEqual(problems, []);
  assert.equal(map.totals.rpc.renamed, 1);
  assert.equal(map.modules.posts.oneToOne, 2);
  const ping = map.rows.find((r) => r.old === 'old_ping');
  assert.deepEqual(ping.targets[0].errors, [{ code: 'e1', knownToApp: false }]);
  assert.deepEqual(map.packages[0].counts, { objects: 2, oneToOne: 2, changed: 0, removed: 0, missing: 0 });
  assert.match(renderMarkdown(map), /`ping\(\) → string`/);
});

test('buildMap reports every way the map can drift', () => {
  const types = parseTypes(TYPES);
  const check = (rows) => buildMap(authored(rows), inventory, parseTypes(''), types, { functions: {}, grants: {} }).problems.join('\n');
  assert.match(check([row('table', 'posts', 'same', ['table:posts'])]), /rpc:old_ping: used by the code but has no row/);
  assert.match(check([row('rpc', 'old_ping', 'renamed', ['rpc:nope']), row('table', 'posts', 'same', ['table:posts'])]), /target function 'nope' is not in the baseline/);
  assert.match(check([row('rpc', 'gone', 'removed', []), row('rpc', 'old_ping', 'removed', []), row('table', 'posts', 'same', ['table:posts'])]), /rpc:gone: not used by the code any more/);
  assert.match(check([row('rpc', 'old_ping', 'removed', ['rpc:ping']), row('table', 'posts', 'same', ['table:posts'])]), /status 'removed' and targets/);
  assert.match(check([row('rpc', 'old_ping', 'missing', [], { missing: 'M99' }), row('table', 'posts', 'same', ['table:posts'])]), /missing id 'M99' is not in the MISSING list/);
  assert.match(check([row('rpc', 'old_ping', 'weird', ['rpc:ping']), row('table', 'posts', 'same', ['table:posts'])]), /unknown status 'weird'/);
});

test('launch tier: a name rule wins over the module, otherwise the most critical module', () => {
  assert.equal(launchTier({ old: 'finance_ledger_list' }, ['admin']), 'later');
  assert.equal(launchTier({ old: 'admin_grant_role' }, ['admin']), 'core');
  assert.equal(launchTier({ old: 'book_ride_seat' }, ['rides']), 'wedge');
  assert.equal(launchTier({ old: 'cities' }, ['rides', 'cities']), 'core');
  assert.equal(launchTier({ old: 'anything' }, ['fn:whatsapp-webhook']), 'later');
});

test('the committed map is complete, launch-tagged and up to date', () => {
  assert.equal(existsSync(JSON_FILE) && existsSync(MD_FILE), true, 'run: node scripts/app-migration-map.mjs');
  const map = JSON.parse(readFileSync(JSON_FILE, 'utf8'));
  for (const r of map.rows) {
    assert.equal(STATUSES.includes(r.status), true, r.old);
    assert.match(r.launch, /^(core|wedge|later)$/, r.old);
    assert.equal(r.callSites.length > 0, true, r.old);
    if (r.status === 'missing') assert.equal(map.missing.some((m) => m.id === r.missing), true, r.old);
  }
  // Launch blockers are listed first.
  const firstNonBlocker = map.missing.findIndex((m) => !m.blocker);
  assert.equal(map.missing.slice(firstNonBlocker).some((m) => m.blocker), false);
  // Packages are in launch order: no launch package after a `later` one.
  const firstLater = map.packages.findIndex((p) => p.launch === 'later');
  assert.equal(map.packages.slice(firstLater).every((p) => p.launch === 'later'), true);
  for (const p of map.packages) assert.equal(typeof p.degrade === 'string' && p.degrade.length > 0, true, p.id);
  assert.equal(readFileSync(MD_FILE, 'utf8'), renderMarkdown(map));
});
