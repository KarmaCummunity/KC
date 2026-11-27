import { DonationLinkFunction, LINK_REACHABILITY_CHECK } from '../donationLinks/donationLinkFunction';
import { checkReachable } from '../donationLinks/reachability';
import { VerificationSessionFunction } from '../identityVerification/verificationSessionFunction';
import { POST_EXTRACTION_PROVIDER, type PostExtractionProvider } from '../postImport/extractionProvider';
import { ExtractPostFunction } from '../postImport/extractPostFunction';
import { GeminiExtractionProvider } from '../postImport/geminiExtractionProvider';
import { ResearchSubmitFunction } from '../publicResearch/researchSubmitFunction';
import { TranslateFunction } from '../translation/translateFunction';
import { TRANSLATION_PROVIDER, type TranslationProvider } from '../translation/translationProvider';
import { translationProviderFor } from '../translation/translationProviderFor';
import { GeminiClient } from '../../platform/ai/geminiClient';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import type { HostedFunctionSet } from '../../platform/ports/hostedFunction';

/** Outbound calls a test replaces, so no test reaches the network. */
export interface HostedFunctionOverrides {
  readonly checkReachable?: (url: URL) => Promise<boolean>;
  readonly translationProvider?: TranslationProvider;
  readonly postExtractionProvider?: PostExtractionProvider;
}

/**
 * Every Edge Function this server has taken over (ADR-009 phase 8). A newly
 * ported function is added here and nowhere else: the gateway and the
 * registry are generic. The identity verification function also needs
 * `IdentityVerificationModule`, which owns its provider.
 */
export function hostedFunctionSet(overrides: HostedFunctionOverrides = {}): HostedFunctionSet {
  return {
    functions: [DonationLinkFunction, ExtractPostFunction, ResearchSubmitFunction, TranslateFunction, VerificationSessionFunction],
    providers: [
      { provide: LINK_REACHABILITY_CHECK, useValue: overrides.checkReachable ?? ((url: URL) => checkReachable(url)) },
      {
        provide: TRANSLATION_PROVIDER,
        inject: [API_CONFIG, APP_LOGGER],
        useFactory: (config: ApiConfig, logger: AppLogger) => overrides.translationProvider ?? translationProviderFor(config, logger),
      },
      {
        provide: POST_EXTRACTION_PROVIDER,
        inject: [API_CONFIG],
        // Without a key every extraction fails as "not configured" and the member gets the manual route.
        useFactory: (config: ApiConfig) =>
          overrides.postExtractionProvider ?? new GeminiExtractionProvider(new GeminiClient({ apiKey: config.gemini.apiKey, model: config.postImport.model })),
      },
    ],
  };
}
