import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { SupabaseChatV2Repository } from '../SupabaseChatV2Repository';

const MEDIA_ROW = {
  id: 'm_9',
  chat_id: 'c_1',
  sender_id: 'u_me',
  kind: 'media',
  body: null,
  system_payload: null,
  media_payload: { type: 'image', url: 'x' },
  source_language: null,
  created_at: '2026-05-16T12:00:00.000Z',
};

describe('SupabaseChatV2Repository.setMessageReaction', () => {
  it('calls set_message_reaction with the message and the reaction', async () => {
    const { client, calls } = createFakeClient({ rpc: { set_message_reaction: { data: null, error: null } } });

    await new SupabaseChatV2Repository(client).setMessageReaction('m_1', 'love');

    expect(calls[0]).toMatchObject({ fn: 'set_message_reaction', args: { p_message_id: 'm_1', p_reaction_type: 'love' } });
  });

  it('clears the reaction by sending null', async () => {
    const { client, calls } = createFakeClient({ rpc: { set_message_reaction: { data: null, error: null } } });

    await new SupabaseChatV2Repository(client).setMessageReaction('m_1', null);

    expect((calls[0]?.args as { p_reaction_type: unknown }).p_reaction_type).toBeNull();
  });

  it('maps an unknown reaction to invalid_reaction_type', async () => {
    const { client } = createFakeClient({
      rpc: { set_message_reaction: { data: null, error: { code: 'P0001', message: 'invalid_reaction_type' } } },
    });

    await expect(new SupabaseChatV2Repository(client).setMessageReaction('m_1', 'like')).rejects.toMatchObject({
      code: 'invalid_reaction_type',
    });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      rpc: { set_message_reaction: { data: null, error: { code: 'PGRST202', message: 'not in the schema cache' } } },
    });

    await expect(new SupabaseChatV2Repository(client).setMessageReaction('m_1', 'like')).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});

describe('SupabaseChatV2Repository.sendMediaMessage', () => {
  it('sends the payload and caption through send_message and maps the row', async () => {
    const { client, calls } = createFakeClient({ rpc: { send_message: { data: MEDIA_ROW, error: null } } });

    const message = await new SupabaseChatV2Repository(client).sendMediaMessage('c_1', { type: 'image', url: 'x' }, 'look', 'client-1');

    expect(calls[0]).toMatchObject({
      fn: 'send_message',
      args: { p_chat_id: 'c_1', p_body: 'look', p_media_payload: { type: 'image', url: 'x' }, p_message_id: 'client-1' },
    });
    expect(message).toMatchObject({ messageId: 'm_9', kind: 'media', mediaPayload: { type: 'image', url: 'x' } });
  });

  it('sends an empty caption as an empty body (the server stores no body)', async () => {
    const { client, calls } = createFakeClient({ rpc: { send_message: { data: MEDIA_ROW, error: null } } });

    await new SupabaseChatV2Repository(client).sendMediaMessage('c_1', { type: 'image', url: 'x' });

    expect((calls[0]?.args as { p_body: string }).p_body).toBe('');
  });

  it('maps a rejected payload to invalid_media_payload', async () => {
    const { client } = createFakeClient({
      rpc: { send_message: { data: null, error: { code: 'P0001', message: 'invalid_media_payload' } } },
    });

    await expect(new SupabaseChatV2Repository(client).sendMediaMessage('c_1', { type: 'gif' })).rejects.toMatchObject({
      code: 'invalid_media_payload',
    });
  });
});

describe('SupabaseChatV2Repository.listMessageReactions', () => {
  it('reads the reactions of the listed messages', async () => {
    const { client, calls } = createFakeClient({
      tables: { message_reactions: { data: [{ message_id: 'm_1', user_id: 'u_2', reaction_type: 'laugh' }], error: null } },
    });

    const rows = await new SupabaseChatV2Repository(client).listMessageReactions(['m_1', 'm_2']);

    expect(calls[0]?.filters).toContainEqual(['in', 'message_id', ['m_1', 'm_2']]);
    expect(rows).toEqual([{ messageId: 'm_1', userId: 'u_2', reactionType: 'laugh' }]);
  });

  it('makes no call for an empty list', async () => {
    const { client, calls } = createFakeClient();

    expect(await new SupabaseChatV2Repository(client).listMessageReactions([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('reports a missing table as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      tables: { message_reactions: { data: null, error: { code: 'PGRST205', message: 'not in the schema cache' } } },
    });

    await expect(new SupabaseChatV2Repository(client).listMessageReactions(['m_1'])).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
