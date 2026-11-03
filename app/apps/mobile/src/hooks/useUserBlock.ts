// Apple 1.2 — block / unblock another user from their profile menu.
// Server side (public.blocks + is_blocked predicates) hides content both ways
// and drops follows; the client only toggles the row and refreshes caches.
import { useCallback, useMemo, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { container } from '../lib/container';
import { useAuthStore } from '../store/authStore';

function confirmAction(title: string, body: string, cta: string, cancel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const w = globalThis as unknown as { confirm: (m: string) => boolean };
    return Promise.resolve(w.confirm(`${title}\n\n${body}`));
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: cancel, style: 'cancel', onPress: () => resolve(false) },
        { text: cta, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function notify(msg: string) {
  if (Platform.OS === 'web') (globalThis as unknown as { alert: (m: string) => void }).alert(msg);
  else Alert.alert('', msg);
}

export function useUserBlock(targetUserId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.session?.userId);
  const [busy, setBusy] = useState(false);
  const enabled = Boolean(me && targetUserId && me !== targetUserId);
  const key = useMemo(() => ['user-block', me, targetUserId], [me, targetUserId]);
  const { data: isBlocked = false } = useQuery({
    queryKey: key,
    queryFn: () => container.blockRepo.isBlocking(me!, targetUserId),
    enabled,
  });

  // Resolves true when the block state changed, so a caller can leave a screen the pair can no
  // longer share (a chat, the other member's listing).
  const toggle = useCallback(async (): Promise<boolean> => {
    if (!enabled || busy) return false;
    const next = !isBlocked;
    const ok = await confirmAction(
      t(next ? 'moderation.block.confirmBlockTitle' : 'moderation.block.confirmUnblockTitle'),
      t(next ? 'moderation.block.confirmBlockBody' : 'moderation.block.confirmUnblockBody'),
      t(next ? 'moderation.block.block' : 'moderation.block.unblock'),
      t('moderation.actions.cancel'),
    );
    if (!ok) return false;
    setBusy(true);
    try {
      await container.setUserBlocked.execute({ blockerId: me!, targetUserId, blocked: next });
      queryClient.setQueryData(key, next);
      await queryClient.invalidateQueries();
      notify(t(next ? 'moderation.block.blockedToast' : 'moderation.block.unblockedToast'));
      return true;
    } catch {
      notify(t('moderation.block.failed'));
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, enabled, isBlocked, key, me, queryClient, t, targetUserId]);

  return { isBlocked, canBlock: enabled, busy, toggle };
}
