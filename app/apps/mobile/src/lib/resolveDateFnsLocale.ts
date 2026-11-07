// Maps the active i18next language code to a date-fns locale for relative-time formatting.

import { he } from 'date-fns/locale/he';
import { enUS } from 'date-fns/locale/en-US';
import type { Locale } from 'date-fns';

const LOCALES: Record<string, Locale> = {
  he,
  'he-IL': he,
  en: enUS,
  'en-US': enUS,
};

export function resolveDateFnsLocale(language: string): Locale {
  const primary = language.split('-')[0] ?? '';
  return LOCALES[language] ?? LOCALES[primary] ?? he;
}
