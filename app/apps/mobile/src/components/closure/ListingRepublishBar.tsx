// Mapped to spec: D127 — the owner's action on an expired listing-world post. An expired post is
// never reopened; "Republish" opens the create form prefilled from it (dates cleared), and
// publishing there creates a new post while the expired one stays as history.
import React from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../ui/Buttons';
import { republishRoute } from '../../lib/unifiedCreate/listingRepublish';

interface Props {
  /** The expired listing (equal to its post id since migration 0667). */
  readonly listingId: string;
}

export function ListingRepublishBar({ listingId }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <PrimaryButton
      testID="listing-republish"
      label={t('post.republishListing.cta')}
      accessibilityLabel={t('post.republishListing.a11y')}
      size="md"
      fullWidth
      onPress={() => router.push(republishRoute(listingId))}
    />
  );
}
