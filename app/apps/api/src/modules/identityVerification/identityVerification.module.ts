import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import { diditProvider } from './diditProvider';
import { IDENTITY_PROVIDER, type IdentityProvider } from './identityProvider';
import { VerificationWebhookController } from './verificationWebhook.controller';

/** The provider the configuration describes. Missing settings are empty: a session is then refused, a webhook fails closed. */
function providerFor(config: ApiConfig): IdentityProvider {
  const settings = config.identityVerification;
  return diditProvider({
    apiKey: settings.apiKey ?? '',
    webhookSecret: settings.webhookSecret ?? '',
    workflowId: settings.workflowId ?? '',
    ...(settings.callbackUrl ? { callbackUrl: settings.callbackUrl } : {}),
  });
}

/**
 * Identity verification (FR-VERIFY-005, FR-VERIFY-010): the provider behind
 * its seam and the route its decisions arrive at. Global, so the hosted
 * function that opens a session uses the same provider.
 */
@Global()
@Module({})
export class IdentityVerificationModule {
  /** @param overrides The provider a test puts in place of the real one, so no test reaches the network. */
  static forRoot(overrides: { provider?: IdentityProvider } = {}): DynamicModule {
    return {
      module: IdentityVerificationModule,
      controllers: [VerificationWebhookController],
      providers: [{ provide: IDENTITY_PROVIDER, inject: [API_CONFIG], useFactory: (config: ApiConfig) => overrides.provider ?? providerFor(config) }],
      exports: [IDENTITY_PROVIDER],
    };
  }
}
