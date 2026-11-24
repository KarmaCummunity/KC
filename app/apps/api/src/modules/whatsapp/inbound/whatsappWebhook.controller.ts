import { Controller, Get, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { ApiConfig } from '../../../platform/config/apiConfig';
import { API_CONFIG } from '../../../platform/config/apiConfig.module';
import { APP_LOGGER, type AppLogger } from '../../../platform/logging/appLogger';
import { PortClients } from '../../../platform/ports/portClients';
import { type RawBodyRequest, readWebhook, sendAnswer } from '../../../platform/webhooks/webhookRequest';
import type { RpcFn } from './inboundMessages';
import { receiveDelivery, verifySubscription } from './whatsappWebhook';

/**
 * `/v1/webhooks/whatsapp`: where the WhatsApp Cloud API delivers the messages
 * members send (#843). No member token is involved: a delivery is accepted
 * only with the provider's signature over the raw body, and the registration
 * check only with the verify token. Ported from
 * `supabase/functions/whatsapp-webhook`.
 */
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /** The provider's registration check: answers its challenge as plain text. */
  @Get()
  verify(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) reply: FastifyReply): unknown {
    void reply.type('text/plain');
    return sendAnswer(reply, verifySubscription(query, this.config.whatsapp.verifyToken));
  }

  /** One delivery of inbound messages. */
  @Post()
  async receive(@Req() request: RawBodyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
    const service = this.clients.serviceClient();
    const rpc: RpcFn = async (fn, args) => {
      const { data, error } = await service.rpc(fn as never, args as never);
      return { data, error: error ? { message: error.message } : null };
    };
    const answer = await receiveDelivery(readWebhook(request), {
      rpc,
      verifyToken: this.config.whatsapp.verifyToken,
      appSecret: this.config.whatsapp.appSecret,
      report: (error) => this.logger.error({ err: error }, 'whatsapp delivery failed'),
    });
    return sendAnswer(reply, answer);
  }
}
