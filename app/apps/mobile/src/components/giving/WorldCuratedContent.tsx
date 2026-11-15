// FR-FEED-020 AC7 — the curated content of a world (organizations, related worlds, knowledge
// topics) for a screen that already shows the world's community links: the portal of a world
// whose launch flag is off, and the screen of a link-only world. Renders nothing while the
// content loads, when the world has none, or when it could not be read: the links above it
// are the screen's main content.
import React from 'react';
import { isWorldContentEmpty } from '@kc/domain';
import { useWorldContent } from '../../hooks/useWorldContent';
import { WorldContentSections } from './WorldContentSections';

export function WorldCuratedContent({ worldSlug }: { readonly worldSlug: string }) {
  const { content } = useWorldContent(worldSlug);
  if (isWorldContentEmpty(content)) return null;
  return <WorldContentSections content={content} />;
}
