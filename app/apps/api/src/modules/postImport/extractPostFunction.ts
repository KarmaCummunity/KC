import { Inject, Injectable } from '@nestjs/common';
import type { ExtractionLists } from '@kc/domain';
import type { ApiConfig } from '../../platform/config/apiConfig';
import { API_CONFIG } from '../../platform/config/apiConfig.module';
import type { CallerIdentity } from '../../platform/identity/callerIdentity';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import type { FunctionAnswer, FunctionRequest, HostedFunction } from '../../platform/ports/hostedFunction';
import { PortClients } from '../../platform/ports/portClients';
import { cachedLists, loadExtractionLists } from './extractionLists';
import { POST_EXTRACTION_PROVIDER, type PostExtractionProvider } from './extractionProvider';
import { DEFAULT_LIMITS, type LimitConfig } from './importLimits';
import { importExternalPost, type ImportMember } from './importService';
import { createSqlExtractionCache, createSqlImportStore, createSqlPlaceResolver } from './importStore';

/** The feature flag that switches the import on. A missing row means off: the super admin creates it. */
const FLAG_KEY = 'external_post_import_enabled';

/**
 * `extract-external-post` as the hosted adapter invokes it (FR-IMPORT-001..009).
 * The rules are in `importService.ts`; this class gives them the member, the
 * tables over the service role, the place catalog and the model.
 */
@Injectable()
export class ExtractPostFunction implements HostedFunction {
  readonly name = 'extract-external-post';

  private readonly limits: LimitConfig;
  /** The model's closed lists, kept for a few minutes across requests. */
  private readonly loadLists: () => Promise<ExtractionLists>;

  constructor(
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(POST_EXTRACTION_PROVIDER) private readonly provider: PostExtractionProvider,
    @Inject(API_CONFIG) config: ApiConfig,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {
    this.limits = { ...DEFAULT_LIMITS, dailyBudget: config.postImport.dailyBudget };
    this.loadLists = cachedLists(() => loadExtractionLists(this.clients.serviceClient()));
  }

  async handle(request: FunctionRequest, body: unknown): Promise<FunctionAnswer> {
    const service = this.clients.serviceClient();
    return importExternalPost(request.caller ? await this.memberOf(request.caller) : null, body, {
      isEnabled: async () => {
        const { data } = await service.from('app_flags').select('enabled').eq('key', FLAG_KEY).maybeSingle();
        return (data as { enabled: boolean } | null)?.enabled === true;
      },
      store: createSqlImportStore(service),
      cache: createSqlExtractionCache(service),
      loadLists: this.loadLists,
      provider: this.provider,
      resolvePlace: createSqlPlaceResolver(service),
      now: () => new Date(),
      limits: this.limits,
      report: (error) => this.logger.error({ err: error }, 'post import failed'),
      // The kind of failure only: the error of a provider can quote what was sent to it.
      onProviderFailure: (error) => this.logger.warn({ reason: error instanceof Error ? error.name : 'unknown', detail: (error as { kind?: string }).kind }, 'post extraction provider gave no answer'),
    });
  }

  /**
   * The member with the age of their account, which the account-age limit
   * needs (FR-IMPORT-008 AC4). The profile row is created in the same
   * transaction as the account, and a member cannot change its `created_at`.
   */
  private async memberOf(caller: CallerIdentity): Promise<ImportMember> {
    const { data } = await this.clients.serviceClient().from('users').select('created_at').eq('id', caller.userId).maybeSingle();
    const created = new Date((data as { created_at?: string } | null)?.created_at ?? Number.NaN);
    return { id: caller.userId, createdAt: Number.isNaN(created.getTime()) ? null : created };
  }
}
