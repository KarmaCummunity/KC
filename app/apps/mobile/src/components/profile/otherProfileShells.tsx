import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing, useTheme, Text } from '@kc/ui';
import { useOtherProfileScreenStyles } from './otherProfileScreen.styles';

export function OtherProfileLoading() {
  const { colors } = useTheme();
  const styles = useOtherProfileScreenStyles();
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ActivityIndicator style={{ marginTop: spacing['4xl'] }} color={colors.primary} />
    </SafeAreaView>
  );
}

export function OtherProfileNotFound() {
  const { t } = useTranslation();
  const styles = useOtherProfileScreenStyles();
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerTitle: t('profile.headerTitle') }} />
      <View style={styles.notFound}>
        <Text style={styles.notFoundText}>{t('profile.userNotFound')}</Text>
      </View>
    </SafeAreaView>
  );
}

type UnavailableProps = { title: string; description: string };

export function OtherProfileUnavailable({ title, description }: UnavailableProps) {
  const { t } = useTranslation();
  const styles = useOtherProfileScreenStyles();
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerTitle: t('profile.headerTitle') }} />
      <View style={styles.notFound}>
        <Text style={styles.notFoundText}>{title}</Text>
        <Text style={styles.unavailableHint}>{description}</Text>
      </View>
    </SafeAreaView>
  );
}
