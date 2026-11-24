import { type DynamicModule, Module } from '@nestjs/common';
import type { FetchFn } from '../metaClient';
import { WHATSAPP_INBOUND_FETCH, WhatsAppWebhookController } from './whatsappWebhook.controller';

/**
 * The WhatsApp inbound webhook. Needs the configuration, logger, port
 * clients, background and storage modules (all global).
 */
@Module({})
export class WhatsAppWebhookModule {
  /** @param overrides The outbound calls to the provider's media addresses; a test replaces them so it reaches no network. */
  static forRoot(overrides: { fetch?: FetchFn } = {}): DynamicModule {
    return {
      module: WhatsAppWebhookModule,
      controllers: [WhatsAppWebhookController],
      providers: [{ provide: WHATSAPP_INBOUND_FETCH, useValue: overrides.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init)) }],
    };
  }
}
