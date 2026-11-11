// KC#869 — in-app notification center (read/unread, deep links through the push allowlist).

import React, { useCallback, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import { useAuthStore } from '../../src/store/authStore';
import { container } from '../../src/lib/container';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { rowDirectionStart } from '../../src/lib/rtlLayout';
import { formatRelativeChatTime } from '../../src/lib/formatRelativeChatTime';
import { groupInboxByDay } from '../../src/lib/notificationInboxView';
import { NotificationInboxRow } from '../../src/components/notifications/NotificationInboxRow';
import { resolveInboxRoute } from '../../src/lib/notifications/inboxRoute';
import { EmptyState } from '../../src/components/EmptyState';
import { KcFlashList } from '../../src/components/lists/KcFlashList';
import { SimpleRowListSkeleton } from '../../src/components/skeletons/SimpleRowListSkeleton';

const notificationKeyExtractor = (entry: { key: string }) => entry.key;

export default function NotificationInboxScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const router = useRouter();
  const userId = useAuthStore((s) => s.session?.userId);
  const qc = useQueryClient();
  const shellStackOptions = useShellStackScreenOptions();
  const { colors } = useTheme();

  const query = useQuery({
    queryKey: ['notification-inbox', userId],
    queryFn: () => container.notificationInbox.list({ limit: 40 }),
    enabled: Boolean(userId),
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const items = useMemo(() => groupInboxByDay(rows), [rows]);
  const hasUnread = rows.some((r) => !r.readAt);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['notification-inbox', userId] }),
      qc.invalidateQueries({ queryKey: ['notification-inbox-unread', userId] }),
    ]);
  }, [qc, userId]);

  const onMarkAll = useCallback(async () => {
    await container.notificationInbox.markAllRead();
    await refreshAll();
  }, [refreshAll]);

  const onOpen = useCallback(
    async (inboxId: string, data: Record<string, unknown>, readAt: string | null) => {
      if (!readAt) {
        await container.notificationInbox.markRead(inboxId);
        await refreshAll();
      }
      // Same rule as a push tap: the route comes from the row's kind, never from data.route as-is.
      const kind = rows.find((row) => row.inboxId === inboxId)?.kind ?? '';
      const link = resolveInboxRoute(kind, data);
      if (link) router.push(link as never);
    },
    [refreshAll, router, rows],
  );

  const renderItem = useCallback(
    ({ item: entry }: { item: (typeof items)[number] }) => {
      if (entry.type === 'header') {
        return (
          <Text style={styles.sectionTitle}>
            {t(entry.section === 'today' ? 'notifications.inboxToday' : 'notifications.inboxEarlier')}
          </Text>
        );
      }
      const item = entry.item;
      const args = item.bodyArgs as Record<string, string>;
      return (
        <NotificationInboxRow
          inboxId={item.inboxId}
          data={item.data}
          readAt={item.readAt}
          kind={item.kind}
          title={t(item.titleKey, args)}
          body={t(item.bodyKey, args)}
          time={formatRelativeChatTime(item.createdAt)}
          groupHint={item.groupCount > 1 ? t('notifications.inboxGrouped', { count: item.groupCount }) : undefined}
          unread={!item.readAt}
          onOpen={onOpen}
        />
      );
    },
    [onOpen, styles.sectionTitle, t],
  );

  return (
    <View style={styles.container} testID="notification-inbox-screen">
      <Stack.Screen
        options={{
          ...shellStackOptions,
          headerTitle: t('notifications.inboxTitle'),
        }}
      />
      <KcFlashList
        style={styles.flex}
        contentInsetAdjustmentBehavior="automatic"
        refreshing={query.isRefetching}
        onRefresh={() => void refreshAll()}
        ListHeaderComponent={
          hasUnread ? (
            <View style={styles.toolbar}>
              <Pressable
                style={styles.markAllBtn}
                onPress={() => void onMarkAll()}
                accessibilityRole="button"
                testID="notification-inbox-mark-all"
              >
                <Ionicons name="checkmark-done-outline" size={iconSize.sm} color={colors.primary} />
                <Text style={styles.markAll}>{t('notifications.inboxMarkAll')}</Text>
              </Pressable>
            </View>
          ) : null
        }
        data={items}
        keyExtractor={notificationKeyExtractor}
        estimatedItemSize={72}
        contentContainerStyle={styles.list}
        renderItem={renderItem}
        ListEmptyComponent={
          query.isLoading && !query.data ? (
            <SimpleRowListSkeleton rows={8} rowHeight={72} />
          ) : query.isError ? (
            <Pressable onPress={() => void query.refetch()} accessibilityRole="button">
              <EmptyState icon="cloud-offline-outline" title={t('notifications.inboxError')} />
            </Pressable>
          ) : (
            <EmptyState
              icon="notifications-off-outline"
              title={t('notifications.inboxEmpty')}
              subtitle={t('notifications.inboxEmptySubtitle')}
            />
          )
        }
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  toolbar: {
    paddingVertical: spacing.sm,
    flexDirection: rowDirectionStart,
    justifyContent: 'flex-end',
  },
  markAllBtn: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  markAll: { ...typography.caption, color: colors.primary, ...typography.semiBold },
  list: { paddingHorizontal: spacing.base, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  sectionTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    ...typography.semiBold,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textAlign: rtlTextAlignStart,
  },
}));
