import { describe, expect, it, vi } from 'vitest';
import { manualImportDraft, type ImportDraft } from '@kc/domain';
import type { IPostExtractionService, PostExtractionRequest } from '../../ports/IPostExtractionService';
import { ExtractExternalPostUseCase } from '../ExtractExternalPostUseCase';

const request: PostExtractionRequest = { text: 'sofa for free', channel: 'paste', sourcePlatform: 'whatsapp' };
const draft: ImportDraft = { ...manualImportDraft('ok'), importId: 'imp-1', routing: 'confirm' };
const serviceReturning = (result: ImportDraft | null | Error): IPostExtractionService => ({
  extract: vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))),
  attachPost: vi.fn(() => Promise.resolve(true)),
});

describe('ExtractExternalPostUseCase', () => {
  it('returns the draft the service gives, and passes the request through unchanged', async () => {
    const service = serviceReturning(draft);
    expect(await new ExtractExternalPostUseCase(service).execute(request)).toBe(draft);
    expect(service.extract).toHaveBeenCalledWith(request);
  });

  it('a service that answers nothing is the manual route', async () => {
    expect(await new ExtractExternalPostUseCase(serviceReturning(null)).execute(request)).toMatchObject({ routing: 'manual', reason: 'provider_failed' });
  });

  it('a service that throws is the manual route, never an exception', async () => {
    expect(await new ExtractExternalPostUseCase(serviceReturning(new Error('network'))).execute(request)).toMatchObject({ routing: 'manual', reason: 'provider_failed' });
  });

  it.each(['', '   ', '\n\t'])('an empty text %j never calls the service', async (text) => {
    const service = serviceReturning(draft);
    const result = await new ExtractExternalPostUseCase(service).execute({ ...request, text });
    expect(result).toMatchObject({ routing: 'manual', reason: 'empty_text' });
    expect(service.extract).not.toHaveBeenCalled();
  });
});
