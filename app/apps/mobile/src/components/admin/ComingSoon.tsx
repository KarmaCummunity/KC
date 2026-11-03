// app/apps/mobile/src/components/admin/ComingSoon.tsx
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { View, Pressable } from 'react-native';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { useLocaleBundle } from '../../i18n/useLocaleBundle';

export interface ComingSoonProps {
  subProject: 'A1' | 'A2' | 'A3' | 'A4';
  description?: string;
}

export function ComingSoon({ subProject, description }: ComingSoonProps): ReactElement {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.comingSoon;
  const key = subProject.toLowerCase() as 'a1' | 'a2' | 'a3' | 'a4';
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t.title}</Text>
      <Text style={styles.subtitle}>{description ?? t[key]}</Text>
      <Pressable
        style={styles.back}
        onPress={() => router.replace('/(admin)')}
        accessibilityRole="button"
      >
        <Text style={styles.backText}>{t.back}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  title: { fontSize: typography.h3.fontSize, ...typography.semiBold, textAlign: 'center' },
  subtitle: { fontSize: typography.body.fontSize, opacity: 0.7, textAlign: 'center' },
  back: { marginTop: spacing.base, paddingHorizontal: spacing.base, paddingVertical: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.skeleton },
  backText: { fontSize: typography.body.fontSize },
}));
