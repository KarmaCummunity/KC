// Donation support card on About + Settings — FR-DONATE-010.
// Same channels, legal notice and behavior as the Money hub card (FR-DONATE-011);
// only the warm "give to the community too" wording differs.
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { SupportKcCard } from './money/SupportKcCard';

export interface DonationSupportCardProps {
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function DonationSupportCard({ style, testID }: DonationSupportCardProps) {
  return (
    <SupportKcCard
      titleKey="donations.supportUs.title"
      taglineKey="donations.supportUs.tagline"
      style={style}
      testID={testID ?? 'donation-support-card'}
    />
  );
}
