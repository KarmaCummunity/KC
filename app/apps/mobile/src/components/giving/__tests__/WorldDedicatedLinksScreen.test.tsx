// @vitest-environment jsdom
// FR-FEED-020 AC2 — a world's "links and knowledge" screen: the community list when the world
// has one, the curated sections when there is curated content, an empty state when a world has
// neither, and a retry when the content could not be read.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { emptyWorldContent, type WorldContent } from '@kc/domain';
import type { WorldContentState } from '../../../hooks/useWorldContent';

const mocks = vi.hoisted(() => ({ state: null as WorldContentState | null, retry: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarScrollInset: () => 64 }));
vi.mock('../../../hooks/useWorldContent', () => ({ useWorldContent: () => mocks.state }));
vi.mock('../useWorldHeader', () => ({
  WorldSubScreenChrome: ({ activeScreenTestId }: { activeScreenTestId: string }) => (
    <div data-testid={`chrome-${activeScreenTestId}`} />
  ),
}));
vi.mock('../../DonationLinksList', () => ({
  DonationLinksList: ({ categorySlug }: { categorySlug: string }) => <div data-testid={`donation-links-${categorySlug}`} />,
}));
vi.mock('../WorldContentSections', () => ({
  WorldContentSections: ({ content }: { content: WorldContent }) => <div data-testid={`sections-${content.worldSlug}`} />,
}));
vi.mock('../../EmptyState', () => ({ EmptyState: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../../ui/Buttons', () => ({
  PrimaryButton: (p: { label: string; testID?: string; onPress: () => void }) => (
    <button data-testid={p.testID} onClick={p.onPress}>{p.label}</button>
  ),
}));
vi.mock('../../ui/Screen', () => ({
  Screen: ({ children, testID }: { children: React.ReactNode; testID?: string }) => <div data-testid={testID}>{children}</div>,
}));

import { WorldDedicatedLinksScreen } from '../WorldDedicatedLinksScreen';

const BODY = { bodyId: 'b1', slug: 'mda', worldSlug: 'medical', labelHe: 'מד"א', labelEn: 'MDA', bodyType: 'blood_services', contactUrl: null };

function show(worldSlug: string, patch: Partial<WorldContentState> = {}) {
  mocks.state = { content: emptyWorldContent(worldSlug), isLoading: false, isError: false, retry: mocks.retry, ...patch };
  return render(<WorldDedicatedLinksScreen worldSlug={worldSlug} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WorldDedicatedLinksScreen (#1963)', () => {
  it('shows the community list and the curated sections of a world that has both, and no feed', () => {
    const view = show('animals', { content: { ...emptyWorldContent('animals'), externalBodies: [BODY] } });
    expect(view.getByTestId('chrome-world-hub-animals-links')).toBeTruthy();
    expect(view.getByTestId('world-links-screen-animals')).toBeTruthy();
    expect(view.getByTestId('donation-links-animals')).toBeTruthy();
    expect(view.getByTestId('sections-animals')).toBeTruthy();
    expect(view.queryByTestId('world-content-empty')).toBeNull();
    expect(view.queryByTestId('world-feed-list')).toBeNull();
  });

  it('reads the rides world from its community list, which keeps the older name', () => {
    const view = show('rides');
    expect(view.getByTestId('donation-links-transport')).toBeTruthy();
    // The list has its own empty state, so the screen adds none.
    expect(view.queryByTestId('world-content-empty')).toBeNull();
    expect(view.queryByTestId('sections-rides')).toBeNull();
  });

  it('shows an empty state for a world with no list and nothing curated', () => {
    const view = show('items');
    expect(view.getByTestId('world-content-empty').textContent).toBe('donations.worldContent.emptyTitle');
    expect(view.queryByTestId('sections-items')).toBeNull();
  });

  it('does not call a world empty while its content is still loading', () => {
    expect(show('items', { isLoading: true }).queryByTestId('world-content-empty')).toBeNull();
  });

  it('offers a retry, not an empty state, when the content could not be read', () => {
    const view = show('items', { isError: true });
    expect(view.queryByTestId('world-content-empty')).toBeNull();
    fireEvent.click(view.getByTestId('world-content-retry'));
    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });
});
