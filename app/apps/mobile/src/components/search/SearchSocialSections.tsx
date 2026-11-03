import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, Text } from '@kc/ui';
import type { UniversalSearchResults } from '@kc/application';
import { useSearchScreenStyles } from '../../screens/tabs/search.styles';

type Props = {
  results: UniversalSearchResults;
  onHashtagTap: (tag: string) => void;
};

export function SearchSocialSections({ results, onHashtagTap }: Props) {
  const styles = useSearchScreenStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <>
      {results.orgs.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('search.sectionOrgs')}</Text>
            <Text style={styles.sectionCount}>({results.orgsTotal})</Text>
          </View>
          {results.orgs.map((org) => (
            <View key={org.orgId} style={styles.recentRow}>
              <Ionicons name="business-outline" size={18} color={colors.primary} />
              <Text style={styles.recentText}>{org.name}</Text>
            </View>
          ))}
        </View>
      )}

      {results.hashtags.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('search.sectionHashtags')}</Text>
            <Text style={styles.sectionCount}>({results.hashtagsTotal})</Text>
          </View>
          {results.hashtags.map((tag) => (
            <Pressable key={tag.tag} style={styles.recentRow} onPress={() => onHashtagTap(tag.tag)}>
              <Text style={styles.recentText}>#{tag.tag}</Text>
              <Text style={styles.sectionCount}>{tag.useCount}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}
