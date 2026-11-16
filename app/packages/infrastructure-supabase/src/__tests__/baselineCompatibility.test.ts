/**
 * Compatibility inventory: no application file may address an object the baseline does not
 * provide unless `src/migrationStatus/<package>.ts` lists it under the package that will
 * migrate it. Each package removes its entries; this test proves the removal was right (the
 * file is clean) and complete (nothing else still needs the legacy view).
 *
 * Inputs: `docs/db/app-usage-inventory.json` (call sites), `docs/db/app-migration-map.json`
 * (status of buckets, channels, Edge Functions), `database.types.ts` (the baseline types).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIGRATION_STATUS, PACKAGE_IDS } from '../migrationStatus';
import {
  DEV_SEED_RPCS, findUnmigrated, listAppSources, readBaselineObjects, type InventoryEntry, type MapRow, type Offender,
} from '../migrationStatus/scan';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `src/__tests__` → package → packages → app. */
const APP_ROOT = path.resolve(HERE, '../../../..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');

const readJson = <T>(relative: string): T =>
  JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8')) as T;

const inventory = readJson<{ entries: InventoryEntry[] }>('docs/db/app-usage-inventory.json').entries;
const mapRows = readJson<{ rows: MapRow[] }>('docs/db/app-migration-map.json').rows;
const baseline = readBaselineObjects(
  fs.readFileSync(path.join(APP_ROOT, 'packages/infrastructure-supabase/src/database.types.ts'), 'utf8'),
);
const sources = listAppSources(APP_ROOT);
const unmigrated: Offender[] = findUnmigrated(APP_ROOT, sources, inventory, baseline, mapRows);

const listed = new Map<string, string>();
for (const id of PACKAGE_IDS) for (const file of MIGRATION_STATUS[id]) listed.set(file, id);

const describeOffender = (offender: Offender): string => `${offender.file}  [${offender.reasons.join(', ')}]`;

describe('baseline compatibility inventory', () => {
  it('reads the baseline types it compares against', () => {
    for (const name of ['bootstrap_session', 'feed_page', 'follow_user']) expect(baseline.rpc.has(name)).toBe(true);
    for (const name of ['users', 'posts', 'post_handoffs', 'app_flags']) expect(baseline.table.has(name)).toBe(true);
    expect(baseline.table.has('follow_edges')).toBe(false);
  });

  it('every file that needs the legacy view or an old object is listed with its package', () => {
    const missing = unmigrated.filter((offender) => !listed.has(offender.file));
    expect(missing.map(describeOffender)).toEqual([]);
  });

  it('every listed file still needs its entry (a migrated file is removed from the list)', () => {
    const needed = new Set(unmigrated.map((offender) => offender.file));
    const stale = [...listed].filter(([file]) => !needed.has(file)).map(([file, id]) => `${id}: ${file}`);
    expect(stale).toEqual([]);
  });

  it('lists only files that exist, once, under a known package', () => {
    const everything = PACKAGE_IDS.flatMap((id) => MIGRATION_STATUS[id].map((file) => ({ id, file })));
    expect(everything.filter(({ file }) => !fs.existsSync(path.join(APP_ROOT, file))).map(({ file }) => file)).toEqual([]);
    expect(new Set(everything.map(({ file }) => file)).size).toBe(everything.length);
    expect(Object.keys(MIGRATION_STATUS).sort()).toEqual([...PACKAGE_IDS].sort());
  });

  it('every dev-only seed RPC the scan accepts is declared by the demo-data seed (FR-ADMIN-031)', () => {
    const seedDir = path.join(REPO_ROOT, 'supabase/seed/demo/lib');
    const seedSql = fs.readdirSync(seedDir).map((file) => fs.readFileSync(path.join(seedDir, file), 'utf8')).join('\n');
    const undeclared = [...DEV_SEED_RPCS].filter((name) => !seedSql.includes(`function public.${name}(`));
    expect(undeclared).toEqual([]);
    // Never a baseline object: a migrated RPC must leave this list.
    expect([...DEV_SEED_RPCS].filter((name) => baseline.rpc.has(name))).toEqual([]);
  });

  it('the frozen legacy types go away with the last entry', () => {
    const legacyTypes = path.join(APP_ROOT, 'packages/infrastructure-supabase/src/database.legacy.types.ts');
    if (listed.size === 0) expect(fs.existsSync(legacyTypes)).toBe(false);
    else expect(fs.existsSync(legacyTypes)).toBe(true);
  });
});
