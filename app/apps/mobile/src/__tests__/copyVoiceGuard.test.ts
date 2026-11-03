import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  COPY_RULES,
  KEY_SLOGAN,
  countCopyFindings,
  type CopyLocale,
  type CopyRule,
} from './guardKit/copyVoiceRules';
import { extractLocaleStrings } from './guardKit/localeStrings';
import {
  MOBILE_ROOT,
  compareToBaseline,
  readBaseline,
  touchedBaseRef,
  touchedFiles,
  writeBaseline,
  type Baseline,
} from './guardKit/ratchet';

// Copy-voice guard — spec 17 §7 "Voice and tone" (D93), FR-RESP-006 AC19/AC20.
//
// Every string in the locale bundles (`src/i18n/locales/{he,en}/**`) is checked
// against the voice rules in ./guardKit/copyVoiceRules.ts: no English product
// jargon, no singular gendered imperatives or address, no padded softeners,
// ktiv maleh, call-to-action length, and locked brand wording.
// Existing findings are frozen per file in `copy-voice.baseline.json`; counts
// may only go down. After a cleanup, tighten the baseline with:
//   KC_COPY_BASELINE=update pnpm --filter @kc/mobile test -- copyVoiceGuard
// A string whose closing line ends in `// copy-voice-allow: <reason>` is skipped
// (reviewed in PR). Touched-file rule (D67): every locale file the branch
// changes must be fully clean.

const LOCALES: readonly CopyLocale[] = ['he', 'en'];
const LOCALES_DIR = 'src/i18n/locales';
const BASELINE_PATH = path.join(MOBILE_ROOT, 'copy-voice.baseline.json');
const LOCALE_FILE = /^src\/i18n\/locales\/(he|en)\/.+\.ts$/;

function listLocaleFiles(relativeDir: string): string[] {
  return readdirSync(path.join(MOBILE_ROOT, relativeDir), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) return listLocaleFiles(relativePath);
    return entry.name.endsWith('.ts') ? [relativePath] : [];
  });
}

function localeOf(file: string): CopyLocale {
  return LOCALE_FILE.exec(file)?.[1] as CopyLocale;
}

function countFile(file: string) {
  return countCopyFindings(readFileSync(path.join(MOBILE_ROOT, file), 'utf8'), localeOf(file), file);
}

function scanLocales(): Baseline<CopyRule> {
  const result: Baseline<CopyRule> = {};
  const files = LOCALES.flatMap((locale) => listLocaleFiles(`${LOCALES_DIR}/${locale}`)).sort();
  for (const file of files) {
    const counts = countFile(file);
    if (Object.keys(counts).length > 0) result[file] = counts;
  }
  return result;
}

describe('copy-voice guard', () => {
  const current = scanLocales();

  if (process.env.KC_COPY_BASELINE === 'update') {
    it('rewrites copy-voice.baseline.json from the current locale bundles', () => {
      writeBaseline(
        BASELINE_PATH,
        'Frozen copy-voice findings per locale file (spec 17 §7, D93). Counts may only go down.',
        current,
      );
      expect(readBaseline(BASELINE_PATH)).toEqual(current);
    });
  } else {
    const { grew, shrank } = compareToBaseline(COPY_RULES, current, readBaseline<CopyRule>(BASELINE_PATH));

    it('adds no copy-voice finding beyond the frozen baseline', () => {
      expect(grew, 'follow spec 17 §7: neutral infinitive ("ללחוץ"), plain Hebrew, ≤4-word CTAs').toEqual([]);
    });

    it('keeps the baseline tight after cleanups (rerun with KC_COPY_BASELINE=update)', () => {
      expect(shrank).toEqual([]);
    });
  }

  it('scans both locale bundles', () => {
    const scanned = LOCALES.map((locale) => listLocaleFiles(`${LOCALES_DIR}/${locale}`).length);
    expect(scanned.every((files) => files > 10)).toBe(true);
  });
});

describe('copy-voice touched-file rule (spec 17 §7, D67)', () => {
  const baseRef = touchedBaseRef();
  const touched = touchedFiles(baseRef, (file) => LOCALE_FILE.test(file));

  if (touched === null) {
    // Same contract as the brand guard: CI must resolve the base; a local clone without it skips.
    it(`resolves the base ref ${baseRef} in CI`, () => {
      expect(process.env.CI, `cannot resolve ${baseRef} — fetch it before running the guard`).toBeFalsy();
    });
  } else {
    it(`leaves every locale file changed since ${baseRef} with zero findings`, () => {
      const dirty = touched.flatMap((file) => {
        const counts = countFile(file);
        return Object.keys(counts).length > 0 ? [`${file}: ${JSON.stringify(counts)}`] : [];
      });
      expect(dirty, 'a locale file you change must follow the voice rules in full, not only your lines').toEqual([]);
    });
  }
});

describe('key slogan (master narrative §16.1)', () => {
  it('ships the key brand line verbatim in the Hebrew bundle', () => {
    const hebrew = listLocaleFiles(`${LOCALES_DIR}/he`).flatMap((file) =>
      extractLocaleStrings(readFileSync(path.join(MOBILE_ROOT, file), 'utf8')),
    );
    expect(hebrew.some((entry) => entry.text === `${KEY_SLOGAN}.`)).toBe(true);
  });
});
