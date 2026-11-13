// FR-CHAT-007 / FR-MOD-002 — the staff support inbox: every member's support thread with
// messages, newest first. Opening one joins it as its support agent (admin_join_support_thread,
// migration 0015), after which it also sits in the staff member's own inbox.
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { hasPermission, type AdminRole } from '@kc/domain';
import type { SupportThreadSummary } from '@kc/application';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { SUPPORT_INBOX_QUERY_KEY, useSupportInbox } from '../../../src/hooks/useStaffInboxes';
import { SupportThreadRow } from '../../../src/components/admin/staff/SupportThreadRow';
import { AdminListEmpty } from '../../../src/components/admin/AdminListEmpty';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';
import { showAdminToast } from '../../../src/components/chat/system/adminActions';
import { container } from '../../../src/lib/container';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

const threadKey = (thread: SupportThreadSummary) => thread.chatId;

export default function SupportInboxScreen() {
  const styles = useStyles();
  const t = useLocaleBundle().admin.supportInbox;
  const queryClient = useQueryClient();
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const enabled = hasPermission(roles as readonly AdminRole[], 'reports.view');
  const q = useSupportInbox(enabled);
  const threads = useMemo(() => q.data?.pages.flatMap((p) => p.threads) ?? [], [q.data?.pages]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const open = useCallback(async (thread: SupportThreadSummary) => {
    setBusyId(thread.chatId);
    try {
      const chatId = thread.joined ? thread.chatId : await container.joinSupportThread.execute(thread.chatId);
      void queryClient.invalidateQueries({ queryKey: [SUPPORT_INBOX_QUERY_KEY] });
      router.push({ pathname: '/chat/[id]', params: { id: chatId } });
    } catch {
      showAdminToast(t.openFailed);
    } finally {
      setBusyId(null);
    }
  }, [queryClient, t.openFailed]);

  const renderItem = useCallback(
    ({ item }: { item: SupportThreadSummary }) => (
      <SupportThreadRow thread={item} busy={busyId === item.chatId} onOpen={(th) => { void open(th); }} />
    ),
    [busyId, open],
  );

  if (rolesLoading) return <View style={styles.center}><Text>{t.loading}</Text></View>;
  if (!enabled) return <View style={styles.center}><Text style={styles.title}>{t.forbiddenTitle}</Text></View>;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t.title}</Text>
      <Text style={styles.subtitle}>{t.subtitle}</Text>
      <KcFlashList
        data={threads}
        keyExtractor={threadKey}
        estimatedItemSize={64}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onEndReached={() => { if (q.hasNextPage) void q.fetchNextPage(); }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); }} />}
        ListEmptyComponent={q.isLoading ? null : <AdminListEmpty title={t.emptyTitle} hint={t.emptyHint} />}
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1, padding: spacing.md, gap: spacing.xs },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  title: { ...typography.h3, color: colors.textPrimary },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary },
  list: { paddingVertical: spacing.sm, gap: spacing.sm },
}));
