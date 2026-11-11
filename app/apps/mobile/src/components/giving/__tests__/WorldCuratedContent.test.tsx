// @vitest-environment jsdom
// FR-FEED-020 AC7 — curated content under a screen's community links (a world's portal, a
// link-only world): shown when the world has some, nothing at all otherwise.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { emptyWorldContent, type WorldContent } from '@kc/domain';

const mocks = vi.hoisted(() => ({ content: null as WorldContent | null, asked: [] as string[] }));

vi.mock('../../../hooks/useWorldContent', () => ({
  useWorldContent: (worldSlug: string) => {
    mocks.asked.push(worldSlug);
    return { content: mocks.content, isLoading: false, isError: false, retry: () => {} };
  },
}));
vi.mock('../WorldContentSections', () => ({
  WorldContentSections: ({ content }: { content: WorldContent }) => <div data-testid={`sections-${content.worldSlug}`} />,
}));

import { WorldCuratedContent } from '../WorldCuratedContent';

afterEach(() => {
  cleanup();
  mocks.asked = [];
});

describe('WorldCuratedContent', () => {
  it('shows the sections of the asked world when it has curated content', () => {
    mocks.content = {
      ...emptyWorldContent('knowledge'),
      topics: [{
        topicId: 't1', slug: 'languages', parentId: null, labelHe: 'שפות', labelEn: 'Languages',
        descriptionHe: null, status: 'active', mergedIntoId: null, sortOrder: 2,
      }],
    };
    const view = render(<WorldCuratedContent worldSlug="knowledge" />);
    expect(view.getByTestId('sections-knowledge')).toBeTruthy();
    expect(mocks.asked).toEqual(['knowledge']);
  });

  it('renders nothing for a world with nothing curated', () => {
    mocks.content = emptyWorldContent('democracy');
    expect(render(<WorldCuratedContent worldSlug="democracy" />).container.innerHTML).toBe('');
  });
});
