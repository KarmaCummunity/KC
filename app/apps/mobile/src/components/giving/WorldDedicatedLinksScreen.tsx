// Mapped to spec: FR-FEED-020 AC2 / FR-DONATE-007 / FR-DONATE-011 / FR-KNOW-001 — a giving
// world's "links and knowledge" screen (#1963): the world's community links (when it has a
// list), then its curated content — organizations, related worlds and knowledge topics. A
// world with neither shows an empty state.
import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isWorldContentEmpty, worldLinkListSlug } from '@kc/domain';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { Screen } from '../ui/Screen';
import { PrimaryButton } from '../ui/Buttons';
import { EmptyState } from '../EmptyState';
import { DonationLinksList } from '../DonationLinksList';
import { WorldSubScreenChrome } from './useWorldHeader';
import { WorldContentSections } from './WorldContentSections';
import { useWorldContent } from '../../hooks/useWorldContent';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';

const useStyles = makeUseStyles(({ colors }) => ({
  scroll: { padding: spacing.lg, gap: spacing.xl },
  status: { alignItems: 'center' as const, gap: spacing.md, paddingVertical: spacing.lg },
  statusText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' as const },
}));

export interface WorldDedicatedLinksScreenProps {
  readonly worldSlug: string;
}

export function WorldDedicatedLinksScreen({ worldSlug }: WorldDedicatedLinksScreenProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tabBarPad = useShellTabBarScrollInset();
  const listSlug = worldLinkListSlug(worldSlug);
  const { content, isLoading, isError, retry } = useWorldContent(worldSlug);
  const hasCurated = !isWorldContentEmpty(content);
  // The community list brings its own empty state; this one is for a world with no list at all.
  const showEmpty = !listSlug && !hasCurated && !isLoading && !isError;

  return (
    <>
      <WorldSubScreenChrome
        worldSlug={worldSlug}
        activeScreenTestId={`world-hub-${worldSlug}-links`}
        screenTitleKey="donations.worldLinksNav"
      />
      <Screen blobs="off" hasNativeHeader testID={`world-links-screen-${worldSlug}`}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: tabBarPad + spacing.lg }]}
          testID="world-dedicated-links-scroll"
        >
          {listSlug ? <DonationLinksList categorySlug={listSlug} /> : null}
          {isLoading ? (
            <View style={styles.status}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}
          {isError ? (
            <View style={styles.status} testID="world-content-error">
              <Text style={styles.statusText}>{t('donations.worldContent.loadError')}</Text>
              <PrimaryButton testID="world-content-retry" label={t('donations.links.retry')} size="md" onPress={retry} />
            </View>
          ) : null}
          {hasCurated ? <WorldContentSections content={content} /> : null}
          {showEmpty ? (
            <View testID="world-content-empty">
              <EmptyState
                icon="library-outline"
                title={t('donations.worldContent.emptyTitle')}
                subtitle={t('donations.worldContent.emptyBody')}
              />
            </View>
          ) : null}
        </ScrollView>
      </Screen>
    </>
  );
}
