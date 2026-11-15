import { describe, it, expect } from 'vitest';
import { SUPPORT_ISSUE_DESCRIPTION_MAX, SubmitSupportIssueUseCase } from '../SubmitSupportIssueUseCase';
import { FakeChatRepository } from './fakeChatRepository';

describe('SubmitSupportIssueUseCase', () => {
  it('rejects empty description', async () => {
    const repo = new FakeChatRepository();
    const uc = new SubmitSupportIssueUseCase(repo);
    await expect(uc.execute({ category: 'bug', description: '' })).rejects.toMatchObject({
      code: 'description_too_short',
    });
  });

  it('rejects whitespace-only description', async () => {
    const repo = new FakeChatRepository();
    const uc = new SubmitSupportIssueUseCase(repo);
    await expect(uc.execute({ category: 'bug', description: '          ' })).rejects.toMatchObject({
      code: 'description_too_short',
    });
  });

  it('rejects description below 10 chars after trim', async () => {
    const repo = new FakeChatRepository();
    const uc = new SubmitSupportIssueUseCase(repo);
    // 9 visible chars surrounded by whitespace — should still fail.
    await expect(uc.execute({ category: 'bug', description: '  abcdefghi  ' })).rejects.toMatchObject({
      code: 'description_too_short',
    });
  });

  it('accepts description that reaches 10 chars only after trim normalization', async () => {
    const repo = new FakeChatRepository();
    const uc = new SubmitSupportIssueUseCase(repo);
    // Exactly 10 visible chars + surrounding whitespace.
    const chat = await uc.execute({ category: 'bug', description: '   1234567890   ' });
    expect(chat.isSupportThread).toBe(true);
  });

  // #2096 (FR-MOD-002 AC6): the description is capped at 500 characters after trim.
  it('accepts a description of exactly the maximum length', async () => {
    const uc = new SubmitSupportIssueUseCase(new FakeChatRepository());
    const chat = await uc.execute({ category: 'Bug', description: 'x'.repeat(SUPPORT_ISSUE_DESCRIPTION_MAX) });
    expect(chat.isSupportThread).toBe(true);
  });

  it('rejects a description over the maximum length', async () => {
    const uc = new SubmitSupportIssueUseCase(new FakeChatRepository());
    await expect(
      uc.execute({ category: 'Bug', description: 'x'.repeat(SUPPORT_ISSUE_DESCRIPTION_MAX + 1) }),
    ).rejects.toMatchObject({ code: 'description_too_long' });
  });

  it('measures the maximum after trim, so surrounding spaces do not count', async () => {
    const uc = new SubmitSupportIssueUseCase(new FakeChatRepository());
    const chat = await uc.execute({ category: null, description: `  ${'x'.repeat(SUPPORT_ISSUE_DESCRIPTION_MAX)}  ` });
    expect(chat.isSupportThread).toBe(true);
  });

  it('forwards a null category to the repo (free-form report)', async () => {
    const repo = new FakeChatRepository();
    const uc = new SubmitSupportIssueUseCase(repo);
    const chat = await uc.execute({ category: null, description: 'no specific category here' });
    expect(chat.isSupportThread).toBe(true);
  });

  it('returns the support thread (idempotent on repeat submissions)', async () => {
    const repo = new FakeChatRepository();
    const uc = new SubmitSupportIssueUseCase(repo);
    const first = await uc.execute({ category: 'bug', description: 'first issue here' });
    const second = await uc.execute({ category: 'feedback', description: 'second issue here' });
    // The fake's submitSupportIssue delegates to getOrCreateSupportThread('test-user'),
    // so the same thread should be returned each call.
    expect(second.chatId).toBe(first.chatId);
    expect(second.isSupportThread).toBe(true);
  });
});
