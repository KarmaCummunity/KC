import { Module } from '@nestjs/common';
import { BillingWebhooksController } from './billingWebhooks.controller';

/** The billing providers' webhook routes. Needs the configuration and port clients modules (both global). */
@Module({ controllers: [BillingWebhooksController] })
export class BillingModule {}
