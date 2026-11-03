// Web-only standalone layout for public research routes — FR-RESEARCH-001 AC2.
// No auth shell, no tab bar, no app navigation.
// .web.tsx extension: never bundled into iOS/Android builds.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Slot } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@kc/ui';
import { ResearchGuestInviteBanner } from '../../src/components/research/ResearchGuestInviteBanner';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function ResearchLayout() {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <View style={styles.container}>
        <ResearchGuestInviteBanner />
        <Slot />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  container: {
    flex: 1,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
});
