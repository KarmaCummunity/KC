// app/apps/mobile/src/services/__tests__/pickAuthStorage.test.ts
//
// The Supabase client is a singleton whose first `storage` argument wins, so
// every composition root must pass the same secure adapter. These tests pin
// the platform choice of `pickAuthStorage()` and guard against any
// composition root reintroducing its own (possibly plaintext) picker.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const platform = vi.hoisted(() => ({ OS: 'ios' as string }));
const asyncStore = new Map<string, string>();
const secureStore = new Map<string, string>();

vi.mock('react-native', () => ({ Platform: platform }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncStore.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { asyncStore.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { asyncStore.delete(k); }),
  },
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (k: string) => secureStore.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => { secureStore.set(k, v); }),
  deleteItemAsync: vi.fn(async (k: string) => { secureStore.delete(k); }),
}));

import { pickAuthStorage } from '../authSecureStorage';

const SRC_ROOT = join(__dirname, '..', '..');

/** Recursively lists runtime `.ts` / `.tsx` files under `dir`, skipping tests. */
function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : listSourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

beforeEach(() => {
  asyncStore.clear();
  secureStore.clear();
  platform.OS = 'ios';
});

describe('pickAuthStorage', () => {
  it('persists session values in SecureStore on native, never in AsyncStorage', async () => {
    const storage = pickAuthStorage();
    expect(storage).toBeDefined();

    await storage!.setItem('sb-token', 'session');

    expect(secureStore.get('sb-token')).toBe('session');
    expect(asyncStore.has('sb-token')).toBe(false);
  });

  it('uses window.localStorage on web', () => {
    platform.OS = 'web';
    const localStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('window', { localStorage });

    expect(pickAuthStorage()).toBe(localStorage);

    vi.unstubAllGlobals();
  });

  it('returns undefined on web when localStorage is unavailable', () => {
    platform.OS = 'web';
    vi.stubGlobal('window', undefined);

    expect(pickAuthStorage()).toBeUndefined();

    vi.unstubAllGlobals();
  });
});

describe('composition roots', () => {
  it('pass pickAuthStorage() to getSupabaseClient and define no local storage picker', () => {
    const offenders = listSourceFiles(SRC_ROOT).filter((file) => {
      const source = readFileSync(file, 'utf8');
      const localPicker = /function\s+pick\w*Storage\s*\(/.test(source) && !file.endsWith('authSecureStorage.ts');
      const otherStorage = /getSupabaseClient\(\{\s*storage:\s*(?!\s|pickAuthStorage\(\))/.test(source);
      return localPicker || otherStorage;
    });

    expect(offenders.map((f) => relative(SRC_ROOT, f))).toEqual([]);
  });
});
