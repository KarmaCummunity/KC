// NFR-PERF-005 — `date-fns/locale` is a barrel over ~90 locales. Metro does not tree-shake it, so a
// single `import { he } from 'date-fns/locale'` ships every locale (about 1 MB of source) in the
// bundle. Each locale must be imported from its own module (`date-fns/locale/he`).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = [join(__dirname, '..'), join(__dirname, '..', '..', 'app')];
const BARREL_IMPORT = /from\s+['"]date-fns\/locale['"]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !path.includes('__tests__') ? [path] : [];
  });
}

describe('date-fns locale imports', () => {
  it('never use the all-locales barrel', () => {
    const offenders = ROOTS.flatMap(sourceFiles).filter((file) => BARREL_IMPORT.test(readFileSync(file, 'utf8')));
    expect(offenders, 'import each locale from date-fns/locale/<code>').toEqual([]);
  });
});
