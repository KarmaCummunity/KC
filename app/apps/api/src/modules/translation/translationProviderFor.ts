import type { ApiConfig } from '../../platform/config/apiConfig';
import { GeminiClient } from '../../platform/ai/geminiClient';
import type { AppLogger } from '../../platform/logging/appLogger';
import { GeminiProvider } from './geminiProvider';
import { GoogleFreeProvider } from './googleFreeProvider';
import type { TranslationProvider } from './translationProvider';

/** A translation of the longest allowed text may take this long. */
const GEMINI_TRANSLATION_TIMEOUT_MS = 30_000;

/**
 * The provider the configuration selects (`KC_TRANSLATION_PROVIDER`). The
 * keyless one is the default: Gemini's free tier is not available everywhere,
 * and no paid provider is in use before launch.
 */
export function translationProviderFor(config: ApiConfig, logger: AppLogger): TranslationProvider {
  if (config.translationProvider === 'gemini') {
    // `loadApiConfig` refuses to start with this provider and no key. A long post takes longer than the default allows.
    return new GeminiProvider(new GeminiClient({ ...config.gemini, timeoutMs: GEMINI_TRANSLATION_TIMEOUT_MS }));
  }
  return new GoogleFreeProvider({ onFallback: (detail) => logger.warn({ detail }, 'primary translation endpoint failed, trying the fallback') });
}
