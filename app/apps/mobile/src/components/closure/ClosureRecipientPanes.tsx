// Sub-panes for ClosureStep2: tab switcher + chats list + search input/results.
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, radius, typography, useTheme, Text } from '@kc/ui';
import type { ClosureCandidate } from '@kc/application';
import type { PickMode } from '../../store/closureStore';
import { RecipientPickerRow } from './RecipientPickerRow';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { TextField } from '../ui/TextField';

export function ModeTabs({
  pickMode,
  chatsCount,
  onChange,
}: {
  pickMode: PickMode;
  chatsCount: number;
  onChange: (m: PickMode) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.tabs}>
      <Pressable
        onPress={() => onChange('chats')}
        style={[styles.tab, pickMode === 'chats' && styles.tabActive]}
      >
        <Text style={[styles.tabText, pickMode === 'chats' && styles.tabTextActive]}>
          {t('closure.pickModeChats')}{chatsCount > 0 ? `  (${chatsCount})` : ''}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onChange('search')}
        style={[styles.tab, pickMode === 'search' && styles.tabActive]}
      >
        <Text style={[styles.tabText, pickMode === 'search' && styles.tabTextActive]}>
          {t('closure.pickModeSearch')}
        </Text>
      </Pressable>
    </View>
  );
}

export function ChatsPane({
  candidates,
  selectedId,
  onSelect,
  emptyLabel,
}: {
  candidates: ClosureCandidate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyLabel?: string;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  if (candidates.length === 0) {
    return (
      <View style={styles.emptyPane}>
        <Text style={styles.body}>{emptyLabel ?? t('closure.chatsEmpty')}</Text>
      </View>
    );
  }
  return (
    <ScrollView style={styles.list}>
      {candidates.map((c) => (
        <RecipientPickerRow
          key={c.userId}
          candidate={c}
          selected={c.userId === selectedId}
          onPress={() => onSelect(c.userId)}
        />
      ))}
    </ScrollView>
  );
}

export function SearchPane({
  query,
  onQueryChange,
  results,
  isSearching,
  selectedId,
  onSelect,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  results: ClosureCandidate[];
  isSearching: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View>
      <TextField
        label={t('closure.searchPlaceholder')}
        containerStyle={styles.inputContainer}
        placeholder={t('closure.searchPlaceholder')}
        placeholderTextColor={colors.textDisabled}
        value={query}
        onChangeText={onQueryChange}
        autoCorrect={false}
        autoCapitalize="none"
        textAlign={rtlTextAlignStart}
      />
      {isSearching ? (
        <View style={styles.searchingRow}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
      <ScrollView style={styles.list}>
        {results.map((c) => (
          <RecipientPickerRow
            key={c.userId}
            candidate={c}
            selected={c.userId === selectedId}
            onPress={() => onSelect(c.userId)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  body: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  tabs: { flexDirection: rowDirectionStart, gap: spacing.xs, marginBottom: spacing.md, backgroundColor: colors.skeleton, borderRadius: radius.sm, padding: spacing.xs },
  tab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center' },
  tabActive: { backgroundColor: colors.surface },
  tabText: { ...typography.body, ...typography.medium, color: colors.textSecondary },
  tabTextActive: { color: colors.textPrimary, ...typography.bold },
  list: { maxHeight: spacing['3xl'] * 5, marginBottom: spacing.sm },
  emptyPane: { padding: spacing.md, marginBottom: spacing.sm },
  inputContainer: { marginBottom: spacing.sm },
  searchingRow: { paddingVertical: spacing.sm, alignItems: 'center' },
}));
