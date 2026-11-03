// FR-CLOSURE-007 — lets the credited recipient remove their own mark.
// Spec AC1: only on closed_delivered when viewer === recipient.
// Spec AC2: confirmation modal explains consequences.
// Spec AC3: calls rpc_recipient_unmark_self, post→deleted_no_recipient.
import { useState } from 'react';
import { Pressable } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { ConfirmActionModal } from '../post/ConfirmActionModal';
import { NotifyModal } from '../NotifyModal';
import { getUnmarkRecipientSelfUseCase } from '../../services/postsComposition';

interface Props {
  postId: string;
  userId: string;
}

export function RecipientUnmarkBar({ postId, userId }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notify, setNotify] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      getUnmarkRecipientSelfUseCase().execute({ postId, userId }),
    onSuccess: async () => {
      setConfirmOpen(false);
      await qc.invalidateQueries({ queryKey: ['post', postId] });
      await qc.invalidateQueries({ queryKey: ['profile-closed-posts'] });
      await qc.invalidateQueries({ queryKey: ['profile-tab-open-count'] });
      await qc.invalidateQueries({ queryKey: ['profile-tab-closed-count'] });
      await qc.invalidateQueries({ queryKey: ['my-hidden-open-posts'] });
    },
    onError: () => {
      setConfirmOpen(false);
      setNotify(t('closure.unmarkErrorBody'));
    },
  });

  const cta = t('closure.unmarkSelfCta');
  const ctaA11y = t('closure.unmarkSelfA11y');
  return (
    <>
      <Pressable
        style={styles.btn}
        onPress={() => setConfirmOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={ctaA11y}
      >
        <Text style={styles.btnText}>{cta}</Text>
      </Pressable>
      <ConfirmActionModal
        visible={confirmOpen}
        title={t('closure.unmarkConfirmTitle')}
        message={t('closure.unmarkConfirmBody')}
        confirmLabel={t('closure.unmarkConfirmCta')}
        destructive
        isBusy={mutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => mutation.mutate()}
      />
      <NotifyModal
        visible={notify !== null}
        title={t('general.error')}
        message={notify ?? ''}
        onDismiss={() => setNotify(null)}
      />
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  btn: {
    alignSelf: 'stretch',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorLight,
    alignItems: 'center',
  },
  btnText: { ...typography.bodySmall, color: colors.error, ...typography.semiBold },
}));
