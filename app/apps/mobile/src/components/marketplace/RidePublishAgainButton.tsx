// "Publish again" on the driver's own ride: opens the create form with the same route and offer,
// leaving only the times to set (docs/spec/05_giving_worlds.md §5.3 step 1, D75; G49).
import React from 'react';
import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { queueRideRepublish } from '../../lib/rides/rideStartDetails';

export function RidePublishAgainButton({ details }: Readonly<{ details: Record<string, unknown> }>) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  return (
    <Pressable
      testID="ride-publish-again"
      accessibilityRole="button"
      style={styles.btn}
      onPress={() => {
        queueRideRepublish(details);
        router.push({ pathname: '/(tabs)/create', params: { category: 'rides' } });
      }}
    >
      <Text style={styles.text}>{t('rideSchedule.publishAgain')}</Text>
    </Pressable>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  btn: {
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
  },
  text: { ...typography.button, color: colors.primary },
}));
