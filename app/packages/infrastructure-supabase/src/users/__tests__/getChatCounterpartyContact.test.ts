import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getChatCounterpartyContact } from '../getChatCounterpartyContact';
import { SupabaseUserRepository } from '../SupabaseUserRepository';

describe('getChatCounterpartyContact & SupabaseUserRepository delegation', () => {
  it('calls get_chat_counterparty_contact RPC and returns trimmed phone number', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: '  +972501234567  ', error: null });
    const client = { rpc } as unknown as SupabaseClient;

    const phone = await getChatCounterpartyContact(client, 'chat_123');

    expect(rpc).toHaveBeenCalledWith('get_chat_counterparty_contact', {
      p_chat_id: 'chat_123',
    });
    expect(phone).toBe('+972501234567');
  });

  it('returns null when data is null or undefined', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as SupabaseClient;

    const phone = await getChatCounterpartyContact(client, 'chat_123');
    expect(phone).toBeNull();
  });

  it('returns null when phone is empty or only whitespace', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: '   ', error: null });
    const client = { rpc } as unknown as SupabaseClient;

    const phone = await getChatCounterpartyContact(client, 'chat_123');
    expect(phone).toBeNull();
  });

  it('throws an error with message when RPC returns an error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    });
    const client = { rpc } as unknown as SupabaseClient;

    await expect(getChatCounterpartyContact(client, 'chat_123')).rejects.toThrow(
      'get_chat_counterparty_contact: permission denied',
    );
  });

  it('SupabaseUserRepository delegates getChatCounterpartyContact to helper', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: '+972509999999', error: null });
    const client = { rpc } as unknown as ConstructorParameters<typeof SupabaseUserRepository>[0];
    const repo = new SupabaseUserRepository(client);

    const phone = await repo.getChatCounterpartyContact('chat_456');
    expect(rpc).toHaveBeenCalledWith('get_chat_counterparty_contact', {
      p_chat_id: 'chat_456',
    });
    expect(phone).toBe('+972509999999');
  });
});
