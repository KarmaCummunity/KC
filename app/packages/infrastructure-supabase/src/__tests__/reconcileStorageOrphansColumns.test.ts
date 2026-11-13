import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The reconcile-storage-orphans Edge Function lives in Deno-land (no vitest runtime), so its
// database contract is verified by reading the source as text. On the baseline it no longer
// reads a table: it asks `kc_private.storage_orphan_keys(bucket, keys)` (95_platform), which
// knows every column that references a storage object. A reference to the old
// `media_assets` / `storage_path` pair would turn every uploaded image into a false orphan,
// which the daily job then deletes.
const here = dirname(fileURLToPath(import.meta.url));
const FN_DIR = resolve(here, '../../../../../supabase/functions/reconcile-storage-orphans');
const SRC = ['handler.ts', 'index.ts'].map((name) => readFileSync(resolve(FN_DIR, name), 'utf8')).join('\n');

describe('reconcile-storage-orphans Edge Function — baseline contract', () => {
  it('resolves orphans through kc_private.storage_orphan_keys, never the old media_assets columns', () => {
    expect(SRC).toMatch(/kc_private\.storage_orphan_keys\(/);
    expect(SRC).not.toMatch(/storage_path/);
    expect(SRC).not.toMatch(/\.from\(['"]media_assets['"]\)/);
  });
});
