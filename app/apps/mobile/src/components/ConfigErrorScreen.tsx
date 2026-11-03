import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, spacing, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';

export function ConfigErrorScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('config.missingSupabaseTitle')}</Text>
        <Text style={styles.body}>{t('config.missingSupabaseBody')}</Text>
        <Text style={styles.hint}>{t('config.missingSupabaseHint')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1, backgroundColor: colors.surfaceCream },
  content: { padding: spacing.xl, gap: spacing.base },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
  },
}));
