import { Inject, Injectable } from '@nestjs/common';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import type { FunctionAnswer, FunctionRequest, HostedFunction } from '../../platform/ports/hostedFunction';
import { PortClients } from '../../platform/ports/portClients';
import { type SubmitArgs, submitResearchResponse } from './researchSubmission';

/**
 * `public-research-submit` as the hosted adapter invokes it (FR-RESEARCH-002).
 * The rules are in `researchSubmission.ts`; this class gives them the request,
 * the allowlist and the two database functions, which only the service role
 * may execute.
 */
@Injectable()
export class ResearchSubmitFunction implements HostedFunction {
  readonly name = 'public-research-submit';

  /** The web origins that may call the API at all (CORS) are the ones that may submit. */
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(API_CONFIG) config: ApiConfig,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {
    this.allowedOrigins = new Set(config.allowedOrigins);
  }

  handle(request: FunctionRequest, body: unknown): Promise<FunctionAnswer> {
    const service = this.clients.serviceClient();
    return submitResearchResponse(body, request, {
      isAllowedOrigin: (origin) => this.allowedOrigins.has(origin),
      async getSalt() {
        const { data, error } = await service.rpc('get_research_salt');
        if (error || typeof data !== 'string') throw error ?? new Error('salt_missing');
        return data;
      },
      async submit(args: SubmitArgs) {
        const { data, error } = await service.rpc('submit_public_research_response', args);
        // The message is the code the database raised; `mapRpcError` reads it.
        if (error) throw new Error(error.message);
        return String(data);
      },
      report: (error) => this.logger.error({ err: error }, 'public research submission failed'),
    });
  }
}
