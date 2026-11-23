import { describe, it, expect } from 'vitest';
import { UnsavePostUseCase } from '../UnsavePostUseCase';
import { PostError } from '../errors';
import { FakeSavedPostsRepository } from './fakeSavedPostsRepository';

describe('UnsavePostUseCase', () => {
  it('forwards postId to the repository', async () => {
    const repo = new FakeSavedPostsRepository();
    const uc = new UnsavePostUseCase(repo);
    await uc.execute('post_1');
    expect(repo.lastUnsavePostId).toBe('post_1');
  });

  it('rejects blank postId with typed PostError (message preserved)', async () => {
    const repo = new FakeSavedPostsRepository();
    const uc = new UnsavePostUseCase(repo);
    await expect(uc.execute('  ')).rejects.toMatchObject({
      name: 'PostError',
      code: 'forbidden',
      message: 'UnsavePostUseCase: postId is required',
    });
    await expect(uc.execute('  ')).rejects.toBeInstanceOf(PostError);
  });
});
