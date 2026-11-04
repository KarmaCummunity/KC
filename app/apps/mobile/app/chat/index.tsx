// Chat list (Inbox) — FR-CHAT-001, FR-CHAT-016, FR-CHAT-017 ("+" starts a conversation).
import React, { useCallback, useMemo, useState } from 'react';
import { View, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { ListRenderItem } from 'react-native';
import { ChatError, type ChatWithPreview } from '@kc/application';
import { makeUseStyles, spacing } from '@kc/ui';
import { FilterSearchBar } from '../../src/components/filterKit/FilterSearchBar';
import { useAuthStore } from '../../src/store/authStore';
import { container } from '../../src/lib/container';
import { markNeedFreshThreadWith } from '../../src/lib/chatNavigationPrefs';
import { EmptyState, EmptyStateActions } from '../../src/components/EmptyState';
import { PrimaryButton } from '../../src/components/ui/Buttons';
import { KcRefreshControl } from '../../src/components/lists/KcRefreshControl';
import { HideChatConfirmModal } from '../../src/components/HideChatConfirmModal';
import { InboxChatRow, InboxChatRowSeparator } from '../../src/components/chat/InboxChatRow';
import { InboxListSkeleton } from '../../src/components/skeletons/InboxListSkeleton';
import { NotifyModal } from '../../src/components/NotifyModal';
import { KcFlashList } from '../../src/components/lists/KcFlashList';
import { useChatInboxQuery } from '../../src/hooks/useChatInboxQuery';
import { useChatStore } from '../../src/store/chatStore';
import { useDetailStackScreenOptions } from '../../src/navigation/detailStackScreenOptions';
import { queryClient } from '../../src/lib/queryPersist';
import { chatInboxQueryKey } from '../../src/lib/chatInboxQuery';
import { NativeStackHeaderTitle } from '../../src/navigation/NativeStackHeaderTitle';
import { nativeStackHeaderRightIconOnly } from '../../src/navigation/nativeHeaderIconOnly';
import { NewChatHeaderButton } from '../../src/components/chat/NewChatHeaderButton';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

const PAGE = 30;
const chatInboxKeyExtractor = (c: ChatWithPreview) => c.chatId;

export default function ChatListScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const styles = useChatListStyles();
  const detailOptions = useDetailStackScreenOptions();
  const userId = useAuthStore((s) => s.session?.userId);
  const inboxQuery = useChatInboxQuery(userId);
  const inbox = inboxQuery.data?.chats;
  const [q, setQ] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [hideTarget, setHideTarget] = useState<{ chatId: string; otherUserId: string | null } | null>(
    null,
  );
  const [hideBusy, setHideBusy] = useState(false);
  const [hideErrorMsg, setHideErrorMsg] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    if (!userId) return;
    await inboxQuery.refetch();
  }, [userId, inboxQuery]);

  const filtered = useMemo(() => {
    if (!inbox) return [];
    const needle = q.trim().toLowerCase();
    const list = needle
      ? inbox.filter((c) => (c.otherParticipant?.displayName ?? '').toLowerCase().startsWith(needle))
      : inbox;
    return list.slice(0, visible);
  }, [inbox, q, visible]);

  const handleOpen = useCallback(
    (chatId: string) => router.push(`/chat/${chatId}`),
    [router],
  );
  const handleRequestHide = useCallback(
    (chatId: string, otherUserId: string | null) => setHideTarget({ chatId, otherUserId }),
    [],
  );
  const renderItem = useCallback<ListRenderItem<ChatWithPreview>>(
    ({ item }) => (
      <InboxChatRow item={item} onOpen={handleOpen} onRequestHide={handleRequestHide} />
    ),
    [handleOpen, handleRequestHide],
  );
  const handleEndReached = useCallback(() => setVisible((v) => v + PAGE), []);

  const showSkeleton = inboxQuery.isLoading && !inbox;

  return (
    <View style={styles.container} testID="chat-inbox-screen">
      <Stack.Screen
        options={{
          ...detailOptions,
          headerTitle: () => <NativeStackHeaderTitle title={t('chat.title')} />,
          headerLargeTitle: false,
          // FR-CHAT-017 AC1 — start a conversation from the inbox.
          ...nativeStackHeaderRightIconOnly(() => <NewChatHeaderButton />),
        }}
      />

      <FilterSearchBar
        style={styles.searchWrap}
        value={q}
        onChangeText={setQ}
        placeholder={t('chat.searchPlaceholder')}
      />

      {showSkeleton ? (
        <InboxListSkeleton />
      ) : (
        <KcFlashList
          data={filtered}
          keyExtractor={chatInboxKeyExtractor}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.6}
          estimatedItemSize={76}
          contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'automatic' : undefined}
          refreshControl={
            <KcRefreshControl refreshing={inboxQuery.isRefetching} onRefresh={onRefresh} />
          }
          renderItem={renderItem}
          ItemSeparatorComponent={InboxChatRowSeparator}
          ListEmptyComponent={
            inboxQuery.isError && !inbox ? (
              <EmptyState
                icon="cloud-offline-outline"
                title={t('general.errorTitle')}
                subtitle={t('errorBoundary.body')}
                action={
                  <PrimaryButton
                    testID="chat-inbox-retry"
                    label={t('general.retry')}
                    size="md"
                    onPress={() => void inboxQuery.refetch()}
                  />
                }
              />
            ) : q.trim() ? (
              <EmptyState icon="search-outline" title={t('chat.noChats')} subtitle={t('chat.noChatsDesc')} />
            ) : (
              <EmptyState
                icon="chatbubbles-outline"
                title={t('emptyStates.chatTitle')}
                subtitle={t('emptyStates.chatBody')}
                action={
                  <EmptyStateActions
                    primary={{ label: t('emptyStates.chatCta'), onPress: () => router.push('/(tabs)') }}
                    secondary={{
                      label: t('emptyStates.chatWorldsCta'),
                      onPress: () => router.push('/(tabs)/donations'),
                    }}
                  />
                }
              />
            )
          }
        />
      )}

      <HideChatConfirmModal
        visible={hideTarget != null}
        loading={hideBusy}
        onCancel={() => setHideTarget(null)}
        onConfirm={async () => {
          const target = hideTarget;
          if (!target || !userId) return;
          setHideBusy(true);
          try {
            await container.hideChatFromInbox.execute({ chatId: target.chatId });
            if (target.otherUserId) markNeedFreshThreadWith(target.otherUserId);
            await useChatStore.getState().refreshInbox(userId, container.chatRepo);
            void queryClient.invalidateQueries({ queryKey: chatInboxQueryKey(userId) });
            setHideTarget(null);
          } catch (err) {
            const msg =
              err instanceof ChatError && err.code === 'support_thread_not_hideable'
                ? t('chat.hideErrorSupport')
                : t('chat.hideErrorGeneric');
            setHideErrorMsg(msg);
          } finally {
            setHideBusy(false);
          }
        }}
      />
      <NotifyModal visible={hideErrorMsg !== null} title={t('chat.errorTitle')} message={hideErrorMsg ?? ''} onDismiss={() => setHideErrorMsg(null)} />
    </View>
  );
}

const useChatListStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  searchWrap: { padding: spacing.sm, backgroundColor: colors.surface, marginBottom: 0 },
}));
