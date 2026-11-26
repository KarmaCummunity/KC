import { Controller, Get, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { ApiConfig } from '../../../platform/config/apiConfig';
import { API_CONFIG } from '../../../platform/config/apiConfig.module';
import { APP_LOGGER, type AppLogger } from '../../../platform/logging/appLogger';
import { PortClients } from '../../../platform/ports/portClients';
import { type RawBodyRequest, readWebhook, sendAnswer } from '../../../platform/webhooks/webhookRequest';
import { BackgroundWork } from '../../../platform/background/backgroundWork';
import { StorageAdmin } from '../../../platform/storage/storageAdmin';
import { runAgent } from '../agent/run';
import { type FetchFn } from '../metaClient';
import type { ProPhoto, RpcFn } from './inboundMessages';
import { handleProPhoto, type PhotoDeps, POST_PHOTO_BUCKET } from './photo';
import { detectLang } from './replies';
import { receiveDelivery, verifySubscription } from './whatsappWebhook';

/** Injection token of the `fetch` the webhook reaches the provider's media addresses and the model with. */
export const WHATSAPP_INBOUND_FETCH = Symbol('WHATSAPP_INBOUND_FETCH');
/** A photo never changes under its name, so it may be cached for good. */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

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
    @Inject(BackgroundWork) private readonly background: BackgroundWork,
    @Inject(StorageAdmin) private readonly files: StorageAdmin,
    @Inject(WHATSAPP_INBOUND_FETCH) private readonly fetchFn: FetchFn,
  ) {}

  /** The provider's registration check: answers its challenge as plain text. */
  @Get()
  verify(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) reply: FastifyReply): unknown {
    // Plain text, and the browser is told not to guess otherwise.
    void reply.type('text/plain').header('x-content-type-options', 'nosniff');
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
      // The provider is answered at once; the agent's answer and the photo's outcome reach the member as queued replies.
      onProMessage: (message) => Promise.resolve(this.background.start('whatsapp agent', () => this.answer(rpc, message))),
      onProPhoto: (photo) => Promise.resolve(this.background.start('whatsapp photo', () => this.attachPhoto(rpc, photo))),
      verifyToken: this.config.whatsapp.verifyToken,
      appSecret: this.config.whatsapp.appSecret,
      report: (error) => this.logger.error({ err: error }, 'whatsapp delivery failed'),
    });
    return sendAnswer(reply, answer);
  }

  /** #1091: the agent answers a linked Pro member's text. With no model key configured it does nothing. */
  private answer(rpc: RpcFn, message: { waId: string; userId: string; text: string; recordId: string | null }): Promise<unknown> {
    const { apiKey, model } = this.config.gemini;
    return runAgent(
      {
        rpc,
        gemini: apiKey ? { apiKey, model, fetch: this.fetchFn } : null,
        ...(this.config.appBaseUrl ? { appBaseUrl: this.config.appBaseUrl } : {}),
      },
      message,
    );
  }

  /** D158: a linked Pro member's photo completes their waiting draft, on KC's own storage. */
  private attachPhoto(rpc: RpcFn, photo: ProPhoto): Promise<unknown> {
    const { cloudApiToken, graphApiVersion } = this.config.whatsapp;
    const deps: PhotoDeps = {
      rpc,
      fetch: this.fetchFn,
      graph: { token: cloudApiToken ?? '', ...(graphApiVersion ? { graphVersion: graphApiVersion } : {}) },
      storage: {
        upload: async (path, bytes, contentType) => {
          const stored = await this.files.write(POST_PHOTO_BUCKET, path, bytes, { contentType, cacheControl: IMMUTABLE_CACHE_CONTROL });
          return { error: stored ? null : { message: 'The resource already exists' } };
        },
        remove: (path) => this.files.remove(POST_PHOTO_BUCKET, [path]),
      },
      ...(this.config.appBaseUrl ? { appBaseUrl: this.config.appBaseUrl } : {}),
    };
    return handleProPhoto(deps, { waId: photo.waId, userId: photo.userId, mediaId: photo.mediaId, mimeType: photo.mimeType, lang: detectLang(photo.caption) });
  }
}
