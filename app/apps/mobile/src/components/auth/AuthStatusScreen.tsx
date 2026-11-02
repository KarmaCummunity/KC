// Full-screen status states of the auth link routes — FR-AUTH-003 / 006 / 007 / 008:
// the OAuth callback, the e-mail verification link and the password reset
// screens. A message (title + body) with one call to action, or a progress
// state while a link is being exchanged.
import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, Text } from '@kc/ui';
import { PrimaryButton } from '../ui/Buttons';
import { usePasswordResetStyles } from './passwordResetScreen.styles';

export interface AuthStatusScreenProps {
  readonly title: string;
  readonly body: string;
  readonly ctaLabel: string;
  readonly onCta: () => void;
  readonly ctaTestID?: string;
}

/** A finished or failed link: what happened and the one way forward. */
export function AuthStatusScreen({ title, body, ctaLabel, onCta, ctaTestID }: AuthStatusScreenProps) {
  const styles = usePasswordResetStyles();
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <PrimaryButton testID={ctaTestID} label={ctaLabel} size="md" fullWidth onPress={onCta} />
      </ScrollView>
    </SafeAreaView>
  );
}

/** A link still being exchanged for a session. */
export function AuthProgressScreen({ message }: { readonly message: string }) {
  const styles = usePasswordResetStyles();
  const { colors } = useTheme();
  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.content, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.body}>{message}</Text>
      </View>
    </SafeAreaView>
  );
}
