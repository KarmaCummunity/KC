// FR-SETTINGS-018 — active-locale translation bundle accessor.
//
// Most UI should use `useTranslation()` + `t('ns.key')`. This accessor exists
// for the admin portal, whose locale modules expose *function-valued* label
// builders (e.g. `admin.reports.reportersCount(n)`, `admin.tasks.row.dueOn(d)`)
// that don't map to i18next's string-template `t()` without restructuring.
// It returns the whole bundle for the ACTIVE UI language so those builders can
// be called directly while still following the user's language choice.
//
// Hook form re-renders on language change (react-i18next's `useTranslation`
// subscribes to `languageChanged`). Non-hook helpers use `localeBundle()`.
import { useTranslation } from 'react-i18next';
import i18n from './index';
import he from './locales/he';
import en from './locales/en';

export type LocaleBundle = typeof he;

// `he` and `en` share an identical key structure (enforced by localeParity.test)
// but have different string-literal value types, so `en` is widened via `unknown`.
function bundleFor(language: string | undefined): LocaleBundle {
  return language?.startsWith('en') ? (en as unknown as LocaleBundle) : he;
}

/** Active-locale bundle for use inside React components (re-renders on change). */
export function useLocaleBundle(): LocaleBundle {
  const { i18n: instance } = useTranslation();
  return bundleFor(instance.language);
}

/** Active-locale bundle for non-hook module code (reads the singleton at call time). */
export function localeBundle(): LocaleBundle {
  return bundleFor(i18n.language);
}

/**
 * Both language bundles at once, for code that must match text in either language regardless of
 * the UI language (the admin portal search, #2081). Never use it to render copy.
 */
export function bothLocaleBundles(): { readonly he: LocaleBundle; readonly en: LocaleBundle } {
  return { he, en: en as unknown as LocaleBundle };
}
