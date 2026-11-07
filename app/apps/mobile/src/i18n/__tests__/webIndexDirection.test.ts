// FR-SETTINGS-018 (#1749): the web template applies the stored language's direction before the
// bundle runs, because style modules resolve `rtlTextAlignStart` from `dir` at load time.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getInitialLanguage } from '../language';

const INDEX_HTML = path.resolve(__dirname, '../../../public/index.html');

function directionScript(): string {
  const scripts = [...readFileSync(INDEX_HTML, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const match = scripts.find((s) => s[1].includes('localStorage'));
  if (!match) throw new Error('public/index.html has no inline direction script');
  return match[1];
}

function storageWith(value: string | null) {
  return { getItem: () => value, setItem: () => {} };
}

function runWithStored(value: string | null) {
  const documentElement = { dir: 'rtl', lang: 'he' };
  runInNewContext(directionScript(), { document: { documentElement }, localStorage: storageWith(value) });
  return documentElement;
}

describe('web index direction bootstrap (FR-SETTINGS-018)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('switches the document to LTR when English is stored', () => {
    expect(runWithStored('en')).toEqual({ dir: 'ltr', lang: 'en' });
  });

  it('keeps the Hebrew RTL default otherwise', () => {
    expect(runWithStored('he')).toEqual({ dir: 'rtl', lang: 'he' });
    expect(runWithStored(null)).toEqual({ dir: 'rtl', lang: 'he' });
  });

  it('keeps the default when storage is unavailable', () => {
    const documentElement = { dir: 'rtl', lang: 'he' };
    const localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => runInNewContext(directionScript(), { document: { documentElement }, localStorage })).not.toThrow();
    expect(documentElement.dir).toBe('rtl');
  });

  it('reads the same storage key as the app language helpers', () => {
    const keys: string[] = [];
    const recordingStorage = {
      getItem: (key: string) => {
        keys.push(key);
        return 'en';
      },
    };
    runInNewContext(directionScript(), { document: { documentElement: {} }, localStorage: recordingStorage });
    vi.stubGlobal('localStorage', recordingStorage);
    expect(getInitialLanguage()).toBe('en');
    expect(new Set(keys).size).toBe(1);
  });
});
