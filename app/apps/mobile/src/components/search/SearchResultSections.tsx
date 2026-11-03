import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, Text } from '@kc/ui';
import type { SearchResultType } from '@kc/domain';
import type { UniversalSearchResults } from '@kc/application';
import {
  UserResultCard,
  PostResultCard,
  LinkResultCard,
} from '../SearchResultCard';
import { useSearchScreenStyles } from '../../screens/tabs/search.styles';
import { SearchSocialSections } from './SearchSocialSections';
import { kcGridCell } from '../cards/KcCard.styles';

const postsGrid = { flexDirection: 'row' as const, flexWrap: 'wrap' as const };

type Props = {
  results: UniversalSearchResults;
  expandedSection: SearchResultType | null;
  onExpand: (section: SearchResultType) => void;
  previewLimit: number;
  showNationalLinksNote: boolean;
  onHashtagTap: (tag: string) => void;
};

export function SearchResultSections({
  results,
  expandedSection,
  onExpand,
  previewLimit,
  showNationalLinksNote,
  onHashtagTap,
}: Props) {
  const styles = useSearchScreenStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <>
      {results.users.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>{t('search.sectionPeople')}</Text>
              <Ionicons name="people" size={18} color={colors.primary} />
              <Text style={styles.sectionCount}>({formatSearchCount(results.usersTotal, results.usersHasMore)})</Text>
            </View>
            {(results.usersHasMore || results.usersTotal > previewLimit) && expandedSection !== 'user' && (
              <TouchableOpacity style={styles.showAllBtn} onPress={() => onExpand('user')}>
                <Text style={styles.showAllText}>{t('search.showAll')}</Text>
              </TouchableOpacity>
            )}
          </View>
          {results.users.map((user) => (
            <UserResultCard key={user.userId} user={user} />
          ))}
        </View>
      )}

      {results.posts.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>{t('search.sectionPosts')}</Text>
              <Ionicons name="cube" size={18} color={colors.primary} />
              <Text style={styles.sectionCount}>({formatSearchCount(results.postsTotal, results.postsHasMore)})</Text>
            </View>
            {(results.postsHasMore || results.postsTotal > previewLimit) && expandedSection !== 'post' && (
              <TouchableOpacity style={styles.showAllBtn} onPress={() => onExpand('post')}>
                <Text style={styles.showAllText}>{t('search.showAll')}</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={postsGrid}>
            {results.posts.map((post) => (
              <View key={post.postId} style={kcGridCell}>
                <PostResultCard post={post} />
              </View>
            ))}
          </View>
        </View>
      )}

      <SearchSocialSections results={results} onHashtagTap={onHashtagTap} />

      {results.links.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>{t('search.sectionLinks')}</Text>
              <Ionicons name="link" size={18} color={colors.secondary} />
              <Text style={styles.sectionCount}>({formatSearchCount(results.linksTotal, results.linksHasMore)})</Text>
            </View>
            {(results.linksHasMore || results.linksTotal > previewLimit) && expandedSection !== 'link' && (
              <TouchableOpacity style={styles.showAllBtn} onPress={() => onExpand('link')}>
                <Text style={styles.showAllText}>{t('search.showAll')}</Text>
              </TouchableOpacity>
            )}
          </View>
          {showNationalLinksNote && (
            <View style={styles.nationalNote}>
              <Ionicons name="globe-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.nationalNoteText}>{t('search.nationalLinks')}</Text>
            </View>
          )}
          {results.links.map((link) => (
            <LinkResultCard key={link.id} link={link} />
          ))}
        </View>
      )}
    </>
  );
}

/** Totals are "at least" (0418 — no exact counts); show `N+` when more exist. */
export function formatSearchCount(total: number, hasMore: boolean | undefined): string {
  return hasMore ? `${total}+` : String(total);
}
