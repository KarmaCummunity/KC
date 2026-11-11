// One segment per offered seat: taken (approved or completed), waiting for approval, or free.
import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@kc/ui';
import type { RideSeatSummary } from '@kc/domain';
import { useRideBookingsPanelStyles } from './rideBookingsPanelStyles';

export function RideSeatsMeter({ seats }: { readonly seats: RideSeatSummary }) {
  const { colors } = useTheme();
  const styles = useRideBookingsPanelStyles();
  const taken = seats.approved + seats.completed;
  if (seats.capacity === 0) return null;

  const segmentColor = (i: number) => {
    if (i < taken) return colors.primary;
    if (i < taken + seats.waiting) return colors.primaryLight;
    return colors.border;
  };

  return (
    <View style={styles.meter} testID="ride-bookings-meter" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: seats.capacity }, (_, i) => (
        <View key={i} style={[styles.meterSegment, { backgroundColor: segmentColor(i) }]} />
      ))}
    </View>
  );
}
