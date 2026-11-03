import { describe, it, expect } from 'vitest';
import { DeletePostUseCase } from '../DeletePostUseCase';
import { FakePostRepository } from './fakePostRepository';
import { makePostWithOwner } from './fakePostRepositoryFactories';

describe('DeletePostUseCase', () => {
  it('forwards postId to repo.delete when owner matches', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ postId: 'p_1', ownerId: 'u_owner' });
    const uc = new DeletePostUseCase(repo);
    await uc.execute({ postId: 'p_1', ownerId: 'u_owner' });
    expect(repo.lastDeletePostId).toBe('p_1');
  });

  it('rejects when ownerId does not match', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ postId: 'p_1', ownerId: 'u_real' });
    const uc = new DeletePostUseCase(repo);
    await expect(uc.execute({ postId: 'p_1', ownerId: 'u_other' })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('throws post_not_found when the post does not exist', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = null;
    const uc = new DeletePostUseCase(repo);
    await expect(uc.execute({ postId: 'missing', ownerId: 'u_owner' })).rejects.toMatchObject({
      code: 'unknown',
      message: 'post_not_found',
    });
  });

  it('propagates repo errors', async () => {
    const repo = new FakePostRepository();
    repo.findByIdResult = makePostWithOwner({ postId: 'p_1', ownerId: 'u_owner' });
    repo.deleteError = new Error('rls_violation');
    const uc = new DeletePostUseCase(repo);
    await expect(uc.execute({ postId: 'p_1', ownerId: 'u_owner' })).rejects.toThrow('rls_violation');
  });
});
