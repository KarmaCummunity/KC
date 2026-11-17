import { describe, expect, it, vi } from 'vitest';
import type { IPostExtractionService } from '../../ports/IPostExtractionService';
import { AttachImportedPostUseCase } from '../AttachImportedPostUseCase';

const service = (attach: () => Promise<boolean>, record: () => Promise<boolean> = () => Promise.resolve(true)): IPostExtractionService => ({
  extract: vi.fn(),
  attachPost: vi.fn(attach),
  recordEdits: vi.fn(record),
});

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

  // FR-IMPORT-010 AC4 — the edit-rate signal.
  it('records the edited fields after the link is made', async () => {
    const s = service(() => Promise.resolve(true));
    await new AttachImportedPostUseCase(s).execute({ importId: 'imp-1', postId: 'p', editedFields: ['title', 'city'] });
    expect(s.recordEdits).toHaveBeenCalledWith('imp-1', ['title', 'city']);
  });

  it('records an empty list too: a draft published untouched is the signal of a good extraction', async () => {
    const s = service(() => Promise.resolve(true));
    await new AttachImportedPostUseCase(s).execute({ importId: 'imp-1', postId: 'p', editedFields: [] });
    expect(s.recordEdits).toHaveBeenCalledWith('imp-1', []);
  });

  it('records nothing when the link was refused, or when the caller could not tell', async () => {
    const refused = service(() => Promise.resolve(false));
    await new AttachImportedPostUseCase(refused).execute({ importId: 'i', postId: 'p', editedFields: ['title'] });
    expect(refused.recordEdits).not.toHaveBeenCalled();
    const unknown = service(() => Promise.resolve(true));
    await new AttachImportedPostUseCase(unknown).execute({ importId: 'i', postId: 'p' });
    expect(unknown.recordEdits).not.toHaveBeenCalled();
  });

  it('a failing record keeps the answer: the post is linked', async () => {
    const s = service(() => Promise.resolve(true), () => Promise.reject(new Error('network')));
    expect(await new AttachImportedPostUseCase(s).execute({ importId: 'i', postId: 'p', editedFields: ['title'] })).toBe(true);
  });
});
