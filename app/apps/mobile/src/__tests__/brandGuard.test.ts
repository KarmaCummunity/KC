import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { brand, lightColors } from '@kc/ui';
// eslint-disable-next-line no-restricted-imports -- test asserts both bundles' appName match the brand constants
import en from '../i18n/locales/en';
// eslint-disable-next-line no-restricted-imports -- test asserts both bundles' appName match the brand constants
import he from '../i18n/locales/he';
import { countLiterals, RULE_NAMES, type RuleName } from './brandGuardRules';
import {
  MOBILE_ROOT,
  compareToBaseline,
  readBaseline as readBaselineFile,
  touchedBaseRef,
  touchedFiles,
  writeBaseline as writeBaselineFile,
  type Baseline as RatchetBaseline,
} from './guardKit/ratchet';

// Brand guard — spec 17 §4/§6 (D65, D67, D87), debt TD-199.
//
// App code must take colours, type (size, weight, family), corner radii,
// spacing, icon sizes, layers and shadows from @kc/ui tokens, use logical sides
// (start/end) so layouts mirror between Hebrew (RTL) and English (LTR), and
// build forms and dialogs from the shared kit. The rules live in
// `brandGuardRules.ts`.
// Existing literals are frozen per file in `brand-guard.baseline.json`; counts
// may only go down. After a cleanup, tighten the baseline with:
//   KC_BRAND_BASELINE=update pnpm --filter @kc/mobile test -- brandGuard
// A line ending in `brand-guard-allow: <reason>` is skipped (reviewed in PR).
// Touched-file rule (D67): every scanned file the branch changes must be fully
// clean, whatever its frozen count.

const SCANNED_DIRS = ['src', 'app'] as const;
const BASELINE_PATH = path.join(MOBILE_ROOT, 'brand-guard.baseline.json');

type Baseline = RatchetBaseline<RuleName>;

function isScannedSource(fileName: string): boolean {
  return /\.tsx?$/.test(fileName) && !/\.(test|d)\.tsx?$/.test(fileName);
}

function listSources(relativeDir: string): string[] {
  return readdirSync(path.join(MOBILE_ROOT, relativeDir), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listSources(relativePath);
    return isScannedSource(entry.name) ? [relativePath] : [];
  });
}

function scanApp(): Baseline {
  const result: Baseline = {};
  for (const file of SCANNED_DIRS.flatMap(listSources).sort()) {
    const counts = countLiterals(readFileSync(path.join(MOBILE_ROOT, file), 'utf8'), file);
    if (Object.keys(counts).length > 0) result[file] = counts;
  }
  return result;
}

function readBaseline(): Baseline {
  return readBaselineFile<RuleName>(BASELINE_PATH);
}

function writeBaseline(files: Baseline): void {
  writeBaselineFile(
    BASELINE_PATH,
    'Frozen brand-guard findings per file (spec 17 §6, TD-199). Counts may only go down.',
    files,
  );
}

/** Scanned sources (mobile-relative) changed since the merge-base with `baseRef`; null when unresolvable. */
function touchedSources(baseRef: string): string[] | null {
  return touchedFiles(
    baseRef,
    (file) =>
      SCANNED_DIRS.some((dir) => file.startsWith(`${dir}/`)) &&
      !file.includes('/__tests__/') &&
      isScannedSource(path.posix.basename(file)),
  );
}

describe('brand guard', () => {
  const current = scanApp();

  if (process.env.KC_BRAND_BASELINE === 'update') {
    it('rewrites brand-guard.baseline.json from the current code', () => {
      writeBaseline(current);
      expect(readBaseline()).toEqual(current);
    });
    return;
  }

  const { grew, shrank } = compareToBaseline(RULE_NAMES, current, readBaseline());

  it('adds no hard-coded style literal or physical side beyond the frozen baseline', () => {
    expect(
      grew,
      'use @kc/ui tokens (useTheme / typography / radius / spacing / iconSize / zIndex / shadow), start/end sides and the kit components',
    ).toEqual([]);
  });

  it('keeps the baseline tight after cleanups (rerun with KC_BRAND_BASELINE=update)', () => {
    expect(shrank).toEqual([]);
  });

  it('keeps admin surfaces completely free of brand-guard findings (spec 17 §4.3, issue #1287)', () => {
    const adminFindings = Object.entries(current)
      .filter(([file]) => file.startsWith('app/(admin)/') || file.startsWith('src/components/admin/'))
      .map(([file, counts]) => `${file}: ${JSON.stringify(counts)}`);
    expect(
      adminFindings,
      'admin surfaces must remain 100% on tokens — no findings permitted even in the baseline',
    ).toEqual([]);
  });
});

describe('touched-file rule (spec 17 §6, D67)', () => {
  const baseRef = touchedBaseRef();
  const touched = touchedSources(baseRef);

  if (touched === null) {
    // CI must always resolve the base (checkout with fetch-depth: 0); a local
    // clone without the ref only skips this rule.
    it(`resolves the base ref ${baseRef} in CI`, () => {
      expect(process.env.CI, `cannot resolve ${baseRef} — fetch it before running the guard`).toBeFalsy();
    });
    return;
  }

  it(`leaves every file changed since ${baseRef} with zero findings`, () => {
    const dirty = touched.flatMap((file) => {
      const counts = countLiterals(readFileSync(path.join(MOBILE_ROOT, file), 'utf8'), file);
      return Object.keys(counts).length > 0 ? [`${file}: ${JSON.stringify(counts)}`] : [];
    });
    expect(dirty, 'a file you change must be fully on tokens — fix the whole file, not only your lines').toEqual([]);
  });
});

describe('brand identity in the shipped app', () => {
  const appJson = JSON.parse(readFileSync(path.join(MOBILE_ROOT, 'app.json'), 'utf8')) as {
    expo: {
      name: string;
      userInterfaceStyle: string;
      splash: { backgroundColor: string };
      android: { adaptiveIcon: { backgroundColor: string } };
      web: { themeColor: string; backgroundColor: string; favicon: string };
      plugins: unknown[];
    };
  };
  /** The `[name, options]` plugin entry, or undefined. */
  const pluginOptions = <T,>(name: string): T | undefined =>
    (appJson.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === name) as [string, T] | undefined)?.[1];

  it('uses the English brand name in the English bundle', () => {
    expect(en.appName).toBe(`${brand.shortName} - ${brand.name}`);
  });

  it('ships the store name from the Hebrew bundle, prefixed with the nickname', () => {
    expect(he.appName.startsWith(`${brand.shortName} - `)).toBe(true);
    expect(appJson.expo.name).toBe(he.appName);
  });

  // Config files cannot import tokens, so these copies of the decoration orange are pinned here.
  it('keeps browser chrome and notification colours on the primaryVivid token', () => {
    const notificationPlugin = pluginOptions<{ color: string }>('expo-notifications');
    const htmlHead = readFileSync(path.join(MOBILE_ROOT, 'app/+html.tsx'), 'utf8');
    expect(appJson.expo.web.themeColor).toBe(lightColors.primaryVivid);
    expect(notificationPlugin?.color).toBe(lightColors.primaryVivid);
    expect(htmlHead).toContain(`name="theme-color" content="${lightColors.primaryVivid}"`);
  });

  // Spec 17 §2 (#1290): the logo lands on the cream the app opens with, not on white.
  it('sits the splash, adaptive icon and web page on the light background token', () => {
    const splashPlugin = pluginOptions<{ backgroundColor: string }>('expo-splash-screen');
    expect(appJson.expo.splash.backgroundColor).toBe(lightColors.background);
    expect(splashPlugin?.backgroundColor).toBe(lightColors.background);
    expect(appJson.expo.android.adaptiveIcon.backgroundColor).toBe(lightColors.background);
    expect(appJson.expo.web.backgroundColor).toBe(lightColors.background);
  });

  // Spec 17 §2: the favicon is the derived asset, not the full-size store icon.
  it('points the web favicon at the derived favicon asset', () => {
    expect(appJson.expo.web.favicon).toBe('./assets/favicon.png');
    expect(existsSync(path.join(MOBILE_ROOT, 'assets/favicon.png'))).toBe(true);
  });

  // FR-SETTINGS-014: a forced "light" style made the OS report light forever, so
  // the "system" appearance never resolved to dark on native.
  it('lets the OS colour scheme through so the "system" appearance can turn dark', () => {
    const packageJson = JSON.parse(readFileSync(path.join(MOBILE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(appJson.expo.userInterfaceStyle).toBe('automatic');
    // Android applies `automatic` only through expo-system-ui.
    expect(packageJson.dependencies).toHaveProperty('expo-system-ui');
  });
});
