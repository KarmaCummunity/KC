import { Inject, Injectable } from '@nestjs/common';
import type { CallerIdentity } from '../../platform/identity/callerIdentity';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import type { FunctionAnswer, FunctionRequest, HostedFunction } from '../../platform/ports/hostedFunction';
import { PortClients } from '../../platform/ports/portClients';
import { parseTranslateRequest } from './translateRequest';
import { createSqlTranslationCache } from './translationCache';
import { isSupportedTarget } from './translationGuards';
import { TRANSLATION_PROVIDER, type TranslationProvider } from './translationProvider';
import { ProviderFailedError, SourceNotVisibleError, type SourceReader, translateBatch, type TranslationDeps, translateOne } from './translationService';

const refusal = (status: number, error: string): FunctionAnswer => ({ status, body: { error } });

/**
 * `translate` as the hosted adapter invokes it (FR-TRANSLATE-002 / 006). The
 * pipeline is in `translationService.ts`; this class gives it the caller's own
 * view of the content, the cache over the service role, and the provider.
 */
@Injectable()
export class TranslateFunction implements HostedFunction {
  readonly name = 'translate';

  constructor(
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(TRANSLATION_PROVIDER) private readonly provider: TranslationProvider,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /**
   * @returns `200` with the outcome (`{ status, translation? }`, or `{ results }` for a batch), or the refusal:
   *   `400 invalid_body | unsupported_language`, `401 unauthorized`, `403 forbidden`, `502 provider_failed`, `500 internal`.
   */
  async handle(request: FunctionRequest, body: unknown): Promise<FunctionAnswer> {
    if (!request.caller) return refusal(401, 'unauthorized');
    const parsed = parseTranslateRequest(body);
    if (!parsed) return refusal(400, 'invalid_body');
    if (!isSupportedTarget(parsed.targetLanguage)) return refusal(400, 'unsupported_language');

    const deps = this.depsFor(request.caller);
    try {
      if (parsed.kind === 'batch') return { status: 200, body: { results: await translateBatch(parsed.items, parsed.targetLanguage, deps) } };
      return { status: 200, body: await translateOne(parsed.item, parsed.targetLanguage, deps) };
    } catch (error) {
      if (error instanceof SourceNotVisibleError) return refusal(403, 'forbidden');
      if (error instanceof ProviderFailedError) return refusal(502, 'provider_failed');
      this.logger.error({ err: error, mode: parsed.kind }, 'translation failed');
      return refusal(500, 'internal');
    }
  }

  private depsFor(caller: CallerIdentity): TranslationDeps {
    const asCaller = this.clients.clientFor(caller);
    // Row-level security answers for the caller: a row they cannot see simply does not come back.
    const readSources: SourceReader = async (table, key, columns, ids) => {
      const { data, error } = await asCaller.from(table).select(columns.join(', ')).in(key, [...ids]);
      if (error) throw new Error(`source read: ${error.message}`);
      return (data ?? []) as unknown as Record<string, unknown>[];
    };
    return {
      readSources,
      cache: createSqlTranslationCache(this.clients.serviceClient()),
      provider: this.provider,
      warn: (event, detail) => this.logger.warn(detail, event),
    };
  }
}
