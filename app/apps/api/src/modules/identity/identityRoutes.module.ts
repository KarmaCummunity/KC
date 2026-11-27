import { type DynamicModule, Module } from '@nestjs/common';
import { EmailAccountService } from './emailAccountService';
import { EMAIL_SENDER, type EmailSender } from './emailSender';
import { IdentityController } from './identity.controller';
import { SessionService } from './sessionService';

/**
 * KC's own sign-in and sessions (ADR-013). Needs the platform's identity,
 * database, rate-limit and background modules. On an API that is not
 * configured as an issuer the routes answer `503 not_configured`.
 */
@Module({})
export class IdentityRoutesModule {
  /**
   * @param options.emailSender What sends the identity emails. No provider is chosen yet (D-231), so the
   *   deployed API passes none: sign-up, resend and recover then answer `503 not_configured`, and everything else works.
   */
  static forRoot(options: { emailSender?: EmailSender } = {}): DynamicModule {
    return {
      module: IdentityRoutesModule,
      controllers: [IdentityController],
      providers: [SessionService, EmailAccountService, { provide: EMAIL_SENDER, useValue: options.emailSender ?? null }],
      exports: [SessionService],
    };
  }
}
