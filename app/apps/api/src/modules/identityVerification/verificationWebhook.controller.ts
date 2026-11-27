import { Controller, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import { PortClients } from '../../platform/ports/portClients';
import { type RawBodyRequest, readWebhook, sendAnswer } from '../../platform/webhooks/webhookRequest';
import { IDENTITY_PROVIDER, type IdentityProvider } from './identityProvider';
import { type AppliedEvent, receiveVerificationEvent } from './verificationWebhook';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /v1/webhooks/identity-verification`: where the identity provider
 * reports its decisions (FR-VERIFY-005 AC4). No member token is involved: the
 * request is accepted only with the provider's signature over the raw body.
 */
@Controller('webhooks/identity-verification')
export class VerificationWebhookController {
  constructor(
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(IDENTITY_PROVIDER) private readonly provider: IdentityProvider,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  @Post()
  async receive(@Req() request: RawBodyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
    const service = this.clients.serviceClient();
    const answer = await receiveVerificationEvent(readWebhook(request), {
      provider: this.provider,
      identityHashKey: this.config.identityVerification.identityHashKey,
      async profileNameForAttempt(attemptId) {
        // Only a well-formed attempt id reaches the query; anything else has no profile name.
        if (!UUID.test(attemptId)) return null;
        const { data } = await service.from('identity_verifications').select('users(display_name)').eq('id', attemptId).maybeSingle();
        return (data as { users: { display_name: string | null } | null } | null)?.users?.display_name ?? null;
      },
      async apply(providerSlug, eventId, payload): Promise<AppliedEvent> {
        const { data, error } = await service.rpc('identity_verification_apply', { p_provider_slug: providerSlug, p_event_id: eventId, p_payload: payload });
        if (error) throw new Error(error.message);
        // A set-returning function arrives as an array with one row.
        const row = (Array.isArray(data) ? data[0] : data) as { webhook_event_id: string; event_status: AppliedEvent['status']; event_error_code: string | null };
        return { id: row.webhook_event_id, status: row.event_status, errorCode: row.event_error_code };
      },
      nowSeconds: () => Math.floor(Date.now() / 1000),
      report: (error) => this.logger.error({ err: error }, 'identity verification event failed'),
    });
    return sendAnswer(reply, answer);
  }
}
