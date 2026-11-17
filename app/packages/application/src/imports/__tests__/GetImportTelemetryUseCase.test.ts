// FR-IMPORT-010 AC4 — the import telemetry for the admin statistics.
import { describe, expect, it, vi } from 'vitest';
import type { IImportTelemetryRepository } from '../../ports/IImportTelemetryRepository';
import { GetImportTelemetryUseCase } from '../GetImportTelemetryUseCase';

const funnel = { attempts: 6, manual: 1, drafted: 5, published: 3, discarded: 1, providerCalls: 3 };
const rates = [{ field: 'title', reported: 2, edited: 1, editRate: 0.5 }];
const repo = (): IImportTelemetryRepository => ({
  getFunnel: vi.fn(() => Promise.resolve(funnel)),
  getFieldEditRates: vi.fn(() => Promise.resolve(rates)),
});

describe('GetImportTelemetryUseCase', () => {
  it('reads the funnel and the edit rates of the same window', async () => {
    const r = repo();
    expect(await new GetImportTelemetryUseCase(r).execute(30)).toEqual({ funnel, fieldEditRates: rates });
    expect(r.getFunnel).toHaveBeenCalledWith(30);
    expect(r.getFieldEditRates).toHaveBeenCalledWith(30);
  });

  it('keeps the window between a day and a year', async () => {
    const r = repo();
    await new GetImportTelemetryUseCase(r).execute(0);
    await new GetImportTelemetryUseCase(r).execute(9999);
    expect(r.getFunnel).toHaveBeenNthCalledWith(1, 1);
    expect(r.getFunnel).toHaveBeenNthCalledWith(2, 365);
  });

  it('a failing read is the caller\'s error to show', async () => {
    const r = { ...repo(), getFunnel: vi.fn(() => Promise.reject(new Error('forbidden'))) };
    await expect(new GetImportTelemetryUseCase(r).execute(30)).rejects.toThrow('forbidden');
  });
});
