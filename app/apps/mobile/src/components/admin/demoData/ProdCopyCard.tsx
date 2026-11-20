// FR-ADMIN-037 AC13 — the "Copied from production" card of the Demo data screen: how many
// members, posts and nonprofits the weekly anonymized copy holds, when it last ran, and "Delete
// copied data" behind a confirmation. The card runs its own query, so the demo-data part of the
// screen is unaffected by it. Where the production-copy tools are not installed (kc-prod) it
// renders nothing: there is no copy to talk about.
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasProdCopyData, isDemoDataError, type ProdCopyStatus } from '@kc/domain';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { container } from '../../../lib/container';
import { demoDataErrorKey } from '../../../lib/admin/demoDataErrorKey';
import { confirmAction } from '../../../services/platformConfirm';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { textAlignStart } from '../../../lib/rtlLayout';
import { DangerButton } from '../../ui/Buttons';

const STATUS_KEY = ['admin.demoData.prodCopy'] as const;

/** The time of the last copy in the reader's language, e.g. "21 Nov 2026, 22:45". */
function formatCopiedAt(iso: string, language: string): string {
  return new Date(iso).toLocaleString(language.startsWith('he') ? 'he-IL' : 'en-IL', {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

export function ProdCopyCard() {
  const styles = useStyles();
  const bundle = useLocaleBundle().admin.demoData;
  const t = bundle.prodCopy;
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => container.getProdCopyStatus.execute(),
    staleTime: 30_000,
    // A refusal (not installed, forbidden) does not change by asking again.
    retry: (count, err) => !isDemoDataError(err) && count < 2,
  });

  const remove = useMutation({
    mutationFn: () => container.deleteProdCopy.execute(),
    onSuccess: (r) => setNotice(t.deleted(r.members, r.posts, r.organizations)),
    onError: (err) => setFailure(bundle.errors[demoDataErrorKey(err)]),
    // Copied members and posts appear in feeds, searches and profiles: every list may be stale.
    onSettled: () => { void queryClient.invalidateQueries(); },
  });

  // kc-prod (no tools) and an admin the server refuses: nothing to show here; the screen guard
  // already explains a refusal.
  if (status.isError && ['notInstalled', 'forbidden'].includes(demoDataErrorKey(status.error))) return null;
  // After a failed refresh React Query still holds the previous answer. It is no longer proven
  // current, so the card shows the error alone: no old counts, no old time, no delete.
  const data = status.isError ? undefined : status.data;

  const onDelete = async (s: ProdCopyStatus) => {
    const ok = await confirmAction(t.confirmTitle, t.confirmBody(s.members, s.posts), {
      confirmLabel: t.confirmOk, cancelLabel: t.confirmCancel, destructive: true,
    });
    if (!ok) return;
    setNotice(null);
    setFailure(null);
    remove.mutate();
  };

  return (
    <View style={styles.card} testID="admin-prod-copy">
      <Text style={styles.title}>{t.title}</Text>
      <Text style={styles.muted}>{t.subtitle}</Text>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {failure ? <Text style={styles.error}>{failure}</Text> : null}
      {status.isError ? <Text style={styles.error}>{bundle.errors[demoDataErrorKey(status.error)]}</Text> : null}
      {data ? (
        <>
          <Text style={styles.muted} testID="admin-prod-copy-last">
            {data.lastCopiedAt ? t.lastCopied(formatCopiedAt(data.lastCopiedAt, i18n.language)) : t.neverCopied}
          </Text>
          {hasProdCopyData(data) ? (
            <>
              <View style={styles.row}>
                {([
                  [t.members, data.members], [t.posts, data.posts], [t.organizations, data.organizations],
                  [t.follows, data.follows], [t.savedPosts, data.savedPosts],
                ] as const).map(([label, value]) => (
                  <View key={label} style={styles.tile}>
                    <Text style={styles.value}>{String(value)}</Text>
                    <Text style={styles.label}>{label}</Text>
                  </View>
                ))}
              </View>
              <DangerButton
                label={remove.isPending ? t.deleting : t.deleteButton}
                onPress={() => { void onDelete(data); }}
                disabled={remove.isPending}
                fullWidth
                testID="admin-prod-copy-delete"
              />
            </>
          ) : (
            <Text style={styles.muted}>{t.empty}</Text>
          )}
        </>
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: spacing.sm,
  },
  title: { fontSize: typography.h3.fontSize, ...typography.bold, color: colors.textPrimary, textAlign: textAlignStart() },
  muted: { color: colors.textSecondary, fontSize: typography.bodySmall.fontSize, textAlign: textAlignStart() },
  notice: { color: colors.success, fontSize: typography.body.fontSize, ...typography.semiBold, textAlign: textAlignStart() },
  error: { color: colors.error, fontSize: typography.bodySmall.fontSize, textAlign: textAlignStart() },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1, flexBasis: 120, minWidth: 100, backgroundColor: colors.background, borderRadius: radius.sm,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.border, gap: spacing.xs,
  },
  value: { fontSize: typography.h3.fontSize, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  label: { fontSize: typography.bodySmall.fontSize, ...typography.semiBold, color: colors.textSecondary, textAlign: textAlignStart() },
}));
