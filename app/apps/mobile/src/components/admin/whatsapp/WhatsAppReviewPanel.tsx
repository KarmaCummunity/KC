// The review queue of WhatsApp bot posts (moderator+): a low-confidence post waits as a draft;
// approving publishes it on its owner's behalf, rejecting leaves the draft with the owner.
import { Pressable, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { canResolveWhatsAppReview, type WhatsAppReviewDecision, type WhatsAppReviewItem } from '@kc/domain';
import { Text } from '@kc/ui';
import { AdminListEmpty } from '../AdminListEmpty';
import { confirmAction } from '../../../services/platformConfirm';
import { container } from '../../../lib/container';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { useInvalidateWhatsAppAdmin, useWhatsAppReviewList } from '../../../hooks/useWhatsAppAdmin';
import { WhatsAppLoadMore } from './WhatsAppLoadMore';
import { useWhatsAppAdminStyles, whatsappAdminErrorText } from './whatsappAdminStyles';

export function WhatsAppReviewPanel() {
  const styles = useWhatsAppAdminStyles();
  const t = useLocaleBundle().admin.whatsapp;
  const invalidate = useInvalidateWhatsAppAdmin();
  const list = useWhatsAppReviewList(true);
  const resolve = useMutation({
    mutationFn: (args: { id: string; decision: WhatsAppReviewDecision }) =>
      container.resolveWhatsAppReview.execute(args.id, args.decision),
    onSuccess: invalidate,
  });
  const decide = async (item: WhatsAppReviewItem, decision: WhatsAppReviewDecision) => {
    const approve = decision === 'approved';
    const ok = await confirmAction(
      approve ? t.review.confirmApproveTitle : t.review.confirmRejectTitle,
      approve ? t.review.confirmApproveBody : t.review.confirmRejectBody,
      { confirmLabel: approve ? t.review.approve : t.review.reject, cancelLabel: t.killSwitch.cancel, destructive: !approve },
    );
    if (ok) resolve.mutate({ id: item.reviewId, decision });
  };
  const error = whatsappAdminErrorText(t, resolve.error);

  return (
    <>
      <Text style={styles.section}>{t.sections.reviews}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {list.rows.length === 0 ? <AdminListEmpty title={t.review.empty} hint="" /> : list.rows.map((item) => (
        <View key={item.reviewId} style={styles.row} testID={`whatsapp-review-${item.reviewId}`}>
          <Text style={styles.rowTitle}>{item.postTitle ?? t.review.untitled}</Text>
          <Text style={styles.muted}>
            {t.review.reasons[item.reason] ?? item.reason}
            {item.confidence !== null ? ` · ${t.review.confidence(Math.round(item.confidence * 100))}` : ''}
          </Text>
          {canResolveWhatsAppReview(item.status, 'approved') ? (
            <View style={styles.actions}>
              <Pressable
                testID={`whatsapp-review-approve-${item.reviewId}`}
                accessibilityRole="button"
                style={styles.linkBtn}
                disabled={resolve.isPending}
                onPress={() => { void decide(item, 'approved'); }}
              >
                <Text style={styles.link}>{t.review.approve}</Text>
              </Pressable>
              <Pressable
                testID={`whatsapp-review-reject-${item.reviewId}`}
                accessibilityRole="button"
                style={styles.linkBtn}
                disabled={resolve.isPending}
                onPress={() => { void decide(item, 'rejected'); }}
              >
                <Text style={styles.linkDanger}>{t.review.reject}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}
      <WhatsAppLoadMore testID="whatsapp-reviews-more" hasMore={list.hasMore} onPress={list.fetchMore} />
    </>
  );
}
