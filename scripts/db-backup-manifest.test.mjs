// Unit tests for scripts/db-backup-manifest.mjs. Run: node --test scripts/db-backup-manifest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchemaTables, parseDataRows, buildManifest, countsSql, compareCounts, restorableData, restorableTables } from './db-backup-manifest.mjs';

const SCHEMA = [
  'SET statement_timeout = 0;',
  'CREATE TABLE IF NOT EXISTS "public"."posts" (',
  '    "id" uuid NOT NULL',
  ');',
  'CREATE TABLE "public"."cities" (',
  ');',
  'CREATE INDEX posts_idx ON "public"."posts" ("id");',
];
const DATA = [
  'SET session_replication_role = replica;',
  'COPY "public"."posts" ("id", "title") FROM stdin;',
  'a\tfirst',
  'b\tsecond',
  '\\.',
  'COPY "public"."cities" ("city_id") FROM stdin;',
  '\\.',
  'COPY "public"."posts" ("id", "title") FROM stdin;',
  'c\t\\.not-a-terminator-in-a-value',
  '\\.',
];

test('schema: tables are found, sorted and de-duplicated; indexes are not tables', async () => {
  assert.deepEqual(await parseSchemaTables(SCHEMA), ['"public"."cities"', '"public"."posts"']);
});

test('data: rows are the lines of each COPY block, empty tables count zero', async () => {
  assert.deepEqual(await parseDataRows(DATA), { '"public"."posts"': 3, '"public"."cities"': 0 });
});

test('an empty database is a named state, not an error', async () => {
  const tables = await parseSchemaTables(['SET x = 1;', 'CREATE SCHEMA IF NOT EXISTS "public";']);
  const rows = await parseDataRows(['SET session_replication_role = replica;']);
  const m = buildManifest({ target: 'prod', ref: 'r', sha: 's', tables, rows, at: 't' });
  assert.equal(m.empty, true);
  assert.equal(m.tableCount, 0);
  assert.equal(m.totalRows, 0);
  assert.equal(countsSql(m), 'select 1 where false;\n');
  assert.deepEqual(compareCounts(m, ''), []);
});

test('manifest totals', async () => {
  const m = buildManifest({ target: 'dev', ref: 'r', sha: 's', tables: await parseSchemaTables(SCHEMA), rows: await parseDataRows(DATA), at: 't' });
  assert.equal(m.empty, false);
  assert.equal(m.tableCount, 2);
  assert.equal(m.totalRows, 3);
});

test('counts SQL covers every table with data and rejects odd names', async () => {
  const m = buildManifest({ target: 'dev', ref: 'r', sha: 's', tables: await parseSchemaTables(SCHEMA), rows: await parseDataRows(DATA), at: 't' });
  const sql = countsSql(m);
  assert.match(sql, /from "public"\."cities"/);
  assert.match(sql, /from "public"\."posts"/);
  assert.throws(() => countsSql({ userSchemas: ['public'], rows: { '"public"."x"; drop table y': 1 } }), /unexpected table name/);
});

test('compare: matching counts pass; a missing or short table fails', async () => {
  const m = buildManifest({ target: 'dev', ref: 'r', sha: 's', tables: await parseSchemaTables(SCHEMA), rows: await parseDataRows(DATA), at: 't' });
  assert.deepEqual(compareCounts(m, '"public"."cities"\t0\n"public"."posts"\t3\n'), []);
  assert.equal(compareCounts(m, '"public"."cities"\t0\n').length, 1);
  assert.match(compareCounts(m, '"public"."cities"\t0\n"public"."posts"\t2\n')[0], /restored 2 rows, dump has 3/);
});

const MANAGED_DATA = [
  'SET session_replication_role = replica;',
  'COPY "auth"."users" ("id") FROM stdin;',
  'u1',
  '\\.',
  'COPY "public"."posts" ("id") FROM stdin;',
  'p1',
  '\\.',
  'COPY "pgmq"."q_jobs" ("msg_id") FROM stdin;',
  '1',
  '\\.',
  "SELECT pg_catalog.setval('\"auth\".\"refresh_tokens_id_seq\"', 5, true);",
  "SELECT pg_catalog.setval('\"public\".\"posts_seq\"', 9, true);",
];

async function collect(gen) {
  const out = [];
  for await (const line of gen) out.push(line);
  return out;
}

test('restore check covers only schemas the schema dump defines', async () => {
  const m = buildManifest({
    target: 'dev', ref: 'r', sha: 's', at: 't',
    tables: await parseSchemaTables(SCHEMA),
    rows: await parseDataRows(MANAGED_DATA),
  });
  assert.deepEqual(m.userSchemas, ['public']);
  assert.deepEqual(restorableTables(m), ['"public"."posts"']);
  assert.equal(m.totalRows, 3, 'managed rows still count in the manifest');
  assert.deepEqual(compareCounts(m, '"public"."posts"\t1\n'), []);
  assert.doesNotMatch(countsSql(m), /auth|pgmq/);
});

test('split-data drops COPY blocks and setvals of managed schemas only', async () => {
  const kept = await collect(restorableData(MANAGED_DATA, ['public']));
  assert.deepEqual(kept, [
    'SET session_replication_role = replica;',
    'COPY "public"."posts" ("id") FROM stdin;',
    'p1',
    '\\.',
    "SELECT pg_catalog.setval('\"public\".\"posts_seq\"', 9, true);",
  ]);
});
