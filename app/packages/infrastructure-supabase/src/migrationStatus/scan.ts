/**
 * Finds the application files that still address the pre-baseline database
 * (docs/db/app-migration-playbook.md). Used only by `baselineCompatibility.test.ts`.
 *
 * A file is "unmigrated" when at least one of these holds:
 *  - it reaches the frozen legacy view: imports `database.legacy.types`, or uses
 *    `getLegacySupabaseClient`, `legacySupabase` or `LegacyDatabase`;
 *  - `docs/db/app-usage-inventory.json` records a call in it to an object the baseline does not
 *    provide: an RPC missing from `Functions`, a table missing from `Tables` / `Views`, or a
 *    bucket, channel, Edge Function or postgres_changes subscription whose row in
 *    `docs/db/app-migration-map.json` is not `same`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type InventoryEntry = { kind: string; file: string; line: number; name?: string };
export type MapRow = { kind: string; old: string; status: string };
export type Offender = { readonly file: string; readonly reasons: readonly string[] };

/** Names the baseline types declare under `public`, by kind. */
export type BaselineObjects = { readonly rpc: ReadonlySet<string>; readonly table: ReadonlySet<string> };

const SECTION = /^ {4}(Tables|Views|Functions|Enums|CompositeTypes): \{/;
const NAME = /^ {6}([A-Za-z0-9_]+): /;
const LEGACY_REFERENCE = /database\.legacy\.types|getLegacySupabaseClient|\blegacySupabase\b|\bLegacyDatabase\b/;
/**
 * The legacy view is removed (every package moved), so only this file, which names the
 * pattern, is exempt: any other legacy reference is reported as an unmigrated file.
 */
const LEGACY_VIEW_DEFINITIONS: readonly string[] = [
  'packages/infrastructure-supabase/src/migrationStatus/scan.ts',
];
/** Test files of the migration machinery itself. */
const MACHINERY_TESTS = /(baselineCompatibility|degradeRule)\.test\.ts$/;

/** Reads the object names of the first (`public`) schema of a generated types file. */
export function readBaselineObjects(typesSource: string): BaselineObjects {
  const rpc = new Set<string>();
  const table = new Set<string>();
  let section = '';
  for (const line of typesSource.split('\n')) {
    const heading = SECTION.exec(line);
    if (heading) {
      section = heading[1] ?? '';
      if (section === 'Enums') break;
      continue;
    }
    const name = NAME.exec(line)?.[1];
    if (!name) continue;
    if (section === 'Functions') rpc.add(name);
    if (section === 'Tables' || section === 'Views') table.add(name);
  }
  return { rpc, table };
}

function listSources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listSources(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) ? [full] : [];
  });
}

/** Every application source file the scan covers, relative to `app/` with `/` separators. */
export function listAppSources(appRoot: string): string[] {
  const roots = ['packages/infrastructure-supabase/src', 'apps/mobile/src', 'apps/mobile/app'];
  return roots
    .flatMap((root) => listSources(path.join(appRoot, root)))
    .map((full) => path.relative(appRoot, full).split(path.sep).join('/'));
}

function entryProblem(entry: InventoryEntry, provided: BaselineObjects, rows: readonly MapRow[]): string | null {
  const name = entry.name ?? '';
  if (entry.kind === 'rpc') return provided.rpc.has(name) ? null : `rpc:${name}`;
  if (entry.kind === 'table') return provided.table.has(name) ? null : `table:${name}`;
  const row = rows.find((candidate) => candidate.kind === entry.kind && candidate.old === name);
  return row?.status === 'same' ? null : `${entry.kind}:${name}`;
}

/** Unmigrated files among `sources` (paths relative to `app/`), each with the reasons. */
export function findUnmigrated(
  appRoot: string,
  sources: readonly string[],
  inventory: readonly InventoryEntry[],
  provided: BaselineObjects,
  rows: readonly MapRow[],
): Offender[] {
  const reasons = new Map<string, Set<string>>();
  const add = (file: string, reason: string): void => {
    reasons.set(file, (reasons.get(file) ?? new Set()).add(reason));
  };
  const covered = new Set(sources);
  for (const entry of inventory) {
    const file = entry.file.replace(/^app\//, '');
    if (!covered.has(file) || MACHINERY_TESTS.test(file)) continue;
    const problem = entryProblem(entry, provided, rows);
    if (problem) add(file, problem);
  }
  for (const file of sources) {
    if (LEGACY_VIEW_DEFINITIONS.includes(file) || MACHINERY_TESTS.test(file)) continue;
    if (LEGACY_REFERENCE.test(fs.readFileSync(path.join(appRoot, file), 'utf8'))) add(file, 'legacy view');
  }
  return [...reasons.entries()]
    .map(([file, set]) => ({ file, reasons: [...set].sort() }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
