// app/apps/mobile/src/components/admin/content/PostSearchRow.tsx
// FR-ADMIN-019 — single row for the admin posts search.
// V2-ADMIN-POSTS-6 — inline "Remove" / "Restore" affordance so admins can act
// straight from the search results instead of opening every post detail.
import { memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  type AdminPermission,
  type AdminRole,
  hasPermission,
  type AdminPostSearchResult,
} from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { Chip } from '../../ui/Chip';
import { useAdminRoles } from '../../../hooks/useAdminRoles';
import { container } from '../../../lib/container';
import { confirmAction as platformConfirm } from '../../../services/platformConfirm';
import { useLocaleBundle, type LocaleBundle } from '../../../i18n/useLocaleBundle';
import { adminPostActions } from '../../../lib/moderation/postModeration';

export interface PostSearchRowProps {
  readonly row: AdminPostSearchResult;
}

function statusTone(status: string): 'success' | 'warning' | 'error' | 'muted' {
  if (status === 'open') return 'success';
  if (status === 'closed_delivered') return 'muted';
  if (status === 'removed_admin' || status === 'expired') return 'error';
  return 'warning';
}

function confirmAction(message: string, L: LocaleBundle): Promise<boolean> {
  return platformConfirm(L.admin.tasks.detail.confirmTitle, message, {
    confirmLabel: L.admin.tasks.detail.confirmOk,
    cancelLabel:  L.admin.tasks.detail.cancel,
  });
}

function PostSearchRowInner({ row }: PostSearchRowProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const tone = statusTone(row.status);
  const { roles } = useAdminRoles();
  const queryClient = useQueryClient();
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);
  const [busy, setBusy] = useState(false);

  const { remove: canRemove, restore: canRestore } = adminPostActions(row.status, {
    canRemove: can('reports.confirm_or_dismiss'),
    canRestore: can('reports.restore_target'),
  });

  async function doRemove() {
    const ok = await confirmAction(L.admin.content.postInline.confirmRemove, L);
    if (!ok) return;
    setBusy(true);
    try {
      await container.adminRemovePost.execute({ postId: row.postId });
      void queryClient.invalidateQueries({ queryKey: ['admin.search.posts'] });
    } finally {
      setBusy(false);
    }
  }

  async function doRestore() {
    const ok = await confirmAction(L.admin.content.postInline.confirmRestore, L);
    if (!ok) return;
    setBusy(true);
    try {
      await container.restoreTarget.execute({ targetType: 'post', targetId: row.postId });
      void queryClient.invalidateQueries({ queryKey: ['admin.search.posts'] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      style={styles.root}
      onPress={() => router.push({ pathname: '/post/[id]', params: { id: row.postId } })}
    >
      <View style={styles.main}>
        <Text style={styles.title} numberOfLines={2}>
          {row.title ?? L.admin.content.untitled}
        </Text>
        <View style={styles.metaRow}>
          {row.ownerDisplayName && (
            <Text style={styles.meta} numberOfLines={1}>
              {L.admin.content.byOwner(row.ownerDisplayName)}
            </Text>
          )}
          <Chip
            variant="tag"
            tone={tone}
            label={
              L.admin.content.postStatus[row.status as keyof LocaleBundle['admin']['content']['postStatus']]
                ?? row.status
            }
            size="sm"
          />
        </View>
      </View>
      {canRemove && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={(e) => { e.stopPropagation(); void doRemove(); }}
          style={[styles.actionBtnRemove, busy && styles.actionBtnDisabled]}
        >
          <Text style={styles.actionTextRemove}>{L.admin.content.postInline.remove}</Text>
        </Pressable>
      )}
      {canRestore && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={(e) => { e.stopPropagation(); void doRestore(); }}
          style={[styles.actionBtnRestore, busy && styles.actionBtnDisabled]}
        >
          <Text style={styles.actionTextRestore}>{L.admin.content.postInline.restore}</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.md, paddingHorizontal: spacing.base,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  main:       { flex: 1, gap: spacing.xs },
  title:      { ...typography.body, ...typography.semiBold },
  metaRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  meta:       { ...typography.caption, opacity: 0.6, flex: 1 },
  actionBtnRemove:  { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.xs, backgroundColor: colors.errorLight },
  actionTextRemove: { ...typography.caption, ...typography.bold, color: colors.error },
  actionBtnRestore:  { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.xs, backgroundColor: colors.successLight },
  actionTextRestore: { ...typography.caption, ...typography.bold, color: colors.success },
  actionBtnDisabled: { opacity: 0.5 },
}));

export const PostSearchRow = memo(PostSearchRowInner);
