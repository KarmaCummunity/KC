// FR-CLOSURE-005 AC2 — confirmation dialog for reopening a closed post.
// Built on the kit `Modal` (spec 17 §4.1).
// Copy varies on TWO axes:
//   1. status:  closed_delivered (with consequences) vs deleted_no_recipient (cancel cleanup)
//   2. type:    Give (owner gave / marked received) vs Request (owner received / marked gave)
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import type { PostType } from '@kc/domain';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { PrimaryButton, SecondaryButton } from '../ui/Buttons';
import { Modal } from '../ui/Modal';

interface Props {
  visible: boolean;
  variant: 'closed_delivered' | 'deleted_no_recipient';
  postType: PostType;
  isBusy: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ReopenConfirmModal({
  visible,
  variant,
  postType,
  isBusy,
  errorMessage,
  onCancel,
  onConfirm,
}: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const give = postType === 'Give';
  // Marked-user direction depends on post type (see RecipientCallout for the
  // same convention). The DB columns lag this naming for Request posts.
  const markedSideLabel = give ? t('closure.markedSideGive') : t('closure.markedSideRequest');
  const ownerCounter = give ? t('closure.counterDonated') : t('closure.counterReceived');
  const markedCounter = give ? t('closure.counterReceived') : t('closure.counterDonated');

  return (
    <Modal
      visible={visible}
      title={t('closure.itemNotDeliveredModalTitle')}
      onDismiss={onCancel}
      // Keep the dialog while the reopen request is in flight.
      dismissible={!isBusy}
      footer={
        <>
          <PrimaryButton
            label={t('closure.reopenConfirmCta')}
            size="md"
            fullWidth
            loading={isBusy}
            onPress={onConfirm}
          />
          <SecondaryButton label={t('general.cancel')} size="md" fullWidth disabled={isBusy} onPress={onCancel} />
        </>
      }
    >
      {variant === 'closed_delivered' ? (
        <View style={styles.list}>
          <Text style={styles.body}>{t('closure.reopenBodyClosedDelivered')}</Text>
          <Text style={styles.bullet}>{t('closure.reopenBulletMarkedRemoved', { markedSide: markedSideLabel })}</Text>
          <Text style={styles.bullet}>{t('closure.reopenBulletMarkedCounter', { counter: markedCounter })}</Text>
          <Text style={styles.bullet}>{t('closure.reopenBulletOwnerCounter', { counter: ownerCounter })}</Text>
        </View>
      ) : (
        <Text style={styles.body}>{t('closure.reopenBodyDeletedNoRecipient')}</Text>
      )}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
    </Modal>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  list: { gap: spacing.sm },
  body: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  bullet: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  error: { ...typography.body, color: colors.error, textAlign: rtlTextAlignStart },
}));
