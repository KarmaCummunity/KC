// Mapped to spec: FR-POST-001 AC1 / AC6 — remember the last category + direction per user.
// Best-effort device storage: a read or write failure never blocks the create form.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_CREATE_PREFERENCES,
  parseCreatePreferences,
  serializeCreatePreferences,
  type CreatePreferences,
} from './unifiedCreateState';

const KEY_PREFIX = 'kc-create-preferences-';

/** Storage key; guests (no user id) share one device-level slot. */
function storageKey(userId: string | null | undefined): string {
  return KEY_PREFIX + (userId ?? 'guest');
}

export async function loadCreatePreferences(userId: string | null | undefined): Promise<CreatePreferences> {
  try {
    return parseCreatePreferences(await AsyncStorage.getItem(storageKey(userId)));
  } catch {
    return DEFAULT_CREATE_PREFERENCES;
  }
}

export async function saveCreatePreferences(
  userId: string | null | undefined,
  prefs: CreatePreferences,
): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(userId), serializeCreatePreferences(prefs));
  } catch {
    // Best-effort: losing the remembered choice only means the next visit opens the default.
  }
}
