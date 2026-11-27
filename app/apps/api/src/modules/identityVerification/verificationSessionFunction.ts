import { Inject, Injectable } from '@nestjs/common';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import type { FunctionAnswer, FunctionRequest, HostedFunction } from '../../platform/ports/hostedFunction';
import { PortClients } from '../../platform/ports/portClients';
import { IDENTITY_PROVIDER, type IdentityProvider, RefusalError } from './identityProvider';
import { openVerificationSession } from './verificationSession';

/** PostgreSQL raise_exception: the database refused with a stable reason. */
const BUSINESS_REFUSAL = 'P0001';

/** A refusal the database chose becomes `RefusalError`; anything else is a failure of the server. */
function failure(error: { code?: string; message: string }): Error {
  return error.code === BUSINESS_REFUSAL ? new RefusalError(error.message) : new Error(error.message);
}

/**
 * `identity-verification-session` as the hosted adapter invokes it
 * (FR-VERIFY-005 AC3). The rules are in `verificationSession.ts`; the attempt
 * tables are written over the service role, because only the server may open
 * an attempt for a member.
 */
@Injectable()
export class VerificationSessionFunction implements HostedFunction {
  readonly name = 'identity-verification-session';

  constructor(
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(IDENTITY_PROVIDER) private readonly provider: IdentityProvider,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  handle(request: FunctionRequest): Promise<FunctionAnswer> {
    const service = this.clients.serviceClient();
    return openVerificationSession(request.caller?.userId ?? null, {
      async begin(userId, providerSlug) {
        const { data, error } = await service.rpc('api_identity_verification_begin', { p_user_id: userId, p_provider: providerSlug });
        if (error) throw failure(error);
        return data as string;
      },
      async latestConsent(userId) {
        const { data, error } = await service
          .from('identity_verification_consents')
          .select('version, accepted_at')
          .eq('user_id', userId)
          .order('accepted_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(error.message);
        const row = data as { version: string; accepted_at: string } | null;
        return row ? { version: row.version, acceptedAt: row.accepted_at } : null;
      },
      async setSession(attemptId, providerSessionId) {
        const { error } = await service.rpc('api_identity_verification_set_session', { p_attempt_id: attemptId, p_provider_session_id: providerSessionId });
        if (error) throw failure(error);
      },
      provider: this.provider,
      report: (error) => this.logger.error({ err: error }, 'identity verification session failed'),
    });
  }
}
