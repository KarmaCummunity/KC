import { Controller, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import { PortClients } from '../../platform/ports/portClients';
import { type RawBodyRequest, readWebhook, sendAnswer } from '../../platform/webhooks/webhookRequest';
import { type AppliedEvent, receivePaymentEvent } from './paymentProviderEvents';
import { receiveRevenueCatEvent } from './revenueCatEvents';

/**
 * Where the billing providers report to: `POST /v1/webhooks/revenuecat`
 * (store subscriptions) and `POST /v1/webhooks/payments` (donation payment
 * providers). No member token is involved; each route authenticates the
 * provider itself (`revenueCatEvents.ts`, `paymentProviderEvents.ts`) and
 * writes through database functions only the service role may run.
 */
@Controller('webhooks')
export class BillingWebhooksController {
  constructor(
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  @Post('revenuecat')
  async revenueCat(@Req() request: RawBodyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
    const settings = this.config.billing.revenueCat;
    /** Runs one of the entitlement functions; a refusal by the database is a failure RevenueCat retries. */
    const run = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      const { data, error } = await this.clients.serviceClient().rpc(name, args);
      if (error) throw new Error(error.message);
      return data;
    };
    const answer = await receiveRevenueCatEvent(readWebhook(request), {
      authSecret: settings.webhookAuth,
      proEntitlementId: settings.proEntitlementId,
      orgEntitlementId: settings.orgEntitlementId,
      setMemberPro: (userId, active, expiresAt) => run('api_revenuecat_set_pro', { p_user_id: userId, p_active: active, p_expires_at: expiresAt }),
      setOrganizationPlan: (organizationId, active, expiresAt) =>
        run('api_revenuecat_set_org_entitlement', { p_org_id: organizationId, p_active: active, p_expires_at: expiresAt }),
      report: (error) => this.logger.error({ err: error }, 'store subscription event failed'),
    });
    return sendAnswer(reply, answer);
  }

  @Post('payments')
  async payments(@Req() request: RawBodyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
    const secrets = this.config.billing.paymentWebhookSecrets;
    const service = this.clients.serviceClient();
    const answer = await receivePaymentEvent(readWebhook(request), {
      // `Object.hasOwn`, so a provider named like an inherited property has no secret.
      secretFor: (slug) => (Object.hasOwn(secrets, slug) ? (secrets[slug] as string) : null),
      async apply(providerSlug, eventId, payload): Promise<AppliedEvent> {
        const { data, error } = await service.rpc('provider_webhook_apply', { p_provider_slug: providerSlug, p_event_id: eventId, p_payload: payload });
        if (error) throw new Error(error.message);
        // A set-returning function arrives as an array with one row.
        const row = (Array.isArray(data) ? data[0] : data) as { webhook_event_id: string; event_status: AppliedEvent['status']; event_error_code: string | null };
        return { id: row.webhook_event_id, status: row.event_status, errorCode: row.event_error_code };
      },
      report: (error) => this.logger.error({ err: error }, 'payment provider event failed'),
    });
    return sendAnswer(reply, answer);
  }
}
