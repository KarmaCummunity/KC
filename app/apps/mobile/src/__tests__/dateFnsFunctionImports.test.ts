// NFR-PERF-005 / #2259: Metro retains the runtime exports of the date-fns root
// barrel. Import functions from their public subpaths; type-only imports are erased.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = [join(__dirname, '..'), join(__dirname, '..', '..', 'app')];
const RUNTIME_BARREL = /import\s+(?!type\b)(?:[^;'"\n]|\n)*?\sfrom\s+['"]date-fns['"]/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ['node_modules', '__tests__', '__mocks__'].includes(entry.name) ? [] : sourceFiles(path);
    return /\.[jt]sx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [path] : [];
  });
}

describe('date-fns function imports', () => {
  it('uses public function subpaths instead of the runtime root barrel', () => {
    const offenders = ROOTS.flatMap(sourceFiles).filter((file) => {
      RUNTIME_BARREL.lastIndex = 0;
      return RUNTIME_BARREL.test(readFileSync(file, 'utf8'));
    });
    expect(offenders, 'use date-fns/<function>; import type from date-fns is safe').toEqual([]);
  });
});
