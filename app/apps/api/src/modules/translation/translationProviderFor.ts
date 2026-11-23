import type { ApiConfig } from '../../platform/config/apiConfig';
import type { AppLogger } from '../../platform/logging/appLogger';
import { GeminiProvider } from './geminiProvider';
import { GoogleFreeProvider } from './googleFreeProvider';
import type { TranslationProvider } from './translationProvider';

/**
 * The provider the configuration selects (`KC_TRANSLATION_PROVIDER`). The
 * keyless one is the default: Gemini's free tier is not available everywhere,
 * and no paid provider is in use before launch.
 */
export function translationProviderFor(config: ApiConfig, logger: AppLogger): TranslationProvider {
  if (config.translationProvider === 'gemini') {
    // `loadApiConfig` refuses to start with this provider and no key.
    return new GeminiProvider({ apiKey: config.gemini.apiKey ?? '', model: config.gemini.model });
  }
  return new GoogleFreeProvider({ onFallback: (detail) => logger.warn({ detail }, 'primary translation endpoint failed, trying the fallback') });
}
