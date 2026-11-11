import { describe, it, expect } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { ChatError } from '@kc/application';
import { chatCall, mapChatError } from '../mapChatError';

const rule = (reason: string) => new BackendRuleError(reason, 'rpc:test');

describe('mapChatError', () => {
  it.each([
    ['cannot_chat_self', 'cannot_chat_self'],
    ['user_unavailable', 'send_to_deleted_user'],
    ['blocked_relationship', 'blocked_relationship'],
    ['account_not_active', 'account_not_active'],
    ['post_unavailable', 'post_unavailable'],
    ['chat_not_found', 'chat_not_found'],
    ['message_not_found', 'message_not_found'],
    ['support_thread_not_hideable', 'support_thread_not_hideable'],
    ['rate_limited', 'rate_limited'],
    ['message_body_invalid', 'message_too_long'],
    ['invalid_media_payload', 'invalid_media_payload'],
    ['invalid_reaction_type', 'invalid_reaction_type'],
    ['unauthenticated', 'chat_forbidden'],
  ])('maps the stable reason %s to ChatError %s', (reason, code) => {
    const out = mapChatError(rule(reason));
    expect(out).toBeInstanceOf(ChatError);
    expect((out as ChatError).code).toBe(code);
    expect(out.message).toBe(reason);
  });

  it('keeps the rule error as the cause', () => {
    const source = rule('chat_not_found');
    expect((mapChatError(source) as ChatError).cause).toBe(source);
  });

  it('lets BackendUnavailableError through untouched (the degrade rule)', () => {
    const missing = new BackendUnavailableError('rpc:send_message');
    expect(mapChatError(missing)).toBe(missing);
  });

  it('lets a ChatError through untouched', () => {
    const chatError = new ChatError('chat_not_found', 'chat_not_found');
    expect(mapChatError(chatError)).toBe(chatError);
  });

  it('maps an unlisted reason to unknown and keeps its text', () => {
    const out = mapChatError(rule('invalid_rate_limit_args'));
    expect((out as ChatError).code).toBe('unknown');
    expect(out.message).toBe('invalid_rate_limit_args');
  });

  it('maps a plain error to unknown with the original as cause', () => {
    const source = new Error('network down');
    const out = mapChatError(source);
    expect((out as ChatError).code).toBe('unknown');
    expect((out as ChatError).cause).toBe(source);
  });

  it('maps a non-error throwable to unknown', () => {
    expect((mapChatError('boom') as ChatError).code).toBe('unknown');
  });
});

describe('chatCall', () => {
  it('returns the data of a successful call', async () => {
    expect(await chatCall('rpc:x', Promise.resolve({ data: 7, error: null }))).toBe(7);
  });

  it('maps a stable P0001 refusal to a ChatError', async () => {
    const failed = Promise.resolve({ data: null, error: { code: 'P0001', message: 'chat_not_found' } });
    await expect(chatCall('rpc:x', failed)).rejects.toMatchObject({ code: 'chat_not_found' });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const failed = Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'not in the schema cache' } });
    await expect(chatCall('rpc:x', failed)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
