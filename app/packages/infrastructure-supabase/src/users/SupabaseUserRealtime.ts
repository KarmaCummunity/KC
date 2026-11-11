// Supabase adapter for IUserRealtime. postgres_changes UPDATE on the caller's own
// public.users row. RLS filters server-side (publication from 0007; replica
// identity full from 0188). Mirrors the SupabaseChatRealtime house pattern.
// FR-KARMA-009.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IUserRealtime, Unsubscribe } from '@kc/application';
import type { User } from '@kc/domain';
import type { Database } from '../database.legacy.types';
import { mapUserRow, type UserRow } from './mapUserRow';

export class SupabaseUserRealtime implements IUserRealtime {
  constructor(private readonly client: SupabaseClient<Database>) {}

  subscribeToSelf(
    userId: string,
    onChange: (user: User) => void,
    onError?: (err: Error) => void,
  ): Unsubscribe {
    const topic = `me:${userId}:${Date.now()}`;
    const channel = this.client
      .channel(topic)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `user_id=eq.${userId}` },
        (payload) => onChange(mapUserRow(payload.new as UserRow)),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          onError?.(new Error(`user channel ${status.toLowerCase()}`));
        }
      });
    return () => {
      void this.client.removeChannel(channel);
    };
  }
}
