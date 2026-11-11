import { describe, it, expect, beforeEach } from 'vitest';
import { SendMessageUseCase } from '../SendMessageUseCase';
import { FakeChatRepository } from './fakeChatRepository';

describe('SendMessageUseCase', () => {
  let repo: FakeChatRepository;
  let uc: SendMessageUseCase;
  beforeEach(() => {
    repo = new FakeChatRepository();
    uc = new SendMessageUseCase(repo);
  });

  it('rejects empty body', async () => {
    await expect(uc.execute({ chatId: 'c1', senderId: 'u1', body: '' }))
      .rejects.toMatchObject({ code: 'message_body_required' });
  });

  it('rejects whitespace-only body', async () => {
    await expect(uc.execute({ chatId: 'c1', senderId: 'u1', body: '   \n\t  ' }))
      .rejects.toMatchObject({ code: 'message_body_required' });
  });

  it('rejects body longer than MESSAGE_MAX_CHARS', async () => {
    const body = 'x'.repeat(2001);
    await expect(uc.execute({ chatId: 'c1', senderId: 'u1', body }))
      .rejects.toMatchObject({ code: 'message_too_long' });
  });

  it('forwards a valid trimmed body to the repository', async () => {
    const result = await uc.execute({ chatId: 'c1', senderId: 'u1', body: '  hello  ' });
    expect(result.body).toBe('hello');
    expect(repo.sendCallCount).toBe(1);
  });

  it('forwards the client message id so a retry is idempotent', async () => {
    await uc.execute({ chatId: 'c1', senderId: 'u1', body: 'hello', messageId: 'client-1' });
    expect(repo.lastSentMessageId).toBe('client-1');
  });
});
