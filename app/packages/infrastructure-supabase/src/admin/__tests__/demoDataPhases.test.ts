// Mapped to spec: FR-ADMIN-031 AC11 — the restore is stepped, and the screen labels each phase
// by its key. The phase list has two copies: the server's (kc_private.demo_phases in the
// dev-only seed) and the app's (DEMO_DATA_SEED_PHASES, which bounds the step loop and names the
// progress labels). This test reads the SQL and fails when one copy gains a phase the other
// lacks, so a new phase cannot ship without its label.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_DATA_SEED_PHASES } from '@kc/domain';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `src/admin/__tests__` → package → packages → app → repository root. */
const REPO_ROOT = path.resolve(HERE, '../../../../../..');
const OPERATIONS_SQL = path.join(REPO_ROOT, 'supabase/seed/demo/lib/70_operations.sql');

/** The phases of `operation` as kc_private.demo_phases lists them: `when '<op>' then array[...]`. */
function serverPhases(operation: 'seed' | 'wipe'): string[] {
  const sql = fs.readFileSync(OPERATIONS_SQL, 'utf8');
  const list = new RegExp(`when '${operation}' then array\\[([^\\]]+)\\]`).exec(sql)?.[1];
  if (!list) throw new Error(`demo_phases('${operation}') not found in 70_operations.sql`);
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? '');
}

describe('demo data phases (FR-ADMIN-031 AC11)', () => {
  it('the app lists the restore phases exactly as the server runs them', () => {
    expect(serverPhases('seed')).toEqual([...DEMO_DATA_SEED_PHASES]);
  });

  it('a wipe is the leading phases of a restore, so a restore always starts clean', () => {
    const wipe = serverPhases('wipe');
    expect(wipe.length).toBeGreaterThan(0);
    expect(DEMO_DATA_SEED_PHASES.slice(0, wipe.length)).toEqual(wipe);
  });
});
