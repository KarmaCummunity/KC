// app/apps/mobile/src/services/authSecureStorage.ts
//
// TD-101 (audit 2026-05-16, BACKLOG P2.14): Supabase session tokens were
// persisted in plaintext AsyncStorage. expo-secure-store routes through
// iOS Keychain / Android Keystore. On first read we fall through to
// AsyncStorage for the existing key so signed-in users don't get
// logged out by the swap; the migrated value is written to SecureStore
// and the AsyncStorage copy is deleted in the same call.
//
// Web is unaffected: web uses window.localStorage (see pickAuthStorage
// below) — SecureStore is iOS/Android only.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { SupabaseAuthStorage } from '@kc/infrastructure-supabase';

export function createAuthSecureStorage(): SupabaseAuthStorage {
  return {
    async getItem(key: string): Promise<string | null> {
      const secure = await SecureStore.getItemAsync(key);
      if (secure !== null) return secure;

      // One-time migration path. The first read of a pre-existing
      // AsyncStorage value warms SecureStore and clears the plaintext copy.
      const legacy = await AsyncStorage.getItem(key);
      if (legacy === null) return null;

      await SecureStore.setItemAsync(key, legacy);
      await AsyncStorage.removeItem(key);
      return legacy;
    },

    async setItem(key: string, value: string): Promise<void> {
      await SecureStore.setItemAsync(key, value);
    },

    async removeItem(key: string): Promise<void> {
      await SecureStore.deleteItemAsync(key);
      // Defensive: clear any half-migrated AsyncStorage copy too.
      await AsyncStorage.removeItem(key);
    },
  };
}

/**
 * The single auth-storage choice for every `getSupabaseClient({ storage })`
 * call. The Supabase client is a process-wide singleton and the first
 * caller's `storage` wins, so every composition root must pass the same
 * adapter:
 * - Web: `window.localStorage` (async-compatible sync methods). Without it a
 *   refresh of the web app drops the session (FR-AUTH-013).
 * - Native: the SecureStore-backed adapter (Keychain / Keystore, TD-101),
 *   which migrates a legacy AsyncStorage session on first read so signed-in
 *   users are not logged out.
 * Never pass plain AsyncStorage here — it would persist session tokens
 * unencrypted if that composition root happened to load first. Enforced by
 * `__tests__/pickAuthStorage.test.ts`.
 */
export function pickAuthStorage(): SupabaseAuthStorage | undefined {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.localStorage) return undefined;
    return window.localStorage;
  }
  return createAuthSecureStorage();
}
