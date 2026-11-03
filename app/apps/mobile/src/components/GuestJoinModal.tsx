// Guest sign-up prompt on the kit `BottomSheet` (spec 17 §4.1); the join CTA leads the footer.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, Text } from '@kc/ui';
import { BottomSheet } from './ui/BottomSheet';
import { GhostButton, PrimaryButton } from './ui/Buttons';

export interface GuestJoinModalProps {
  visible: boolean;
  message: string;
  joinLabel: string;
  onJoin: () => void;
  onDismiss: () => void;
}

/** FR-AUTH-014: sign-up overlay shown when a guest attempts a blocked interaction. */
export function GuestJoinModal({
  visible,
  message,
  joinLabel,
  onJoin,
  onDismiss,
}: Readonly<GuestJoinModalProps>) {
  const { t } = useTranslation();
  const styles = useGuestJoinModalStyles();
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      footer={
        <>
          <PrimaryButton label={joinLabel} size="md" fullWidth onPress={onJoin} />
          <GhostButton label={t('general.close')} size="md" fullWidth onPress={onDismiss} />
        </>
      }
    >
      <Text style={styles.message}>{message}</Text>
    </BottomSheet>
  );
}

const useGuestJoinModalStyles = makeUseStyles(({ colors }) => ({
  message: { ...typography.bodyLarge, color: colors.textPrimary, textAlign: 'center' },
}));
