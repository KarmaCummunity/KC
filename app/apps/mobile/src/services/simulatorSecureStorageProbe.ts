// app/apps/mobile/src/services/simulatorSecureStorageProbe.ts
//
// DEV/E2E simulator diagnostic (#856): verifies that expo-secure-store can
// really write/read/delete on this binary. One hypothesis for the Sentry
// KC-1G secure-store failure is that unsigned simulator builds lack the
// keychain-access-groups entitlement; this probe exists to test that, logging
// a deterministic marker to CI device logs without touching any credential.
// It uses its own non-secret sentinel key/value, never the auth session key,
// and never falls back to plaintext AsyncStorage. The build-time flag
// (`extra.secureStorageProbeEnabled` in app.config.ts) keeps ordinary and
// store binaries from ever running it.

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

export const SECURE_STORAGE_PROBE_MARKER = '[secure-storage-probe]';
export const SECURE_STORAGE_PROBE_OK = `${SECURE_STORAGE_PROBE_MARKER} ok`;
/** Deliberately NOT the auth storage key: the probe never touches credentials. */
const PROBE_KEY = 'kc.dev.secureStorageProbe.v1';
const PROBE_SENTINEL = 'kc-probe-sentinel';

/** Fire-and-forget DEV diagnostic; never throws and never blocks app start. */
export async function startSimulatorSecureStorageProbe(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (Constants.expoConfig?.extra?.secureStorageProbeEnabled !== true) return;
  let wrote = false;
  try {
    await SecureStore.setItemAsync(PROBE_KEY, PROBE_SENTINEL);
    wrote = true;
    const readBack = await SecureStore.getItemAsync(PROBE_KEY);
    if (readBack !== PROBE_SENTINEL) {
      console.warn(`${SECURE_STORAGE_PROBE_MARKER} mismatch: secure storage read-back differed`);
      return; // the finally below still removes the sentinel best-effort
    }
    // 'ok' is emitted only after the sentinel is verifiably gone: a failed
    // delete is a non-ok outcome, never masked, and never thrown.
    await SecureStore.deleteItemAsync(PROBE_KEY);
    wrote = false;
    console.log(SECURE_STORAGE_PROBE_OK);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${SECURE_STORAGE_PROBE_MARKER} fail: ${message}`);
  } finally {
    if (wrote) {
      // Best-effort sentinel cleanup; its own failure never masks the outcome above.
      try {
        await SecureStore.deleteItemAsync(PROBE_KEY);
      } catch {
        /* intentionally ignored */
      }
    }
  }
}
