import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { SessionService } from './sessionService';

/**
 * KC's own sign-in and sessions (ADR-013). Needs the platform's identity,
 * database and rate-limit modules. On an API that is not configured as an
 * issuer the routes answer `503 not_configured`.
 */
@Module({ controllers: [IdentityController], providers: [SessionService], exports: [SessionService] })
export class IdentityRoutesModule {}
