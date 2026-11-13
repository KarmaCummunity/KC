// Mapped to spec: FR-KNOW-* / FR-DONATE-007 — knowledge ("info") posts relevant to a giving
// world, listed under that world's community links. Rendered with the shared post card.
import React, { useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { PostCardGrid } from '../PostCardGrid';
import { PrimaryButton } from '../ui/Buttons';
import { useWorldInfoPosts } from '../../hooks/useWorldInfoPosts';
import { filterAndSortInfoPosts, type WorldLinksSort } from '../../lib/worldLinksCatalog';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { rowDirectionStart } from '../../lib/rtlLayout';

const useStyles = makeUseStyles(({ colors }) => ({
  section: { marginTop: spacing.lg, gap: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  note: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  grid: { flexDirection: rowDirectionStart, flexWrap: 'wrap' as const, gap: spacing.sm },
}));

export interface WorldInfoPostsSectionProps {
  /** Locale keyword of the screen's subject; empty = every knowledge post (the knowledge world). */
  readonly subjectKeyword: string;
  readonly query: string;
  readonly sort: WorldLinksSort;
}

export function WorldInfoPostsSection({ subjectKeyword, query, sort }: Readonly<WorldInfoPostsSectionProps>) {
  const { t } = useTranslation();
  const styles = useStyles();
  const { colors } = useTheme();
  const { posts, isLoading, isError, refetch } = useWorldInfoPosts(subjectKeyword);

  const visible = useMemo(() => filterAndSortInfoPosts(posts, { query, sort }), [posts, query, sort]);

  const renderBody = () => {
    if (isLoading) return <ActivityIndicator color={colors.primary} />;
    if (isError) {
      return (
        <>
          <Text style={styles.note}>{t('donations.worldLinks.infoError')}</Text>
          <PrimaryButton testID="world-info-posts-retry" label={t('donations.worldLinks.infoRetry')} size="md" onPress={refetch} />
        </>
      );
    }
    if (visible.length === 0) {
      return <Text style={styles.note}>{t('donations.worldLinks.infoEmpty')}</Text>;
    }
    return (
      <View style={styles.grid}>
        {visible.map((post) => (
          <PostCardGrid key={post.postId} post={post} />
        ))}
      </View>
    );
  };

  return (
    <View style={styles.section} testID="world-info-posts-section">
      <Text style={styles.title}>{t('donations.worldLinks.infoTitle')}</Text>
      {renderBody()}
    </View>
  );
}
