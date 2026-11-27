// @vitest-environment jsdom
// #1412 / #1809 — shared publisher card: listing defaults and post-page prop differences.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider, iconSize } from '@kc/ui';

const push = vi.fn();
vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../AvatarInitials', () => ({ AvatarInitials: () => null }));

import { PublisherCard } from '../PublisherCard';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCard(props: Partial<React.ComponentProps<typeof PublisherCard>> = {}) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <PublisherCard name="Dana Levi" avatarUrl={null} cityName="Lod" profileRef="dana" {...props} />
    </ThemeProvider>,
  );
}

describe('PublisherCard', () => {
  it('shows the name and city, and no raw handle', () => {
    const { getByText, queryByText, getByTestId } = renderCard();
    expect(getByTestId('listing-publisher-card')).toBeTruthy();
    expect(getByText('post.detail.publishedBy')).toBeTruthy();
    expect(getByText('Dana Levi')).toBeTruthy();
    expect(getByText('Lod')).toBeTruthy();
    expect(queryByText('@dana')).toBeNull();
  });

  it('opens the publisher profile on tap', () => {
    const { getByRole } = renderCard();
    fireEvent.click(getByRole('button'));
    expect(push).toHaveBeenCalledWith('/user/dana');
  });

  it('hides an unknown city and stays static without a profile to open', () => {
    const { queryByText, queryByRole } = renderCard({ cityName: null, profileRef: null });
    expect(queryByText('Lod')).toBeNull();
    expect(queryByRole('button')).toBeNull();
  });

  // #1809 — post detail used lg chevron and no name clamp; props preserve that look.
  it('accepts post-detail chevron size, unclamped name, and a distinct testID', () => {
    const { getByTestId, getByText } = renderCard({
      chevronSize: iconSize.lg,
      nameNumberOfLines: null,
      testID: 'post-publisher-card',
    });
    expect(getByTestId('post-publisher-card')).toBeTruthy();
    expect(getByText('Dana Levi')).toBeTruthy();
  });

  it('does not navigate when profileRef is omitted even if a handle-like name is shown', () => {
    const { queryByRole } = renderCard({ profileRef: null });
    expect(queryByRole('button')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
