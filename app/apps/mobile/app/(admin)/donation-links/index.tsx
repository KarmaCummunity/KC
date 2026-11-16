// app/apps/mobile/app/(admin)/donation-links/index.tsx
// D9 (docs/spec/08_organizations.md) — a suggested donation link is shown to everyone only after
// a reviewer approves it. This screen is the review queue: pending links oldest first, with
// approve and reject (an optional note tells the submitter why), plus the decided ones.
// Gated by the 'donation_links.review' permission; the server re-checks the role (0546).
import React, { useCallback, useState } from 'react';
import { Platform, RefreshControl, ScrollView, View } from 'react-native';
import { hasPermission, isDonationLinkAwaitingReview, type AdminRole, type DonationLinkReviewStatus } from '@kc/domain';
import type { DonationLinkReviewItem } from '@kc/application';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { Chip } from '../../../src/components/ui/Chip';
import { DangerButton, PrimaryButton } from '../../../src/components/ui/Buttons';
import { TextField } from '../../../src/components/ui/TextField';
import { useAdminRoles } from '../../../src/hooks/useAdminRoles';
import { useDonationLinkReview } from '../../../src/hooks/useDonationLinkReview';
import { useLocaleBundle } from '../../../src/i18n/useLocaleBundle';
import { useAdminScreenTitle } from '../../../src/components/admin/useAdminScreenTitle';
import { openExternalUrl } from '../../../src/utils/openExternalUrl';
import { adminChipScroll } from '../../../src/components/admin/adminChipScroll';
import { FormScrollView } from '../../../src/components/ui/FormScrollView';
export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

const STATUS_TABS: readonly DonationLinkReviewStatus[] = ['pending', 'approved', 'rejected'];

type Strings = ReturnType<typeof useLocaleBundle>['admin']['donationLinks'];

/** One-line notice (window.alert on web). */
function notify(message: string): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(message);
}

function ReviewRow({
  item,
  busy,
  onDecide,
  t,
  styles,
}: {
  item: DonationLinkReviewItem;
  busy: boolean;
  onDecide: (item: DonationLinkReviewItem, approve: boolean, note: string) => void;
  t: Strings;
  styles: ReturnType<typeof useStyles>;
}) {
  const [note, setNote] = useState('');
  return (
    <View style={styles.row} testID={`donation-link-review-row-${item.id}`}>
      <Text style={styles.name}>{item.displayName}</Text>
      <Text style={styles.url} onPress={() => openExternalUrl(item.url)} numberOfLines={1}>
        {item.url}
      </Text>
      {item.description ? <Text style={styles.meta}>{item.description}</Text> : null}
      <Text style={styles.meta}>
        {`${t.submittedBy} ${item.submitterName ?? t.unknownSubmitter} · ${new Date(item.createdAt).toLocaleDateString()}`}
      </Text>
      {item.reviewStatus === 'rejected' && item.reviewNote ? <Text style={styles.meta}>{item.reviewNote}</Text> : null}
      {isDonationLinkAwaitingReview(item.reviewStatus) ? (
        <>
          <TextField label={t.notePlaceholder} value={note} onChangeText={setNote} maxLength={280} />
          <View style={styles.actions}>
            <PrimaryButton
              testID={`donation-link-approve-${item.id}`}
              label={t.approve}
              size="md"
              disabled={busy}
              onPress={() => onDecide(item, true, note)}
            />
            <DangerButton
              testID={`donation-link-reject-${item.id}`}
              label={t.reject}
              size="md"
              disabled={busy}
              onPress={() => onDecide(item, false, note)}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

export default function DonationLinkReviewScreen() {
  const styles = useStyles();
  const t = useLocaleBundle().admin.donationLinks;
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const allowed = hasPermission(roles as readonly AdminRole[], 'donation_links.review');
  const [tab, setTab] = useState<DonationLinkReviewStatus>('pending');
  const review = useDonationLinkReview(tab, allowed);

  useAdminScreenTitle(t.title);

  const onDecide = useCallback(
    (item: DonationLinkReviewItem, approve: boolean, note: string) => {
      void review.decide(item.id, approve, note).then((ok) => {
        if (!ok) notify(t.actionFailed);
      });
    },
    [review, t.actionFailed],
  );

  if (rolesLoading) return <Text style={styles.message}>{t.loading}</Text>;
  if (!allowed) return <Text style={styles.message}>{t.forbidden}</Text>;

  return (
    <FormScrollView
      contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={review.isRefetching} onRefresh={() => void review.refetch()} />}
    >
      <Text style={styles.meta}>{t.hint}</Text>
      <ScrollView
        horizontal
        style={adminChipScroll.scroll}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.chips, adminChipScroll.content]}
      >
        {STATUS_TABS.map((s) => (
          <Chip key={s} label={t.filters[s]} selected={tab === s} onPress={() => setTab(s)} />
        ))}
      </ScrollView>
      {review.isLoading ? <Text style={styles.message}>{t.loading}</Text> : null}
      {review.isError ? <Text style={styles.message}>{t.loadError}</Text> : null}
      {!review.isLoading && !review.isError && review.items.length === 0 ? (
        <Text style={styles.message}>{t.empty}</Text>
      ) : null}
      {review.items.map((item) => (
        <ReviewRow
          key={item.id}
          item={item}
          busy={review.busyId === item.id}
          onDecide={onDecide}
          t={t}
          styles={styles}
        />
      ))}
    </FormScrollView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  body: { padding: spacing.lg, gap: spacing.md },
  title: { ...typography.h2, color: colors.textPrimary },
  message: { ...typography.body, color: colors.textSecondary, padding: spacing.lg },
  row: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  name: { ...typography.h3, color: colors.textPrimary },
  url: { ...typography.caption, color: colors.primary },
  meta: { ...typography.caption, color: colors.textSecondary },
  actions: { flexDirection: 'row' as const, gap: spacing.sm },
  chips: { gap: spacing.sm },
}));
