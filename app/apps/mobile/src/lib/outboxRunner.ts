import { AppState, type AppStateStatus } from 'react-native';
import { isPostError, isChatError } from '@kc/application';
import { GivingHandoffError } from '@kc/domain';
import { useOutboxStore, type OutboxItem, type OutboxItemError } from '../store/outboxStore';
import { useNetworkStatusStore } from './networkStatusStore';
import { container } from './container';
import { useChatStore } from '../store/chatStore';
import { getCreatePostUseCase } from '../services/postsComposition';
import { givingHandoffUseCases } from '../services/givingHandoffComposition';
import { queryClient } from './queryPersist';
import { useFeedSessionStore } from '../store/feedSessionStore';
import i18n from '../i18n';

export function calculateBackoffDelay(
  attempts: number,
  baseDelay = 1000,
  maxDelay = 30000,
  jitter = 500,
): number {
  const exponential = Math.min(maxDelay, baseDelay * Math.pow(2, attempts));
  const randomJitter = Math.floor(Math.random() * jitter);
  return exponential + randomJitter;
}

export function isFatalError(err: unknown): boolean {
  if (isPostError(err) || isChatError(err) || err instanceof GivingHandoffError) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes('listing_not_available') ||
    msg.includes('seats_exhausted') ||
    msg.includes('item_already_reserved') ||
    msg.includes('send_to_deleted_user') ||
    msg.includes('forbidden') ||
    msg.includes('not_authenticated')
  ) {
    return true;
  }
  return false;
}

function parseItemError(err: unknown): OutboxItemError {
  const fatal = isFatalError(err);
  const code =
    typeof (err as { code?: unknown })?.code === 'string'
      ? (err as { code: string }).code
      : 'unknown_error';
  const message = err instanceof Error ? err.message : String(err);
  return { code, message, fatal };
}

export async function executeOutboxItem(item: OutboxItem): Promise<void> {
  switch (item.action) {
    case 'send_message': {
      const p = item.payload as {
        chatId: string;
        senderId: string;
        body: string;
        clientId: string;
      };
      const serverMsg = await container.sendMessage.execute({
        chatId: p.chatId,
        senderId: p.senderId,
        body: p.body,
        clientId: p.clientId,
      });
      useChatStore.getState().reconcileSent(p.chatId, p.clientId, serverMsg);
      break;
    }
    case 'create_post': {
      const p = item.payload as unknown as Parameters<
        ReturnType<typeof getCreatePostUseCase>['execute']
      >[0];
      await getCreatePostUseCase().execute(p);
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['openPostsCount'] });
      break;
    }
    case 'reserve_item': {
      const p = item.payload as {
        listingId: string;
        pickupMode?: 'pickup' | 'delivery';
        pickupWindowStart?: string | null;
        pickupWindowEnd?: string | null;
      };
      await givingHandoffUseCases.reserveItem().execute(
        p.listingId,
        p.pickupMode,
        p.pickupWindowStart,
        p.pickupWindowEnd,
        item.idempotencyKey,
      );
      void queryClient.invalidateQueries({ queryKey: ['giving-handoff', p.listingId] });
      break;
    }
    case 'claim_food': {
      const p = item.payload as {
        listingId: string;
        pickupWindowStart?: string | null;
        pickupWindowEnd?: string | null;
      };
      await givingHandoffUseCases.claimFood().execute(
        p.listingId,
        p.pickupWindowStart,
        p.pickupWindowEnd,
        item.idempotencyKey,
      );
      void queryClient.invalidateQueries({ queryKey: ['giving-handoff', p.listingId] });
      break;
    }
    case 'confirm_handoff': {
      const p = item.payload as { handoffId: string };
      await givingHandoffUseCases.confirmItem().execute(p.handoffId);
      break;
    }
  }
}

let isFlushing = false;

export async function flushOutbox(): Promise<void> {
  if (isFlushing) return;
  if (!useNetworkStatusStore.getState().isOnline) return;

  isFlushing = true;
  try {
    const items = useOutboxStore.getState().items.filter((i) => i.status === 'queued');
    for (const item of items) {
      if (!useNetworkStatusStore.getState().isOnline) break;
      useOutboxStore.getState().markInFlight(item.id);
      try {
        await executeOutboxItem(item);
        useOutboxStore.getState().markApplied(item.id);
      } catch (err) {
        const parsed = parseItemError(err);
        if (parsed.fatal) {
          useOutboxStore.getState().markFailed(item.id, parsed);
          if (item.entityType === 'giving_handoff') {
            useFeedSessionStore
              .getState()
              .showEphemeralToast(i18n.t('offlineSync.handoffConflict'), 'error');
          }
        } else {
          useOutboxStore.getState().incrementAttempts(item.id, parsed);
        }
      }
    }
  } finally {
    isFlushing = false;
  }
}

export function initOutboxRunner(): () => void {
  // Flush when transitioning to online
  let wasOnline = useNetworkStatusStore.getState().isOnline;
  const unsubOnline = useNetworkStatusStore.subscribe((state) => {
    if (state.isOnline && !wasOnline) {
      void flushOutbox();
    }
    wasOnline = state.isOnline;
  });

  // Flush on AppState active
  const subAppState = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'active') {
      void flushOutbox();
    }
  });

  // Initial flush if online
  if (wasOnline) {
    void flushOutbox();
  }

  return () => {
    unsubOnline();
    subAppState.remove();
  };
}
