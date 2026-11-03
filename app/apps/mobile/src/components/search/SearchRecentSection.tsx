import React from 'react';
import { Pressable, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, Text } from '@kc/ui';
import { useSearchScreenStyles } from '../../screens/tabs/search.styles';

type Props = {
  queries: string[];
  onSelect: (q: string) => void;
  onClear: () => void;
};

export function SearchRecentSection({ queries, onSelect, onClear }: Props) {
  const styles = useSearchScreenStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  if (queries.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('search.recentSearches')}</Text>
        <TouchableOpacity onPress={onClear}>
          <Text style={styles.clearRecentText}>{t('search.clearRecent')}</Text>
        </TouchableOpacity>
      </View>
      {queries.map((q, i) => (
        <Pressable
          key={`${q}-${i}`}
          style={({ pressed }) => [styles.recentRow, pressed && styles.recentRowPressed]}
          onPress={() => onSelect(q)}
        >
          <Ionicons name="chevron-back" size={16} color={colors.textDisabled} />
          <Text style={styles.recentText}>{q}</Text>
          <Ionicons name="time-outline" size={16} color={colors.textDisabled} />
        </Pressable>
      ))}
    </View>
  );
}
