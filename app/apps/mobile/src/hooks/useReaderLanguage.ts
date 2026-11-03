// FR-TRANSLATE-003 — UGC translations always target the active app UI locale.
import { useTranslation } from 'react-i18next';

export function useReaderLanguage(): string {
  const { i18n } = useTranslation();
  return i18n.language === 'en' ? 'en' : 'he';
}
