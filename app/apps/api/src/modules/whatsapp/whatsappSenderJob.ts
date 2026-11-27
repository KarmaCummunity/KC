import { Inject, Injectable } from '@nestjs/common';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import type { JobReport, ScheduledJob } from '../../platform/jobs/scheduledJob';
import { PortClients } from '../../platform/ports/portClients';
import type { FetchFn } from './metaClient';
import type { RpcFn } from './outboundBatch';
import { sendQueuedWhatsApp } from './whatsappSend';

/** Injection token of the `fetch` the sender reaches Meta with (replaced in tests, so none reaches the network). */
export const WHATSAPP_FETCH = Symbol('WHATSAPP_FETCH');

/** Runs every minute: sends the queued WhatsApp messages. The rules are in `whatsappSend.ts`. */
@Injectable()
export class WhatsAppSenderJob implements ScheduledJob {
  readonly name = 'whatsapp-sender';

  constructor(
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(WHATSAPP_FETCH) private readonly fetchFn: FetchFn,
  ) {}

  /** @param input `{ batch? }`: how many messages to claim in this run. */
  run(input: Readonly<Record<string, unknown>>): Promise<JobReport> {
    const service = this.clients.serviceClient();
    const rpc: RpcFn = async (name, args) => {
      const { data, error } = await service.rpc(name, args);
      return { data, error: error ? { message: error.message } : null };
    };
    const { cloudApiToken, phoneNumberId, graphApiVersion } = this.config.whatsapp;
    return sendQueuedWhatsApp(input.batch, { rpc, token: cloudApiToken, phoneNumberId, graphVersion: graphApiVersion, fetchFn: this.fetchFn });
  }
}
