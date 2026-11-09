// Dedicated links-only sub-screen for a giving world (#1963).
import React from 'react';
import { ScrollView } from 'react-native';
import type { DonationCategorySlug } from '@kc/domain';
import { spacing } from '@kc/ui';
import { Screen } from '../ui/Screen';
import { DonationLinksList } from '../DonationLinksList';
import { WorldSubScreenChrome } from './useWorldHeader';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';

export interface WorldDedicatedLinksScreenProps {
  readonly worldSlug: 'food' | 'animals' | 'housing' | 'time' | 'knowledge' | 'rides';
  readonly categorySlug: DonationCategorySlug;
}

export function WorldDedicatedLinksScreen({ worldSlug, categorySlug }: WorldDedicatedLinksScreenProps) {
  const tabBarPad = useShellTabBarScrollInset();

  return (
    <>
      <WorldSubScreenChrome
        worldSlug={worldSlug}
        activeScreenTestId={`world-hub-${worldSlug}-links`}
        screenTitleKey="donations.worldLinksNav"
      />
      <Screen blobs="off" hasNativeHeader testID={`world-links-screen-${worldSlug}`}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: tabBarPad + spacing.lg }}
          testID="world-dedicated-links-scroll"
        >
          <DonationLinksList categorySlug={categorySlug} />
        </ScrollView>
      </Screen>
    </>
  );
}
