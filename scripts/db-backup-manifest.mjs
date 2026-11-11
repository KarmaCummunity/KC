#!/usr/bin/env node
// Helpers of the scheduled database backup (.github/actions/db-backup).
//
//   analyze   read the plaintext schema + data dumps of `supabase db dump`,
//             count tables and rows, write manifest.json, print a summary
//   counts-sql  print the SQL that counts the rows of every table in the manifest
//   verify    compare those counts, taken on a database the dump was restored
//             into, with the manifest (a restore that lost a row fails)
//
// The dump text is the only input. Table and row counts are the whole
// "is this backup sane" signal, so an empty database (no tables yet, e.g. a
// project before its baseline) is a named state, `empty`, and not an error.

import { createReadStream, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const CREATE_TABLE = /^CREATE TABLE (?:IF NOT EXISTS )?("[^"]+"\."[^"]+") \(/;
const COPY_BLOCK = /^COPY ("[^"]+"\."[^"]+") /;
const QUALIFIED = /^"[^"]+"\."[^"]+"$/;

/** Tables defined by a `supabase db dump` schema file, sorted. */
export async function parseSchemaTables(lines) {
  const tables = new Set();
  for await (const line of lines) {
    const m = CREATE_TABLE.exec(line);
    if (m) tables.add(m[1]);
  }
  return [...tables].sort();
}

/** Rows per table of a `--data-only --use-copy` dump (rows = lines of each COPY block). */
export async function parseDataRows(lines) {
  const rows = {};
  let current = null;
  for await (const line of lines) {
    if (current === null) {
      const m = COPY_BLOCK.exec(line);
      if (m) {
        current = m[1];
        rows[current] ??= 0;
      }
    } else if (line === '\\.') {
      current = null;
    } else {
      rows[current] += 1;
    }
  }
  return rows;
}

export function buildManifest({ target, ref, sha, tables, rows, at }) {
  const rowTables = Object.keys(rows).sort();
  const total = rowTables.reduce((sum, t) => sum + rows[t], 0);
  return {
    target,
    ref,
    sha,
    at,
    empty: tables.length === 0,
    tables,
    rows,
    tableCount: tables.length,
    totalRows: total,
  };
}

/** SQL printing `<table>\t<count>` for every table with data in the manifest. */
export function countsSql(manifest) {
  const names = Object.keys(manifest.rows).sort();
  for (const name of names) {
    if (!QUALIFIED.test(name)) throw new Error(`unexpected table name in manifest: ${name}`);
  }
  if (names.length === 0) return 'select 1 where false;\n';
  const parts = names.map((n) => `select '${n.replaceAll("'", "''")}' as t, count(*)::bigint as c from ${n}`);
  return `${parts.join('\nunion all\n')}\norder by 1;\n`;
}

/** Differences between the manifest and restored counts (`<table>\t<count>` lines). */
export function compareCounts(manifest, countsText) {
  const restored = {};
  for (const line of countsText.split('\n')) {
    if (!line.trim()) continue;
    const [name, count] = line.split('\t');
    restored[name] = Number(count);
  }
  const problems = [];
  for (const [name, expected] of Object.entries(manifest.rows)) {
    if (!(name in restored)) problems.push(`${name}: not restored (expected ${expected} rows)`);
    else if (restored[name] !== expected) problems.push(`${name}: restored ${restored[name]} rows, dump has ${expected}`);
  }
  return problems;
}

const lines = (file) => createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });

function arg(argv, name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) {
    if (fallback === undefined) throw new Error(`missing --${name}`);
    return fallback;
  }
  return argv[i + 1];
}

async function main(argv) {
  const [cmd] = argv;
  if (cmd === 'analyze') {
    const tables = await parseSchemaTables(lines(arg(argv, 'schema')));
    const rows = await parseDataRows(lines(arg(argv, 'data')));
    const manifest = buildManifest({
      target: arg(argv, 'target'),
      ref: arg(argv, 'ref'),
      sha: arg(argv, 'sha', ''),
      tables,
      rows,
      at: new Date().toISOString(),
    });
    writeFileSync(arg(argv, 'out'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const summary = `tables=${manifest.tableCount} rows=${manifest.totalRows} empty=${manifest.empty}`;
    console.log(summary);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${summary.split(' ').join('\n')}\n`);
    return 0;
  }
  if (cmd === 'counts-sql') {
    process.stdout.write(countsSql(JSON.parse(readFileSync(arg(argv, 'manifest'), 'utf8'))));
    return 0;
  }
  if (cmd === 'verify') {
    const manifest = JSON.parse(readFileSync(arg(argv, 'manifest'), 'utf8'));
    const problems = compareCounts(manifest, readFileSync(arg(argv, 'counts'), 'utf8'));
    if (problems.length) {
      for (const p of problems) console.error(`::error::restore check: ${p}`);
      return 1;
    }
    console.log(`restore check ok: ${Object.keys(manifest.rows).length} tables with data, ${manifest.totalRows} rows`);
    return 0;
  }
  console.error('usage: db-backup-manifest.mjs analyze|counts-sql|verify ...');
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
