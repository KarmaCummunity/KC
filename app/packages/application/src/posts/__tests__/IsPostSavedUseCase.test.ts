import { describe, expect, it } from 'vitest';
import { IsPostSavedUseCase } from '../IsPostSavedUseCase';
import { PostError } from '../errors';
import { FakeSavedPostsRepository } from './fakeSavedPostsRepository';

describe('IsPostSavedUseCase', () => {
  it('rejects blank postId with typed PostError (message preserved)', async () => {
    const uc = new IsPostSavedUseCase(new FakeSavedPostsRepository());
    await expect(uc.execute('  ')).rejects.toMatchObject({
      name: 'PostError',
      code: 'forbidden',
      message: 'IsPostSavedUseCase: postId is required',
    });
    await expect(uc.execute('  ')).rejects.toBeInstanceOf(PostError);
  });

  it('forwards to the repository', async () => {
    const repo = new FakeSavedPostsRepository();
    repo.isPostSavedResult = true;
    const uc = new IsPostSavedUseCase(repo);
    await expect(uc.execute('p1')).resolves.toBe(true);
    expect(repo.lastIsPostSavedPostId).toBe('p1');
  });
});
