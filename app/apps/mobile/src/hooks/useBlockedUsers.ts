// useBlockedUsers — FR-MOD-004: the signed-in member's blocked users and the unblock action for
// the Blocked Users screen. Unblocking asks first, removes the row server-side (visibility comes
// back, follows do not, AC2–AC4) and refreshes every cached surface, since feeds, profiles and
// chats all change once the pair can see each other again.

import { useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BlockedUser } from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
import { container } from '../lib/container';

import { useAuthStore } from '../store/authStore';

/** Confirm dialog (window.confirm on web); resolves true when the member confirms. */
function confirmUnblock(title: string, body: string, cta: string, cancel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${body}`));
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: cancel, style: 'cancel', onPress: () => resolve(false) },
        { text: cta, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** One-line notice (window.alert on web). */
function notify(message: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(message);
    return;
  }
  Alert.alert('', message);
}

export const BLOCKED_USERS_QUERY_KEY = 'blocked-users';

export function useBlockedUsers() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.session?.userId ?? null);
  // The member whose unblock is running, so their row can disable its button.
  const [busyId, setBusyId] = useState<string | null>(null);

  // M01: the backend cannot list blocked members yet. That is the degrade rule's empty state, kept
  // apart from "you blocked nobody" so the screen can say so (`unavailable`).
  const query = useQuery({
    queryKey: [BLOCKED_USERS_QUERY_KEY, me],
    queryFn: async (): Promise<{ users: BlockedUser[]; unavailable: boolean }> => {
      try {
        return { users: await container.listMyBlockedUsers.execute(), unavailable: false };
      } catch (error) {
        if (error instanceof BackendUnavailableError) return { users: [], unavailable: true };
        throw error;
      }
    },
    enabled: Boolean(me),
  });

  const unblock = useCallback(
    async (user: BlockedUser) => {
      if (!me || busyId) return;
      const ok = await confirmUnblock(
        t('moderation.block.confirmUnblockTitle'),
        t('moderation.block.confirmUnblockBody'),
        t('moderation.block.unblock'),
        t('moderation.actions.cancel'),
      );
      if (!ok) return;
      setBusyId(user.userId);
      try {
        await container.setUserBlocked.execute({ blockerId: me, targetUserId: user.userId, blocked: false });
        await queryClient.invalidateQueries();
        notify(t('moderation.block.unblockedToast'));
      } catch {
        notify(t('moderation.block.failed'));
      } finally {
        setBusyId(null);
      }
    },
    [busyId, me, queryClient, t],
  );

  return {
    users: query.data?.users ?? [],
    unavailable: query.data?.unavailable ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    busyId,
    unblock,
  };
}
