// The retired legacy ride screens (D70; gap G44): an old link — a push, a chat card, a saved
// address — opens the ride's listing on the one rides flow, or the rides hub when the ride has
// no listing the viewer may see.
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { makeUseStyles } from '@kc/ui';
import { findListingForLegacyRide } from '../../services/rideLegacyLinkComposition';

export function LegacyRideRedirect() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const styles = useStyles();

  useEffect(() => {
    let cancelled = false;
    const open = (listingId: string | null) => {
      if (cancelled) return;
      if (listingId) router.replace({ pathname: '/(tabs)/donations/marketplace/[listingId]', params: { listingId } });
      else router.replace('/(tabs)/donations/rides');
    };
    findListingForLegacyRide(id).then(open, () => open(null));
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  return (
    <View style={styles.center} testID="legacy-ride-redirect">
      <ActivityIndicator />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: colors.background },
}));
