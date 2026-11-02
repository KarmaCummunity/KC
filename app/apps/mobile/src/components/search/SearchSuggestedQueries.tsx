import React from 'react';
import { View } from 'react-native';
import { Text } from '@kc/ui';
import { useTranslation } from 'react-i18next';
import { useSearchScreenStyles } from '../../screens/tabs/search.styles';
import { Chip } from '../ui/Chip';
import { localizeSuggestedTag } from './localizeSuggestedTag';

type Props = {
  queries: string[];
  onSelect: (q: string) => void;
};

export function SearchSuggestedQueries({ queries, onSelect }: Props) {
  const styles = useSearchScreenStyles();
  const { t } = useTranslation();
  if (queries.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('search.suggested')}</Text>
      <View style={styles.chipRow}>
        {queries.map((q) => {
          const label = localizeSuggestedTag(q, t);
          return (
            <Chip
              key={q}
              size="sm"
              label={`#${label}`}
              selected={false}
              onPress={() => onSelect(label)}
            />
          );
        })}
      </View>
    </View>
  );
}
