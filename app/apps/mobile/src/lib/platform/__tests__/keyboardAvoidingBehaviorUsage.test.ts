// FR-RESP-006 AC24 — one rule for `<KeyboardAvoidingView behavior>`. The app is edge-to-edge on Android,
// so a view with no behavior there leaves its bottom action under the keyboard (Maestro flow 19). Every
// screen takes the behavior from `resolveKeyboardAvoidingBehavior`, so the next one cannot repeat it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const MOBILE_ROOT = join(__dirname, '..', '..', '..', '..');

// Not covered by the rule, with the reason. A bottom sheet is a `Modal`, an Android window of its own,
// whose keyboard handling differs from the activity's and has not been checked on a device (#2139).
const EXCEPTIONS = new Set(['src/components/ui/BottomSheet.tsx']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

describe('KeyboardAvoidingView behavior', () => {
  const files = ['app', 'src'].flatMap((d) => sourceFiles(join(MOBILE_ROOT, d)));

  it('is resolved by resolveKeyboardAvoidingBehavior in every screen', () => {
    const offenders = files
      .map((path) => ({ file: relative(MOBILE_ROOT, path).split('\\').join('/'), text: readFileSync(path, 'utf8') }))
      .filter(({ file }) => !EXCEPTIONS.has(file))
      .filter(({ text }) => /behavior=\{(?!resolveKeyboardAvoidingBehavior\(Platform\.OS\)\})/.test(text) && /<KeyboardAvoidingView/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('still finds the screens it guards, so the scan cannot pass by finding nothing', () => {
    const guarded = files.filter((path) => readFileSync(path, 'utf8').includes('behavior={resolveKeyboardAvoidingBehavior(Platform.OS)}'));
    expect(guarded.length).toBeGreaterThanOrEqual(10);
  });
});
