import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListExecute = vi.fn();
const mockUpsertExecute = vi.fn();

vi.mock('../../services/postsComposition', () => ({
  getListPostActorIdentityUseCase: () => ({ execute: mockListExecute }),
  getUpsertPostActorIdentityUseCase: () => ({ execute: mockUpsertExecute }),
}));

import { syncOwnerPostActorIdentity } from '../syncOwnerPostActorIdentity';

describe('syncOwnerPostActorIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts directly when hideFromCounterparty is true, without querying existing identities', async () => {
    await syncOwnerPostActorIdentity({
      postId: 'p-1',
      ownerId: 'u-1',
      visibility: 'Public',
      hideFromCounterparty: true,
    });

    expect(mockListExecute).not.toHaveBeenCalled();
    expect(mockUpsertExecute).toHaveBeenCalledWith({
      postId: 'p-1',
      userId: 'u-1',
      surfaceVisibility: 'Public',
      hideFromCounterparty: true,
    });
  });

  it('upserts directly when visibility is OnlyMe (effective hide), without querying existing identities', async () => {
    await syncOwnerPostActorIdentity({
      postId: 'p-1',
      ownerId: 'u-1',
      visibility: 'OnlyMe',
      hideFromCounterparty: false,
    });

    expect(mockListExecute).not.toHaveBeenCalled();
    expect(mockUpsertExecute).toHaveBeenCalledWith({
      postId: 'p-1',
      userId: 'u-1',
      surfaceVisibility: 'OnlyMe',
      hideFromCounterparty: true,
    });
  });

  it('does not upsert if effectiveHide is false and owner identity does not exist', async () => {
    mockListExecute.mockResolvedValueOnce([{ userId: 'other-user' }]);

    await syncOwnerPostActorIdentity({
      postId: 'p-1',
      ownerId: 'u-1',
      visibility: 'Public',
      hideFromCounterparty: false,
    });

    expect(mockListExecute).toHaveBeenCalledWith({ postId: 'p-1' });
    expect(mockUpsertExecute).not.toHaveBeenCalled();
  });

  it('upserts when effectiveHide is false and owner identity already exists', async () => {
    mockListExecute.mockResolvedValueOnce([{ userId: 'u-1' }]);

    await syncOwnerPostActorIdentity({
      postId: 'p-1',
      ownerId: 'u-1',
      visibility: 'Public',
      hideFromCounterparty: false,
    });

    expect(mockListExecute).toHaveBeenCalledWith({ postId: 'p-1' });
    expect(mockUpsertExecute).toHaveBeenCalledWith({
      postId: 'p-1',
      userId: 'u-1',
      surfaceVisibility: 'Public',
      hideFromCounterparty: false,
    });
  });
});
