import { describe, it, expect, beforeEach } from 'vitest';
import { OpenOrCreateChatUseCase } from '../OpenOrCreateChatUseCase';
import { FakeChatRepository } from './fakeChatRepository';

describe('OpenOrCreateChatUseCase', () => {
  let repo: FakeChatRepository;
  let uc: OpenOrCreateChatUseCase;
  beforeEach(() => {
    repo = new FakeChatRepository();
    uc = new OpenOrCreateChatUseCase(repo);
  });

  it('creates a new chat when none exists', async () => {
    const chat = await uc.execute({ viewerId: 'a', otherUserId: 'b', anchorPostId: 'p1' });
    expect(chat.anchorPostId).toBe('p1');
    expect(repo.chats).toHaveLength(1);
  });

  it('re-anchors the existing chat to the new post on second call', async () => {
    await uc.execute({ viewerId: 'a', otherUserId: 'b', anchorPostId: 'p1' });
    const second = await uc.execute({ viewerId: 'a', otherUserId: 'b', anchorPostId: 'p2' });
    expect(second.anchorPostId).toBe('p2');
    expect(repo.chats).toHaveLength(1);
  });

  it('does not change anchor when called without an anchor (inbox flow)', async () => {
    await uc.execute({ viewerId: 'a', otherUserId: 'b', anchorPostId: 'p1' });
    const second = await uc.execute({ viewerId: 'a', otherUserId: 'b' });
    expect(second.anchorPostId).toBe('p1');
    expect(repo.chats).toHaveLength(1);
  });

  it('handles no-anchor entry (profile flow) for brand-new chat', async () => {
    const chat = await uc.execute({ viewerId: 'a', otherUserId: 'b' });
    expect(chat.anchorPostId).toBeNull();
  });

  it('creates a second chat when preferNewThread is true', async () => {
    const first = await uc.execute({ viewerId: 'a', otherUserId: 'b', anchorPostId: 'p1' });
    const second = await uc.execute({
      viewerId: 'a',
      otherUserId: 'b',
      anchorPostId: 'p2',
      preferNewThread: true,
    });
    expect(repo.chats).toHaveLength(2);
    expect(second.chatId).not.toBe(first.chatId);
  });
});
