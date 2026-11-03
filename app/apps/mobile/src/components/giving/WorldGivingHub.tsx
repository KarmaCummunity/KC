// Items / food hub: the shared world hub with urgency + availability row meta (FR-FEED-020 AC2).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { WorldMarketplaceHub } from './WorldMarketplaceHub';
import { worldSubScreens } from './worldSubScreens';

type Props = {
  worldSlug: 'items' | 'food';
  icon: 'gift-outline' | 'restaurant-outline';
  introKey: 'givingHandoff.itemsHubIntro' | 'givingHandoff.foodHubIntro';
  handoffsPath: '/(tabs)/donations/items/handoffs' | '/(tabs)/donations/food/handoffs';
};

export function WorldGivingHub({ worldSlug, icon, introKey, handoffsPath }: Props) {
  const { t } = useTranslation();
  return (
    <WorldMarketplaceHub
      worldSlug={worldSlug}
      icon={icon}
      introKey={introKey}
      subScreens={worldSubScreens(handoffsPath)}
      rowMeta={(item) =>
        `${worldSlug === 'food' && item.urgencyLevel >= 4 ? `${t('givingHandoff.urgencyHigh')} · ` : ''}${t(
          `marketplace.availability.${item.availabilityStatus}`,
          { defaultValue: item.availabilityStatus },
        )} · ${t(`marketplace.world.${worldSlug}`)}`
      }
    />
  );
}
