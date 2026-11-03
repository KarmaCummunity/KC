// On the owner's own occurrence of a recurring ride: the way to pause, reschedule or cancel the
// series, which lives on one screen for all of them (FR-RIDE-046). Nothing on a single ride.
import React from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { readRideSeriesMarker } from '@kc/domain';
import { GhostButton } from '../ui/Buttons';

export function RideSeriesManageLink({ details }: Readonly<{ details: Record<string, unknown> }>) {
  const { t } = useTranslation();
  const router = useRouter();
  if (!readRideSeriesMarker(details)) return null;
  return (
    <GhostButton
      testID="ride-series-manage"
      size="md"
      icon="repeat-outline"
      label={t('rideSeries.manage')}
      onPress={() => router.push('/(tabs)/donations/rides/series')}
    />
  );
}
