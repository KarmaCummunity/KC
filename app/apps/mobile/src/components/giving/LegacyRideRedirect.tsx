// The retired legacy ride screens (D70; gap G44): an old link — a push, a chat card, a saved
// address — opens the ride on the one rides flow. A ride is a post now and keeps its id, so a
// well-formed id opens the listing (which says so when it is gone); anything else opens the hub.
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { makeUseStyles } from '@kc/ui';

/** A ride id is a UUID; anything else cannot be a ride. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function LegacyRideRedirect() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const styles = useStyles();

  useEffect(() => {
    if (id && UUID.test(id)) router.replace({ pathname: '/(tabs)/donations/marketplace/[listingId]', params: { listingId: id } });
    else router.replace('/(tabs)/donations/rides');
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
