import { StandingOrdersChargeJob } from '../billing/standingOrdersChargeJob';
import { EmbedPostsJob, MATCH_RERANK_MODEL, MatchRerankJob, matchRerankModelFor } from '../matching/matchingJobs';
import { DispatchNotificationsJob, PUSH_TRANSPORT } from '../notifications/dispatchNotificationsJob';
import { createExpoTransport } from '../notifications/expoTransport';
import type { PushTransport } from '../notifications/pushTypes';
import { RotateResearchSaltJob } from '../publicResearch/rotateResearchSaltJob';
import type { GeminiClient } from '../../platform/ai/geminiClient';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import type { ScheduledJobSet } from '../../platform/jobs/scheduledJob';

/** Outbound calls a test replaces, so no test reaches the network. */
export interface ScheduledJobOverrides {
  readonly matchRerankModel?: Pick<GeminiClient, 'generateJson'>;
  readonly pushTransport?: PushTransport;
}

/**
 * Every scheduled job this server runs (ADR-009 phase 8). A newly ported job
 * is added here and nowhere else: the jobs route is generic. Each keeps the
 * name of the Edge Function it replaces, so a schedule only changes address.
 */
export function scheduledJobSet(overrides: ScheduledJobOverrides = {}): ScheduledJobSet {
  return {
    jobs: [DispatchNotificationsJob, EmbedPostsJob, MatchRerankJob, RotateResearchSaltJob, StandingOrdersChargeJob],
    providers: [
      { provide: MATCH_RERANK_MODEL, inject: [API_CONFIG], useFactory: (config: ApiConfig) => overrides.matchRerankModel ?? matchRerankModelFor(config) },
      { provide: PUSH_TRANSPORT, inject: [API_CONFIG], useFactory: (config: ApiConfig) => overrides.pushTransport ?? createExpoTransport(config.expoAccessToken) },
    ],
  };
}
