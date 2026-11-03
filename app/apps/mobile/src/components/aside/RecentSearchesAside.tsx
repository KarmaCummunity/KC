// Search-screen aside — recent searches (FR-RESP-003).
// Tapping a row asks the search screen to run that query via the store's
// requestedQuery handshake (the input state lives inside the screen).
import { TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { Ionicons } from '@expo/vector-icons';
import { useSearchStore } from '../../store/searchStore';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { AsideCard } from './AsideCard';

export function RecentSearchesAside() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const recentSearches = useSearchStore((s) => s.recentSearches);
  const requestSearch = useSearchStore((s) => s.requestSearch);
  const clearRecentSearches = useSearchStore((s) => s.clearRecentSearches);

  return (
    <AsideCard title={t('aside.recentSearchesTitle')}>
      {recentSearches.length === 0 && (
        <Text style={styles.empty}>{t('aside.recentSearchesEmpty')}</Text>
      )}
      {recentSearches.map((q) => (
        <TouchableOpacity
          key={q}
          style={styles.row}
          accessibilityRole="button"
          testID={`aside-recent-${q}`}
          onPress={() => requestSearch(q)}
        >
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.rowLabel} numberOfLines={1}>
            {q}
          </Text>
        </TouchableOpacity>
      ))}
      {recentSearches.length > 0 && (
        <TouchableOpacity
          accessibilityRole="button"
          testID="aside-recent-clear"
          onPress={clearRecentSearches}
        >
          <Text style={styles.clearLink}>{t('aside.recentSearchesClear')}</Text>
        </TouchableOpacity>
      )}
    </AsideCard>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  rowLabel: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    textAlign: rtlTextAlignStart,
  },
  empty: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
  },
  clearLink: {
    ...typography.bodySmall,
    color: colors.primary,
    marginTop: spacing.xs,
    textAlign: rtlTextAlignStart,
  },
}));
