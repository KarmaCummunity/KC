// A table with a column-level SELECT grant cannot be read with `select('*')` (or `select()`):
// PostgREST expands it to every column and the role is refused ("permission denied for table"),
// which showed up as a food post whose page said "error". The adapters must name the columns
// of those tables. The list of tables comes from the baseline schemas and from the forward-only
// migrations after it, so a table that gets a column grant later is covered without touching
// this test.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
/** `src/__tests__` → package → packages → app → repository. */
const SCHEMAS = join(HERE, '../../../../../supabase/schemas');
/** Forward-only migrations (`0002_…` onward); the baseline itself is generated from the schemas. */
const MIGRATIONS = join(HERE, '../../../../../supabase/migrations');

function files(dir: string, accept: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path, accept);
    return accept(name) ? [path] : [];
  });
}

function columnGrantedTables(): string[] {
  const tables = new Set<string>();
  const forwardMigrations = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name !== '0001_baseline.sql')
    .map((name) => join(MIGRATIONS, name));
  for (const file of [...files(SCHEMAS, (n) => n.endsWith('.sql')), ...forwardMigrations]) {
    for (const m of readFileSync(file, 'utf8').matchAll(/^grant select \([^)]*\)\s+on\s+public\.(\w+)/gim)) tables.add(m[1]!);
  }
  return [...tables].sort();
}

describe('tables with a column-level SELECT grant', () => {
  const tables = columnGrantedTables();

  it('the baseline has some (the scan finds them)', () => {
    expect(tables).toContain('post_food_details');
  });

  it.each(tables)('%s is never read with select(*) by an adapter', (table) => {
    const offenders: string[] = [];
    for (const file of files(SRC, (n) => n.endsWith('.ts') && !n.endsWith('.test.ts') && !n.startsWith('database'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(new RegExp(`from\\('${table}'\\)\\s*\\.select\\(\\s*(?:'\\*'|"\\*")?\\s*\\)`, 'g'))) {
        offenders.push(`${file.slice(SRC.length + 1)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
