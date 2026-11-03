import { ScrollView, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useTheme, useBreakpoint, spacing, radius, typography, Text } from '@kc/ui';
import { AppShell } from '../../src/components/shell/AppShell';
import { SHELL_V2_ENABLED } from '../../src/config/environment';

export default function ShellPreviewRoute() {
  if (!SHELL_V2_ENABLED) return <Redirect href="/" />;
  return <ShellPreviewScreen />;
}

function ShellPreviewScreen() {
  const bp = useBreakpoint();
  const { colors } = useTheme();
  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.h1, { color: colors.textPrimary }]}>Shell preview</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Current breakpoint: <Text style={{ ...typography.semiBold }}>{bp}</Text>
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Resize the browser window to: 375 / 800 / 1280 / 1600.
        </Text>
        <View style={styles.spacer} />
        {Array.from({ length: 30 }).map((_, i) => (
          <View
            key={i}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={{ color: colors.textPrimary }}>Sample card #{i + 1}</Text>
          </View>
        ))}
      </ScrollView>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.base, gap: spacing.sm },
  h1: { ...typography.h2 },
  body: { ...typography.body },
  spacer: { height: spacing.base },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.base, borderRadius: radius.sm },
});
