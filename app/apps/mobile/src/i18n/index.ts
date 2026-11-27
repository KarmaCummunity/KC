import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he';
import en from './locales/en';
import { getInitialLanguage } from './language';

// FR-SETTINGS-018 — Hebrew (default) + English UI locales. The active language
// is resolved from the persisted preference (web: localStorage, synchronous;
// native: default here, reconciled on boot). `fallbackLng: 'he'` keeps any
// not-yet-translated English key rendering its Hebrew source instead of the raw key.
// JSON v4 plural suffixes (`_one` / `_two` / `_other`, …). Do not re-add
// `compatibilityJSON: 'v3'` — it is deprecated and breaks at i18next v25 (#1784).
void i18n.use(initReactI18next).init({
  resources: { he: { translation: he }, en: { translation: en } },
  lng: getInitialLanguage(),
  fallbackLng: 'he',
  interpolation: { escapeValue: false },
});

export default i18n;
