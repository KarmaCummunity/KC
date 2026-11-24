import { Module } from '@nestjs/common';
import { WhatsAppWebhookController } from './whatsappWebhook.controller';

/** The WhatsApp inbound webhook. Needs the configuration, logger and port clients modules (all global). */
@Module({ controllers: [WhatsAppWebhookController] })
export class WhatsAppWebhookModule {}
