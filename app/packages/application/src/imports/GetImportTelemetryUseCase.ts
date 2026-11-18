// FR-IMPORT-010 AC4 — the import funnel and the per-field edit rate for the admin statistics.
import type { IImportTelemetryRepository, ImportFieldEditRate, ImportFunnel } from '../ports/IImportTelemetryRepository';

export interface ImportTelemetry {
  readonly funnel: ImportFunnel;
  readonly fieldEditRates: readonly ImportFieldEditRate[];
}

/** The window the admin screen may ask for, as the database clamps it. */
const MIN_DAYS = 1;
const MAX_DAYS = 365;

export class GetImportTelemetryUseCase {
  constructor(private readonly repo: IImportTelemetryRepository) {}

  async execute(days: number): Promise<ImportTelemetry> {
    const window = Math.min(Math.max(Math.round(days), MIN_DAYS), MAX_DAYS);
    const [funnel, fieldEditRates] = await Promise.all([this.repo.getFunnel(window), this.repo.getFieldEditRates(window)]);
    return { funnel, fieldEditRates };
  }
}
