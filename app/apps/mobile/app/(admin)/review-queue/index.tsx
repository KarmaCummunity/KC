// FR-MOD-008 AC2–AC3 — the staff review queue (moderation_queue): targets the report threshold
// acted on, posts reopened suspiciously often, keyword hits and manual flags, oldest first.
// Staff open the target to restore or remove it, take an entry, and mark it handled.
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { hasPermission, type AdminRole } from '@kc/domain';
import type { ModerationQueueEntry } from '@kc/application';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { REVIEW_QUEUE_QUERY_KEY, useReviewQueue } from '../../../src/hooks/useStaffInboxes';
import { ReviewQueueRow, type ReviewQueueAction } from '../../../src/components/admin/staff/ReviewQueueRow';
import { AdminListEmpty } from '../../../src/components/admin/AdminListEmpty';
import { KcFlashList } from '../../../src/components/lists/KcFlashList';
import { showAdminToast } from '../../../src/components/chat/system/adminActions';
import { container } from '../../../src/lib/container';
import { useAuthStore } from '../../../src/store/authStore';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

const entryKey = (entry: ModerationQueueEntry) => entry.entryId;

/** A post opens itself; anything else opens its report case, where the restore and remove actions live. */
function openTarget(entry: ModerationQueueEntry): void {
  if (entry.targetType === 'post' && entry.reason !== 'report_threshold') {
    router.push({ pathname: '/post/[id]', params: { id: entry.targetId } });
    return;
  }
  router.push({
    pathname: '/(admin)/reports/[caseId]',
    params: { caseId: encodeURIComponent(`${entry.targetType}:${entry.targetId}`) },
  });
}

export default function ReviewQueueScreen() {
  const styles = useStyles();
  const t = useLocaleBundle().admin.reviewQueue;
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.session?.userId ?? null);
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  // The server lets moderators and above take and resolve entries.
  const enabled = hasPermission(roles as readonly AdminRole[], 'reports.confirm_or_dismiss');
  const q = useReviewQueue(enabled);
  const entries = useMemo(() => q.data?.pages.flatMap((p) => p.entries) ?? [], [q.data?.pages]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = useCallback(async (entry: ModerationQueueEntry, action: ReviewQueueAction) => {
    if (action === 'open') {
      openTarget(entry);
      return;
    }
    setBusyId(entry.entryId);
    try {
      if (action === 'take') await container.assignQueueEntry.execute({ entryId: entry.entryId });
      else await container.resolveQueueEntry.execute({ entryId: entry.entryId });
    } catch {
      showAdminToast(t.actionFailed);
    } finally {
      setBusyId(null);
      void queryClient.invalidateQueries({ queryKey: [REVIEW_QUEUE_QUERY_KEY] });
    }
  }, [queryClient, t.actionFailed]);

  const renderItem = useCallback(
    ({ item }: { item: ModerationQueueEntry }) => (
      <ReviewQueueRow
        entry={item}
        myUserId={me}
        busy={busyId === item.entryId}
        onAction={(entry, action) => { void act(entry, action); }}
      />
    ),
    [act, busyId, me],
  );

  if (rolesLoading) return <View style={styles.center}><Text>{t.loading}</Text></View>;
  if (!enabled) return <View style={styles.center}><Text style={styles.title}>{t.forbiddenTitle}</Text></View>;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t.title}</Text>
      <Text style={styles.subtitle}>{t.subtitle}</Text>
      <KcFlashList
        data={entries}
        keyExtractor={entryKey}
        estimatedItemSize={120}
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
