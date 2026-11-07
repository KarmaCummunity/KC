// Donations hub entry — delegates to the shared matches feed strip.
import React from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing } from '@kc/ui';
import { MatchesFeedSection } from './MatchesFeedSection';

const useStyles = makeUseStyles(() => ({
  wrap: { paddingHorizontal: spacing.lg },
}));

export function MatchesForYouCard() {
  const styles = useStyles();
  return (
    <View style={styles.wrap} testID="matches-for-you-card">
      <MatchesFeedSection variant="hub" maxVisible={3} />
    </View>
  );
}
