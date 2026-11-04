// Mapped to spec: FR-POST-001 AC6 / D100 — the create form of every category that is not the
// items post: a marketplace listing for the worlds with a feed, "add a link" for the rest.
import React from 'react';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import type { CreateCategoryConfig, CreateDirection } from '../../lib/unifiedCreate/createCategories';
import { hubHrefForWorld } from '../../navigation/donationsHubTiles';
import { LinkCreateForm } from './LinkCreateForm';
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
}

export function WorldCreateForm({ category, header, direction, title, onTitleChange, summary, onSummaryChange, onPublishActionChange }: Props) {
  const router = useRouter();
  if (category.engine === 'link' && category.linkCategory) {
    return (
      <LinkCreateForm
        key={category.id}
        categorySlug={category.linkCategory}
        header={header}
        // The link waits for review (D9); the world's screen shows it to its submitter meanwhile.
        onAdded={() => router.replace(hubHrefForWorld(category.id))}
        onPublishActionChange={onPublishActionChange}
      />
    );
  }
  if (category.engine === 'listing' && category.worldSlug) {
    return (
      <ListingCreateForm
        key={category.worldSlug}
        worldSlug={category.worldSlug}
        header={header}
        direction={direction}
        title={title}
        onTitleChange={onTitleChange}
        summary={summary}
        onSummaryChange={onSummaryChange}
        onPublished={(id) => router.replace(`/(tabs)/donations/marketplace/${id}`)}
        onPublishActionChange={onPublishActionChange}
      />
    );
  }
  return null;
}
