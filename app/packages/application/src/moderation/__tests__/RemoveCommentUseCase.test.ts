import { describe, expect, it } from 'vitest';
import { RemoveCommentUseCase } from '../RemoveCommentUseCase';
import { FakeModerationAdminRepository } from './fakeModerationAdminRepository';

describe('RemoveCommentUseCase', () => {
  it('removes the comment through the repository', async () => {
    const repo = new FakeModerationAdminRepository();
    await new RemoveCommentUseCase(repo).execute({ commentId: 'k1' });
    expect(repo.removeCommentCalls).toEqual(['k1']);
  });

  it('propagates a refusal', async () => {
    const repo = new FakeModerationAdminRepository();
    repo.errorOnNext = new Error('forbidden');
    await expect(new RemoveCommentUseCase(repo).execute({ commentId: 'k1' })).rejects.toThrow('forbidden');
  });
});
