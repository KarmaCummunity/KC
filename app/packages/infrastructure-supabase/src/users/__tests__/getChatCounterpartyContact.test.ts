import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { getChatCounterpartyContact } from '../getChatCounterpartyContact';
import { SupabaseUserRepository } from '../SupabaseUserRepository';

const answer = (data: unknown) => createFakeClient({ rpc: { chat_counterpart_contact: { data, error: null } } });

describe('getChatCounterpartyContact', () => {
  it('calls chat_counterpart_contact with p_chat_id and returns the trimmed phone number', async () => {
    const { client, calls } = answer('  +972501234567  ');

    const phone = await getChatCounterpartyContact(client, 'chat_123');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'chat_counterpart_contact', args: { p_chat_id: 'chat_123' } });
    expect(phone).toBe('+972501234567');
  });

  it('returns null when the server answers null (no access, support thread, inactive or no phone)', async () => {
    expect(await getChatCounterpartyContact(answer(null).client, 'chat_123')).toBeNull();
  });

  it('returns null when the phone is empty or only whitespace', async () => {
    expect(await getChatCounterpartyContact(answer('   ').client, 'chat_123')).toBeNull();
  });

  it('maps a signed-out caller to the stable reason `unauthenticated`', async () => {
    const { client } = createFakeClient({
      rpc: { chat_counterpart_contact: { data: null, error: { code: '42501', message: 'unauthenticated' } } },
    });

    await expect(getChatCounterpartyContact(client, 'chat_123')).rejects.toMatchObject({ reason: 'unauthenticated' });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      rpc: { chat_counterpart_contact: { data: null, error: { code: 'PGRST202', message: 'not in the schema cache' } } },
    });

    await expect(getChatCounterpartyContact(client, 'chat_123')).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('SupabaseUserRepository delegates to the helper', async () => {
    const { client, calls } = answer('+972509999999');

    const phone = await new SupabaseUserRepository(client).getChatCounterpartyContact('chat_456');

    expect(calls[0]).toMatchObject({ fn: 'chat_counterpart_contact', args: { p_chat_id: 'chat_456' } });
    expect(phone).toBe('+972509999999');
  });
});
