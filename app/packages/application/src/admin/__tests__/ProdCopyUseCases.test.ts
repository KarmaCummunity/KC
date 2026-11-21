import { describe, expect, it, vi } from 'vitest';
import { DemoDataError } from '@kc/domain';
import { DeleteProdCopyUseCase, GetProdCopyStatusUseCase } from '../ProdCopyUseCases';
import type { IProdCopyRepository } from '../IProdCopyRepository';

const STATUS = { members: 2, posts: 3, organizations: 1, follows: 1, savedPosts: 0, lastCopiedAt: null };

describe('Production copy use cases (FR-ADMIN-037 AC13)', () => {
  it('reads the status from the repository', async () => {
    const repo: IProdCopyRepository = { getStatus: vi.fn(async () => STATUS), deleteAll: vi.fn() };
    await expect(new GetProdCopyStatusUseCase(repo).execute()).resolves.toEqual(STATUS);
  });

  it('deletes through the repository and passes a refusal on unchanged', async () => {
    const deleteAll = vi.fn<IProdCopyRepository['deleteAll']>()
      .mockResolvedValueOnce({ members: 2, posts: 3, organizations: 1 })
      .mockRejectedValueOnce(new DemoDataError('forbidden'));
    const uc = new DeleteProdCopyUseCase({ getStatus: vi.fn(), deleteAll });
    await expect(uc.execute()).resolves.toEqual({ members: 2, posts: 3, organizations: 1 });
    await expect(uc.execute()).rejects.toMatchObject({ code: 'forbidden' });
  });
});
