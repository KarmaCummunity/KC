#!/usr/bin/env node
// Removes monthly partition child tables from `supabase gen types` output.
//
// Time-partitioned tables (e.g. `feed_impressions`, migration 0347) get one child
// table per month, named `<parent>_yYYYYmMM`, created relative to now(): a fresh
// database holds the current and the next month. The generated types therefore
// change on the first of every month, and the committed database.types.ts would
// fail the CI drift check for every PR. The app only ever addresses the parent
// table, so the children are storage details and are dropped from the types.
//
// Usage: supabase gen types typescript --local | node scripts/strip-partition-types.mjs > out.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A generated table entry header, e.g. `      feed_impressions_y2026m11: {`.
const PARTITION_HEADER = /^(\s+)[a-z0-9_]+_y\d{4}m(0[1-9]|1[0-2]): \{$/;

/**
 * Returns `source` without the entries of monthly partition child tables.
 * An entry runs from its header line to the first line that closes it at the
 * header's own indentation, as `supabase gen types` formats them.
 * @param {string} source generated TypeScript
 * @returns {string}
 * @throws {Error} when an entry is never closed, so a format change fails loudly
 */
export function stripPartitionTypes(source) {
  const out = [];
  let closing = null; // closing line of the entry being skipped, or null
  for (const line of source.split('\n')) {
    if (closing !== null) {
      if (line === closing) closing = null;
      continue;
    }
    const header = PARTITION_HEADER.exec(line);
    if (header) {
      closing = `${header[1]}}`;
      continue;
    }
    out.push(line);
  }
  if (closing !== null) {
    throw new Error('strip-partition-types: a partition table entry is never closed; the generated format changed');
  }
  return out.join('\n');
}

// CLI: stdin → stdout.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(stripPartitionTypes(readFileSync(0, 'utf8')));
}
