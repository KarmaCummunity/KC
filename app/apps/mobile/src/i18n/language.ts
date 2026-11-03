// FR-SETTINGS-018 — app interface language (locale) selection + persistence.
//
// Distinct from FR-TRANSLATE-003 "translation language" (which picks the target
// language for auto-translated user content). This module owns the *UI* locale:
// which bundle react-i18next renders and which reading direction the layout uses.
//
// Persistence is local-only (no DB column, works for anonymous web visitors):
//   - web:    localStorage (synchronous, authoritative at boot)
//   - native: AsyncStorage (async; applied on boot + a reload when direction flips)
import { DevSettings, I18nManager, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppLanguage = 'he' | 'en';

export const SUPPORTED_APP_LANGUAGES: readonly AppLanguage[] = ['he', 'en'];
export const DEFAULT_APP_LANGUAGE: AppLanguage = 'he';

const STORAGE_KEY = 'kc.appLanguage';

export function isSupportedLanguage(value: unknown): value is AppLanguage {
  return value === 'he' || value === 'en';
}

/** RTL languages among the supported set. Hebrew is RTL; English is LTR. */
export function isRtlLanguage(lang: AppLanguage): boolean {
  return lang === 'he';
}

function readWebStorage(): AppLanguage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(STORAGE_KEY);
    return isSupportedLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Synchronous best-effort read of the persisted UI language, used by i18n init.
 * Web reads localStorage (authoritative). Native cannot read AsyncStorage
 * synchronously, so it returns the default; `loadStoredLanguageAsync` reconciles
 * the persisted value on boot and reloads when the layout direction changes.
 */
export function getInitialLanguage(): AppLanguage {
  if (Platform.OS === 'web') return readWebStorage() ?? DEFAULT_APP_LANGUAGE;
  return DEFAULT_APP_LANGUAGE;
}

/** Read the persisted UI language across platforms (async on native). */
export async function loadStoredLanguageAsync(): Promise<AppLanguage | null> {
  if (Platform.OS === 'web') return readWebStorage();
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
    return isSupportedLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persist the chosen UI language across platforms. */
export async function persistLanguage(lang: AppLanguage): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage disabled — session-only selection */
    }
    return;
  }
  try {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable — session-only selection */
  }
}

/**
 * Apply the layout reading direction for a language.
 * Web sets `document.documentElement.dir`/`lang` (read by `isLayoutRtl()` and the
 * direction-aware style helpers). All platforms keep `I18nManager` in sync so
 * native mirroring and web `isRTL` reads resolve to the active direction.
 */
export function applyLayoutDirection(lang: AppLanguage): void {
  const rtl = isRtlLanguage(lang);
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }
  try {
    I18nManager.allowRTL(rtl);
    if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
  } catch {
    /* I18nManager unavailable in some test envs */
  }
}

function devReload(): void {
  try {
    DevSettings?.reload?.();
  } catch {
    /* no-op */
  }
}

// expo-updates is loaded lazily so web and every importer of this module skip
// the native module until a reload is actually requested.
async function reloadNative(): Promise<void> {
  const Updates = await import('expo-updates');
  if (!Updates.isEnabled) {
    devReload();
    return;
  }
  await Updates.reloadAsync();
}

/**
 * Reload the app so module-load direction constants and native RTL mirroring
 * re-resolve for the new language. Web reloads the page. Native release builds
 * reload through expo-updates; dev clients (updates disabled) use DevSettings.
 */
export function reloadApp(): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.location.reload();
    return;
  }
  reloadNative().catch(devReload);
}
