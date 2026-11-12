// Items / food hub: the shared world hub (FR-FEED-020 AC2).
import React from 'react';
import { WorldMarketplaceHub } from './WorldMarketplaceHub';
import { worldLinksSubScreenLink, worldSubScreens } from './worldSubScreens';

type Props = {
  worldSlug: 'items' | 'food';
  icon: 'gift-outline' | 'restaurant-outline';
  introKey: 'givingHandoff.itemsHubIntro' | 'givingHandoff.foodHubIntro';
  handoffsPath: '/(tabs)/donations/items/handoffs' | '/(tabs)/donations/food/handoffs';
};

export function WorldGivingHub({ worldSlug, icon, introKey, handoffsPath }: Props) {
  return (
    <WorldMarketplaceHub
      worldSlug={worldSlug}
      icon={icon}
      introKey={introKey}
      subScreens={worldSubScreens(handoffsPath, [worldLinksSubScreenLink(worldSlug)])}
    />
  );
}
