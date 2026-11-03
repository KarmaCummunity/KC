import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { container } from '../lib/container';
import { confirmAction } from '../services/platformConfirm';
import { useAuthStore } from '../store/authStore';

/**
 * FR-DONATE-011 — written cancellation request for a KC standing order.
 *
 * The standing order lives at the payment provider, so the app cannot stop it
 * itself. Instead the donor confirms, a fixed request is posted to the support
 * thread (FR-CHAT-007) — giving both sides a timestamped written notice — and
 * the donor lands in that chat, where the team confirms the cancellation.
 */
export function useKcStandingOrderCancelRequest() {
  const { t } = useTranslation();
  const router = useRouter();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const request = useCallback(async () => {
    if (!userId || busy) return;
    const confirmed = await confirmAction(t('supportKc.cancelConfirmTitle'), t('supportKc.cancelConfirmBody'), {
      confirmLabel: t('supportKc.cancelConfirm'),
    });
    if (!confirmed) return;
    setBusy(true);
    setFailed(false);
    try {
      const chat = await container.getSupportThread.execute({ userId });
      await container.sendMessage.execute({
        chatId: chat.chatId,
        senderId: userId,
        body: t('supportKc.cancelMessage'),
      });
      router.push({ pathname: '/chat/[id]', params: { id: chat.chatId } });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [busy, router, t, userId]);

  return { canRequest: userId !== null, busy, failed, request };
}
