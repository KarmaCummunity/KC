// Mapped to spec: FR-POST-001 AC6 / D100 — the create form of every category that is not the
// items post: a marketplace listing for the worlds with a feed, "add a link" for the rest.
import React from 'react';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import type { CreateCategoryConfig, CreateDirection } from '../../lib/unifiedCreate/createCategories';
import { closeCreateForm } from '../../navigation/closeCreateForm';
import { useLaunchWorldEnabled } from '../../hooks/useLaunchWorldFlags';
import { ChallengeWorldCreateForm } from './ChallengeWorldCreateForm';
import { LinkCreateForm } from './LinkCreateForm';
import { HousingCreateVerificationGate } from './HousingCreateVerificationGate';
import { ListingCreateForm } from './ListingCreateForm';

interface Props {
  /** A category whose engine is `listing` or `link`. */
  readonly category: CreateCategoryConfig;
  readonly header: ReactNode;
  readonly direction: CreateDirection;
  readonly title: string;
  readonly onTitleChange: (v: string) => void;
  readonly summary: string;
  readonly onSummaryChange: (v: string) => void;
  readonly onPublishActionChange: (action: (() => void) | null, loading: boolean) => void;
  /** Republish (D127): the expired listing the listing form starts from; null for a blank form. */
  readonly republishFromListingId?: string | null;
}

export function WorldCreateForm({
  category,
  header,
  direction,
  title,
  onTitleChange,
  summary,
  onSummaryChange,
  onPublishActionChange,
  republishFromListingId = null,
}: Props) {
  const router = useRouter();
  // D60 — the challenges world only opens real challenges once launched; until then it takes links.
  const challengesLaunched = useLaunchWorldEnabled('world_challenges_enabled');
  if (category.id === 'challenges' && challengesLaunched) {
    return <ChallengeWorldCreateForm header={header} onPublishActionChange={onPublishActionChange} />;
  }
  if (category.engine === 'link' && category.linkCategory) {
    return (
      <LinkCreateForm
        key={category.id}
        categorySlug={category.linkCategory}
        header={header}
        onAdded={() => closeCreateForm(router)}
        onPublishActionChange={onPublishActionChange}
      />
    );
  }
  if (category.engine === 'listing' && category.worldSlug) {
    const listing = (
      <ListingCreateForm
        // A republish source arriving later remounts a clean form for it.
        key={`${category.worldSlug}:${republishFromListingId ?? ''}`}
        worldSlug={category.worldSlug}
        republishFromListingId={republishFromListingId}
        header={header}
        direction={direction}
        title={title}
        onTitleChange={onTitleChange}
        summary={summary}
        onSummaryChange={onSummaryChange}
        onPublished={() => closeCreateForm(router)}
        onPublishActionChange={onPublishActionChange}
      />
    );
    if (category.worldSlug === 'housing') {
      return (
        <HousingCreateVerificationGate header={header} onPublishActionChange={onPublishActionChange}>
          {listing}
        </HousingCreateVerificationGate>
      );
    }
    return listing;
  }
  return null;
}
