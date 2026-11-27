// FR-SETTINGS-018: reconcile native direction before mounting the app shell.
import { useEffect, useState } from 'react';
import { I18nManager, Platform } from 'react-native';
import i18n from './index';
import { applyLayoutDirection, isRtlLanguage, loadStoredLanguageAsync, reloadApp, type AppLanguage } from './language';

/** Keep the native splash up until direction is stable; a direction reload never mounts the shell. */
export function useLanguageBootstrap(): boolean {
  const [ready, setReady] = useState(Platform.OS === 'web');
  useEffect(() => {
    if (Platform.OS === 'web') {
      applyLayoutDirection(i18n.language === 'en' ? 'en' : 'he');
      return;
    }
    let cancelled = false;
    void (async () => {
      const stored = await loadStoredLanguageAsync();
      if (cancelled) return;
      const desired: AppLanguage = stored ?? (i18n.language === 'en' ? 'en' : 'he');
      const needsReload = I18nManager.isRTL !== isRtlLanguage(desired);
      if (desired !== i18n.language) await i18n.changeLanguage(desired);
      if (cancelled) return;
      applyLayoutDirection(desired);
      if (needsReload) {
        reloadApp();
        return;
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);
  return ready;
}
