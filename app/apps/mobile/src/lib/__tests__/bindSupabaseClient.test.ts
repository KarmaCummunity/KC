import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@kc/infrastructure-supabase';
import { bindSupabaseClient } from '../bindSupabaseClient';

describe('bindSupabaseClient', () => {
  it('creates the real client when the public env is present', () => {
    const client = { auth: {} } as SupabaseClient<Database>;
    const create = vi.fn(() => client);
    expect(bindSupabaseClient(true, create)).toBe(client);
    expect(create).toHaveBeenCalledOnce();
  });

  it('does not create a client when env is missing, and throws on use', () => {
    const create = vi.fn();
    const client = bindSupabaseClient(false, create);
    expect(create).not.toHaveBeenCalled();
    expect(() => client.auth).toThrow(/Supabase configuration missing/);
  });
});
