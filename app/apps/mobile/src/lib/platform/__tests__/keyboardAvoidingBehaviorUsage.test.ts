// FR-RESP-006 AC24 — one rule for `<KeyboardAvoidingView behavior>`. The app is edge-to-edge on Android,
// so a view with no behavior there leaves its bottom action under the keyboard (Maestro flow 19). Every
// screen — including the kit BottomSheet Modal (#2139) — takes the behavior from
// `resolveKeyboardAvoidingBehavior`, so the next one cannot repeat it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const MOBILE_ROOT = join(__dirname, '..', '..', '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

/** Tag open of a KeyboardAvoidingView, including multiline props before `>`. */
const KAV_OPEN = /<KeyboardAvoidingView\b[^>]*>/gs;
const RESOLVED_BEHAVIOR = /behavior=\{resolveKeyboardAvoidingBehavior\(Platform\.OS\)\}/;

describe('KeyboardAvoidingView behavior', () => {
  const files = ['app', 'src'].flatMap((d) => sourceFiles(join(MOBILE_ROOT, d)));

  it('sets behavior via resolveKeyboardAvoidingBehavior on every KeyboardAvoidingView', () => {
    const offenders: string[] = [];
    for (const path of files) {
      const file = relative(MOBILE_ROOT, path).split('\\').join('/');
      const text = readFileSync(path, 'utf8');
      const opens = text.match(KAV_OPEN) ?? [];
      for (const open of opens) {
        if (!RESOLVED_BEHAVIOR.test(open)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('still finds the screens it guards, so the scan cannot pass by finding nothing', () => {
    const guarded = files.filter((path) =>
      readFileSync(path, 'utf8').includes('behavior={resolveKeyboardAvoidingBehavior(Platform.OS)}'),
    );
    expect(guarded.length).toBeGreaterThanOrEqual(11);
  });
});
