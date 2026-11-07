import { describe, expect, it } from 'vitest';
import { OwnerCompleteOfferUseCase } from '../OwnerCompleteOfferUseCase';
import { PostError } from '../errors';
import { FakePostRepository } from './fakePostRepository';

describe('OwnerCompleteOfferUseCase', () => {
  it('forwards an assign to the repository', async () => {
    const repo = new FakePostRepository();
    repo.ownerCompleteResult = { closed: true };
    const uc = new OwnerCompleteOfferUseCase(repo);

    const out = await uc.execute({
      targetId: 'p_1',
      ownerId: 'u_owner',
      recipientUserId: 'u_taker',
      mode: 'assign',
    });

    expect(out.closed).toBe(true);
    expect(repo.lastOwnerComplete).toEqual({
      targetId: 'p_1',
      recipientUserId: 'u_taker',
      mode: 'assign',
    });
  });

  it('refuses marking the owner as the recipient', async () => {
    const repo = new FakePostRepository();
    const uc = new OwnerCompleteOfferUseCase(repo);

    await expect(
      uc.execute({
        targetId: 'p_1',
        ownerId: 'u_owner',
        recipientUserId: 'u_owner',
        mode: 'assign',
      }),
    ).rejects.toBeInstanceOf(PostError);
    expect(repo.lastOwnerComplete).toBeNull();
  });

  it('forwards a close with nobody named', async () => {
    const repo = new FakePostRepository();
    repo.ownerCompleteResult = { closed: true };
    const uc = new OwnerCompleteOfferUseCase(repo);

    await uc.execute({
      targetId: 'p_1',
      ownerId: 'u_owner',
      recipientUserId: null,
      mode: 'close_without',
    });

    expect(repo.lastOwnerComplete?.mode).toBe('close_without');
  });
});
