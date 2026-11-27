import { type DynamicModule, Module } from '@nestjs/common';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import { EmailAccountService } from './emailAccountService';
import { EMAIL_SENDER, type EmailSender } from './emailSender';
import { exchangeAtGoogle, GOOGLE_CODE_EXCHANGE, GoogleBrowserSignIn, type GoogleCodeExchange } from './googleBrowserSignIn';
import { IdentityController } from './identity.controller';
import { PROVIDER_TOKEN_VERIFIERS, ProviderAccountService, type ProviderTokenVerifiers } from './providerAccountService';
import { createAppleTokenVerifier, createGoogleTokenVerifier, PROVIDER_KEYS_URL, type SignInProvider } from './providerTokens';
import { SessionService } from './sessionService';

export interface IdentityRoutesOptions {
  /**
   * What sends the identity emails. No provider is chosen yet (D-231), so the
   * deployed API passes none: sign-up, resend and recover then answer
   * `503 not_configured`, and everything else works.
   */
  readonly emailSender?: EmailSender;
  /** The keys each provider signs ID tokens with; the provider's published ones unless a test supplies its own. */
  readonly providerKeys?: Partial<Record<SignInProvider, JWTVerifyGetKey>>;
  /** What exchanges Google's code for an ID token in the browser sign-in; Google itself unless a test supplies its own. */
  readonly googleCodeExchange?: GoogleCodeExchange;
}

/**
 * KC's own sign-in and sessions (ADR-013). Needs the platform's identity,
 * database, rate-limit and background modules. On an API that is not
 * configured as an issuer the routes answer `503 not_configured`.
 */
@Module({})
export class IdentityRoutesModule {
  static forRoot(options: IdentityRoutesOptions = {}): DynamicModule {
    // A provider's keys are fetched on the first token and cached; an unknown key id triggers one refetch.
    const keysOf = (provider: SignInProvider) => options.providerKeys?.[provider] ?? createRemoteJWKSet(new URL(PROVIDER_KEYS_URL[provider]));
    return {
      module: IdentityRoutesModule,
      controllers: [IdentityController],
      providers: [
        SessionService,
        EmailAccountService,
        ProviderAccountService,
        GoogleBrowserSignIn,
        { provide: EMAIL_SENDER, useValue: options.emailSender ?? null },
        { provide: GOOGLE_CODE_EXCHANGE, useValue: options.googleCodeExchange ?? exchangeAtGoogle },
        {
          provide: PROVIDER_TOKEN_VERIFIERS,
          inject: [API_CONFIG],
          useFactory: (config: ApiConfig): ProviderTokenVerifiers => ({
            google: createGoogleTokenVerifier(keysOf('google'), config.signIn.googleClientIds),
            apple: createAppleTokenVerifier(keysOf('apple'), config.signIn.appleClientIds),
          }),
        },
      ],
      exports: [SessionService],
    };
  }
}
