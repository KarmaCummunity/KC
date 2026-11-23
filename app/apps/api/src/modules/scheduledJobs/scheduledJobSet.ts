import { StandingOrdersChargeJob } from '../billing/standingOrdersChargeJob';
import { EmbedPostsJob, MATCH_RERANK_MODEL, MatchRerankJob, matchRerankModelFor } from '../matching/matchingJobs';
import { DispatchNotificationsJob, PUSH_TRANSPORT } from '../notifications/dispatchNotificationsJob';
import { createExpoTransport } from '../notifications/expoTransport';
import type { PushTransport } from '../notifications/pushTypes';
import { RotateResearchSaltJob } from '../publicResearch/rotateResearchSaltJob';
import type { FetchFn } from '../whatsapp/metaClient';
import { WHATSAPP_FETCH, WhatsAppSenderJob } from '../whatsapp/whatsappSenderJob';
import type { GeminiClient } from '../../platform/ai/geminiClient';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import type { ScheduledJobSet } from '../../platform/jobs/scheduledJob';
import { PruneRealtimeMessagesJob } from '../../platform/realtime/pruneRealtimeMessagesJob';

/** Outbound calls a test replaces, so no test reaches the network. */
export interface ScheduledJobOverrides {
  readonly matchRerankModel?: Pick<GeminiClient, 'generateJson'>;
  readonly pushTransport?: PushTransport;
  readonly whatsAppFetch?: FetchFn;
}

/**
 * Every scheduled job this server runs (ADR-009 phase 8). A newly ported job
 * is added here and nowhere else: the jobs route is generic. A job that
 * replaces an Edge Function keeps its name, so its schedule only changes
 * address; `realtime-retention` is new with KC's own realtime gateway.
 */
export function scheduledJobSet(overrides: ScheduledJobOverrides = {}): ScheduledJobSet {
  return {
    jobs: [DispatchNotificationsJob, EmbedPostsJob, MatchRerankJob, PruneRealtimeMessagesJob, RotateResearchSaltJob, StandingOrdersChargeJob, WhatsAppSenderJob],
    providers: [
      { provide: MATCH_RERANK_MODEL, inject: [API_CONFIG], useFactory: (config: ApiConfig) => overrides.matchRerankModel ?? matchRerankModelFor(config) },
      { provide: PUSH_TRANSPORT, inject: [API_CONFIG], useFactory: (config: ApiConfig) => overrides.pushTransport ?? createExpoTransport(config.expoAccessToken) },
      { provide: WHATSAPP_FETCH, useValue: overrides.whatsAppFetch ?? ((input: string, init?: RequestInit) => fetch(input, init)) },
    ],
  };
}
