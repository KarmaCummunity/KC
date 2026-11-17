import { describe, expect, it, vi } from 'vitest';
import type { IPostExtractionService } from '../../ports/IPostExtractionService';
import { AttachImportedPostUseCase } from '../AttachImportedPostUseCase';

const service = (attach: () => Promise<boolean>): IPostExtractionService => ({ extract: vi.fn(), attachPost: vi.fn(attach) });

describe('AttachImportedPostUseCase', () => {
  it('links the import to the post and reports it', async () => {
    const s = service(() => Promise.resolve(true));
    expect(await new AttachImportedPostUseCase(s).execute({ importId: 'imp-1', postId: 'post-1' })).toBe(true);
    expect(s.attachPost).toHaveBeenCalledWith('imp-1', 'post-1');
  });

  it('a draft without an import id has nothing to attach and asks nothing of the service', async () => {
    const s = service(() => Promise.resolve(true));
    expect(await new AttachImportedPostUseCase(s).execute({ importId: null, postId: 'post-1' })).toBe(false);
    expect(s.attachPost).not.toHaveBeenCalled();
  });

  it('a refusal is false', async () => {
    expect(await new AttachImportedPostUseCase(service(() => Promise.resolve(false))).execute({ importId: 'i', postId: 'p' })).toBe(false);
  });

  it('a throwing service is false, never an exception', async () => {
    expect(await new AttachImportedPostUseCase(service(() => Promise.reject(new Error('network')))).execute({ importId: 'i', postId: 'p' })).toBe(false);
  });
});
