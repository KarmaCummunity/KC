import React from 'react';
import { View } from 'react-native';
import { KcFlashList } from '../../../../../../src/components/lists/KcFlashList';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { Screen } from '../../../../../../src/components/ui/Screen';
import { TimeWorldSubScreenChrome } from '../../../../../../src/components/giving/TimeWorldSubScreenChrome';
import { volunteerUseCases } from '../../../../../../src/services/volunteerComposition';

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  name: { ...typography.bodyLarge, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
}));

export default function ShiftVolunteersRosterScreen() {
  const { shiftId } = useLocalSearchParams<{ shiftId: string }>();
  const { t } = useTranslation();
  const styles = useStyles();
  const roster = useQuery({
    queryKey: ['volunteer', 'roster', shiftId],
    queryFn: () => volunteerUseCases.listRoster().execute(String(shiftId)),
    enabled: Boolean(shiftId),
  });

  return (
    <>
      <TimeWorldSubScreenChrome
        activeScreenTestId="time-organizer"
        screenTitleKey="timeVolunteer.manageVolunteers"
      />
      <Screen blobs="off" hasNativeHeader>
      <KcFlashList
        data={roster.data ?? []}
        keyExtractor={(item) => item.signupId}
        contentContainerStyle={{ paddingVertical: spacing.md }}
        ListEmptyComponent={
          <Text style={{ padding: spacing.lg, textAlign: 'center' }}>
            {roster.isLoading ? t('timeVolunteer.loading') : '—'}
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.name}>{item.displayName ?? item.shareHandle ?? item.userId}</Text>
            <Text style={styles.meta}>
              {item.status}
              {item.waitlistPosition != null ? ` #${item.waitlistPosition}` : ''}
              {item.hoursLogged != null ? ` · ${item.hoursLogged}h` : ''}
            </Text>
          </View>
        )}
      />
      </Screen>
    </>
  );
}
