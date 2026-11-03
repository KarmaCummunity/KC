// Emergency call during an active ride (docs/spec/05_giving_worlds.md §5.3 step 6, D70; gap G44).
// Shown to the driver and approved passengers only while the ride is under way; a second tap
// confirms, so a pocket tap never sends it. Everyone else on the ride and KC's admins are alerted.
// Both taps are the kit `AlertButton` — an alarm, neither the screen's primary nor a destructive
// action (spec 17 §8.1 call 7); the confirm step's "cancel" is a ghost button.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { isRideEmergencyWindow } from '@kc/domain';
import { raiseRideEmergency } from '../../../services/rideSafetyComposition';
import { handoffErrorKey } from '../../../lib/marketplaceCreateErrors';
import { AlertButton, GhostButton } from '../../ui/Buttons';

interface Props {
  readonly listingId: string;
  readonly details: Record<string, unknown>;
}

export function RideEmergencyButton({ listingId, details }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isRideEmergencyWindow(details, new Date())) return null;

  const send = async () => {
    setBusy(true);
    try {
      await raiseRideEmergency(listingId);
      setConfirming(false);
      alert(t('rideSafety.emergencySent'));
    } catch (err) {
      alert(t(handoffErrorKey(err) ?? 'givingHandoff.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <AlertButton
        testID="ride-emergency"
        label={t('rideSafety.emergency')}
        icon="alert-circle-outline"
        size="md"
        fullWidth
        onPress={() => setConfirming(true)}
      />
    );
  }

  return (
    <View style={styles.confirm} testID="ride-emergency-confirm">
      <Text style={styles.question}>{t('rideSafety.emergencyConfirm')}</Text>
      <AlertButton
        testID="ride-emergency-send"
        label={t('rideSafety.emergencySend')}
        icon="alert-circle-outline"
        size="md"
        fullWidth
        loading={busy}
        onPress={() => void send()}
      />
      <GhostButton
        testID="ride-emergency-cancel"
        label={t('rideSafety.emergencyCancel')}
        size="md"
        disabled={busy}
        onPress={() => setConfirming(false)}
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  confirm: { gap: spacing.sm },
  question: { ...typography.body, color: colors.textPrimary },
}));
