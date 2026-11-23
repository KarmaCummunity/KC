import { DonationLinkFunction, LINK_REACHABILITY_CHECK } from '../donationLinks/donationLinkFunction';
import { checkReachable } from '../donationLinks/reachability';
import { ResearchSubmitFunction } from '../publicResearch/researchSubmitFunction';
import { TranslateFunction } from '../translation/translateFunction';
import { TRANSLATION_PROVIDER, type TranslationProvider } from '../translation/translationProvider';
import { translationProviderFor } from '../translation/translationProviderFor';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import type { HostedFunctionSet } from '../../platform/ports/hostedFunction';

/** Outbound calls a test replaces, so no test reaches the network. */
export interface HostedFunctionOverrides {
  readonly checkReachable?: (url: URL) => Promise<boolean>;
  readonly translationProvider?: TranslationProvider;
}

/**
 * Every Edge Function this server has taken over (ADR-009 phase 8). A newly
 * ported function is added here and nowhere else: the gateway and the
 * registry are generic.
 */
export function hostedFunctionSet(overrides: HostedFunctionOverrides = {}): HostedFunctionSet {
  return {
    functions: [DonationLinkFunction, ResearchSubmitFunction, TranslateFunction],
    providers: [
      { provide: LINK_REACHABILITY_CHECK, useValue: overrides.checkReachable ?? ((url: URL) => checkReachable(url)) },
      {
        provide: TRANSLATION_PROVIDER,
        inject: [API_CONFIG, APP_LOGGER],
        useFactory: (config: ApiConfig, logger: AppLogger) => overrides.translationProvider ?? translationProviderFor(config, logger),
      },
    ],
  };
}
