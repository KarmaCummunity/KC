import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOBILE_ROOT } from './guardKit/ratchet';

// FR-SETTINGS-018 (#1749): text direction comes from the helpers, never a literal. Translated UI
// strings follow the active language (`rtlLayout.ts`); Hebrew-only content stays RTL through
// `hebrewContentDirection.ts`. A hardcoded `writingDirection: 'rtl'` renders English UI RTL.

const SCANNED_DIRS = ['src', 'app'] as const;
const DIRECTION_HELPERS = new Set(['src/lib/rtlLayout.ts', 'src/lib/hebrewContentDirection.ts']);
const HARDCODED_RTL = /writingDirection:\s*['"]rtl['"]/;

function listSources(relativeDir: string): string[] {
  return readdirSync(path.join(MOBILE_ROOT, relativeDir), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listSources(relativePath);
    return /\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) ? [relativePath] : [];
  });
}

function findHardcodedRtl(): string[] {
  return SCANNED_DIRS.flatMap(listSources)
    .filter((file) => !DIRECTION_HELPERS.has(file))
    .flatMap((file) =>
      readFileSync(path.join(MOBILE_ROOT, file), 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          HARDCODED_RTL.test(line) && !line.trimStart().startsWith('//') ? [`${file}:${index + 1}`] : [],
        ),
    );
}

describe('writing-direction guard (FR-SETTINGS-018)', () => {
  it('has no hardcoded RTL writing direction outside the direction helpers', () => {
    expect(findHardcodedRtl()).toEqual([]);
  });
});
