// KC#869 — unread badge via RPC + Realtime Broadcast user:<id>:notifications.
// Shares the react-query cache with the inbox screen so badge and list stay in sync.

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { container, supabase } from '../lib/container';

/**
 * The member's unread notifications from the shared query cache, without a realtime
 * subscription of its own: for a second reader (the app icon badge) next to the bell.
 */
export function useUnreadNotificationCount(userId: string | null | undefined): number {
  const query = useQuery({
    queryKey: ['notification-inbox-unread', userId],
    queryFn: () => container.notificationInbox.unreadCount(),
    enabled: Boolean(userId),
    retry: false,
  });
  return userId ? (query.data ?? 0) : 0;
}

export function useNotificationInboxBadge(userId: string | null | undefined): number {
  const qc = useQueryClient();
  const count = useUnreadNotificationCount(userId);

  useEffect(() => {
    if (!userId) return;
    const topic = `user:${userId}:notifications`;
    const channel = supabase
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'badge' }, (payload) => {
        const count = (payload.payload as { unread_count?: number })?.unread_count;
        if (typeof count === 'number') qc.setQueryData(['notification-inbox-unread', userId], count);
        else void qc.invalidateQueries({ queryKey: ['notification-inbox-unread', userId] });
        void qc.invalidateQueries({ queryKey: ['notification-inbox', userId] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  return count;
}
